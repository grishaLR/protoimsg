/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWebSocket } from './WebSocketContext';
import { useAuth } from './auth';
import { fetchIceServers } from './api';
import { getWebRTC, isWebRTCAvailable } from './datachannel';
import { shouldForceRelay } from './DmContext';
import {
  PeerManager,
  PeerConnectionType,
  type NativeMediaStream,
  type NativeMediaStreamTrack,
} from './peerconnection';
import { playImNotify } from './sounds';
import { heavyTap } from './haptics';
import type { ServerMessage, IceCandidateInit } from '@protoimsg/shared';

export interface VideoCall {
  conversationId: string;
  recipientDid: string;
  status: 'outgoing' | 'incoming' | 'active' | 'reconnecting' | 'failed';
  localStream: NativeMediaStream | null;
  remoteStream: NativeMediaStream | undefined;
}

interface VideoCallContextValue {
  activeCall: VideoCall | null;
  callError: string | null;
  isMuted: boolean;
  isCameraOff: boolean;
  videoCall: (recipientDid: string) => void;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangUp: () => void;
  retryCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  flipCamera: () => void;
}

const VideoCallContext = createContext<VideoCallContextValue | null>(null);

const INCOMING_CALL_TIMEOUT_MS = 30_000;

export function VideoCallProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useWebSocket();
  const { did } = useAuth();
  const [activeCall, setActiveCall] = useState<VideoCall | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMutedRef = useRef(false);
  const isCameraOffRef = useRef(false);

  // Refs for internal state that WS handlers need without triggering re-renders
  const peerConnection = useRef<PeerManager | null>(null);
  const localStream = useRef<NativeMediaStream | null>(null);
  const incomingOffer = useRef<string | null>(null);
  const pendingIceCandidates = useRef<IceCandidateInit[]>([]);
  const pendingCallDid = useRef<string | null>(null);
  const incomingCallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of activeCall so WS handlers always see latest state
  const activeCallRef = useRef<VideoCall | null>(null);
  activeCallRef.current = activeCall;

  /** Clean up all WebRTC + media state */
  const cleanUp = useCallback(() => {
    if (peerConnection.current) {
      peerConnection.current.pc.close();
      peerConnection.current = null;
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        track.stop();
      });
      localStream.current = null;
    }
    isMutedRef.current = false;
    setIsMuted(false);
    isCameraOffRef.current = false;
    setIsCameraOff(false);
    incomingOffer.current = null;
    pendingIceCandidates.current = [];
    pendingCallDid.current = null;
    if (incomingCallTimer.current) {
      clearTimeout(incomingCallTimer.current);
      incomingCallTimer.current = null;
    }
    setActiveCall(null);
  }, []);

  /** Handle remote stream from PeerManager */
  const onRemoteStream = useCallback((_conversationId: string, stream: NativeMediaStream) => {
    setActiveCall((prev) => (prev ? { ...prev, remoteStream: stream, status: 'active' } : prev));
  }, []);

  /** Handle ICE connection state changes — surface reconnecting/failed to UI */
  const onIceConnectionStateChange = useCallback((state: string) => {
    if (state === 'disconnected') {
      setActiveCall((prev) =>
        prev && prev.status === 'active' ? { ...prev, status: 'reconnecting' } : prev,
      );
    } else if (state === 'connected' || state === 'completed') {
      setActiveCall((prev) =>
        prev && prev.status === 'reconnecting' ? { ...prev, status: 'active' } : prev,
      );
    } else if (state === 'failed') {
      if (peerConnection.current) {
        peerConnection.current.pc.close();
        peerConnection.current = null;
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          track.stop();
        });
        localStream.current = null;
      }
      setActiveCall((prev) =>
        prev ? { ...prev, status: 'failed', localStream: null, remoteStream: undefined } : prev,
      );
    }
  }, []);

  /** Show a temporary error message (auto-clears after 5s) */
  const showCallError = useCallback((message: string) => {
    setCallError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setCallError(null);
    }, 5000);
  }, []);

  /** Start call after we have a conversationId */
  const initiateCall = useCallback(
    async (conversationId: string, recipientDid: string) => {
      if (!did || !isWebRTCAvailable()) return;

      try {
        const iceServers = await fetchIceServers();
        if (iceServers.length === 0) {
          console.warn('[VideoCall] ICE servers unavailable — video call blocked');
          showCallError('Video calls are temporarily unavailable. Please try again later.');
          return;
        }

        const webrtc = getWebRTC();
        if (!webrtc) return;

        const stream: NativeMediaStream = await webrtc.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        localStream.current = stream;

        const useRelay = shouldForceRelay(recipientDid);
        const pm = new PeerManager({
          config: { iceServers, ...(useRelay && { iceTransportPolicy: 'relay' as const }) },
          conversationId,
          send,
          onRemoteStream,
          onIceConnectionStateChange,
          type: PeerConnectionType.Caller,
        });

        if (peerConnection.current) {
          peerConnection.current.pc.close();
        }
        peerConnection.current = pm;

        stream.getTracks().forEach((track) => {
          pm.pc.addTrack(track, stream);
        });

        // Start with camera + mic off (use enabled toggle, not replaceTrack)
        for (const vt of stream.getVideoTracks()) {
          vt.enabled = false;
        }
        isCameraOffRef.current = true;
        setIsCameraOff(true);
        for (const at of stream.getAudioTracks()) {
          at.enabled = false;
        }
        isMutedRef.current = true;
        setIsMuted(true);

        setActiveCall({
          conversationId,
          recipientDid,
          status: 'outgoing',
          localStream: stream,
          remoteStream: undefined,
        });
      } catch (err) {
        console.error('[VideoCall] Failed to start call', err);
        showCallError('Failed to access camera/microphone.');
        cleanUp();
      }
    },
    [send, did, onRemoteStream, onIceConnectionStateChange, showCallError, cleanUp],
  );

  const videoCall = useCallback(
    (recipientDid: string) => {
      if (activeCallRef.current) return;
      if (!isWebRTCAvailable()) return;

      pendingCallDid.current = recipientDid;
      send({ type: 'call_init', recipientDid });

      // Set preliminary outgoing state immediately so the call screen
      // doesn't navigate away while waiting for call_ready from server
      setActiveCall({
        conversationId: '',
        recipientDid,
        status: 'outgoing',
        localStream: null,
        remoteStream: undefined,
      });
    },
    [send],
  );

  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || call.status !== 'incoming' || !did || !isWebRTCAvailable()) return;

    const offer = incomingOffer.current;
    if (!offer) {
      console.error('[VideoCall] No incoming offer found');
      return;
    }

    if (incomingCallTimer.current) {
      clearTimeout(incomingCallTimer.current);
      incomingCallTimer.current = null;
    }

    try {
      const iceServers = await fetchIceServers();
      if (iceServers.length === 0) {
        console.warn('[VideoCall] ICE servers unavailable — video call blocked');
        showCallError('Video calls are temporarily unavailable. Please try again later.');
        cleanUp();
        return;
      }

      const webrtc = getWebRTC();
      if (!webrtc) return;

      const useRelay = shouldForceRelay(call.recipientDid);
      const pm = new PeerManager({
        config: { iceServers, ...(useRelay && { iceTransportPolicy: 'relay' as const }) },
        conversationId: call.conversationId,
        send,
        onRemoteStream,
        onIceConnectionStateChange,
        type: PeerConnectionType.Callee,
      });

      if (peerConnection.current) {
        peerConnection.current.pc.close();
      }
      peerConnection.current = pm;

      const { RTCSessionDescription } = webrtc;
      await pm.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offer }));

      // Flush any ICE candidates that arrived before we accepted
      for (const c of pendingIceCandidates.current) {
        pm.addBufferedCandidate(c);
      }
      pendingIceCandidates.current = [];
      pm.flushCandidates();

      const stream: NativeMediaStream = await webrtc.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      localStream.current = stream;

      stream.getTracks().forEach((track) => {
        pm.pc.addTrack(track, stream);
      });

      // Start with camera + mic off (use enabled toggle, not replaceTrack)
      for (const vt of stream.getVideoTracks()) {
        vt.enabled = false;
      }
      isCameraOffRef.current = true;
      setIsCameraOff(true);
      for (const at of stream.getAudioTracks()) {
        at.enabled = false;
      }
      isMutedRef.current = true;
      setIsMuted(true);

      const answer = await pm.pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pm.pc.setLocalDescription(answer);

      if (!answer.sdp) {
        throw new Error('Answer SDP is undefined');
      }

      send({ type: 'accept_call', conversationId: call.conversationId, answer: answer.sdp });

      setActiveCall((prev) => (prev ? { ...prev, status: 'active', localStream: stream } : prev));
      incomingOffer.current = null;
    } catch (err) {
      console.error('[VideoCall] Failed to accept call', err);
      showCallError('Failed to access camera/microphone.');
      cleanUp();
    }
  }, [send, did, onRemoteStream, onIceConnectionStateChange, showCallError, cleanUp]);

  const rejectCall = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;

    // Don't send reject with empty conversationId (before call_ready arrives)
    if (call.conversationId) {
      send({ type: 'reject_call', conversationId: call.conversationId });
    }
    cleanUp();
  }, [send, cleanUp]);

  const hangUp = rejectCall;

  const retryCall = useCallback(() => {
    const recipientDid = activeCallRef.current?.recipientDid;
    if (!recipientDid) return;
    cleanUp();
    videoCall(recipientDid);
  }, [cleanUp, videoCall]);

  const toggleMute = useCallback(() => {
    const stream = localStream.current;
    if (!stream) return;
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    for (const track of stream.getAudioTracks()) {
      track.enabled = !next;
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStream.current;
    if (!stream) return;

    const next = !isCameraOffRef.current;
    isCameraOffRef.current = next;
    setIsCameraOff(next);

    // On react-native-webrtc, toggling track.enabled is sufficient —
    // it stops/starts the camera hardware and the remote peer sees black.
    // Do NOT use replaceTrack(null) — finding the sender again is unreliable
    // since sender.track becomes null and can't be matched.
    for (const videoTrack of stream.getVideoTracks()) {
      videoTrack.enabled = !next;
    }

    // Trigger re-render so local video inset shows/hides
    setActiveCall((prev) => (prev ? { ...prev, localStream: stream } : prev));
  }, []);

  const flipCamera = useCallback(() => {
    const stream = localStream.current;
    if (!stream) return;

    // react-native-webrtc provides _switchCamera() on video tracks
    const videoTrack = stream.getVideoTracks()[0] as NativeMediaStreamTrack | undefined;
    if (videoTrack && typeof videoTrack._switchCamera === 'function') {
      videoTrack._switchCamera();
    }
  }, []);

  // WS event handler
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'call_ready': {
          const { conversationId, recipientDid } = msg.data;
          if (pendingCallDid.current && pendingCallDid.current === recipientDid) {
            pendingCallDid.current = null;
            // Update the placeholder conversationId set by videoCall()
            setActiveCall((prev) =>
              prev && prev.recipientDid === recipientDid ? { ...prev, conversationId } : prev,
            );
            void initiateCall(conversationId, recipientDid);
          }
          break;
        }

        case 'incoming_call': {
          const { conversationId, senderDid, offer } = msg.data;

          // Glare handling
          if (activeCallRef.current) {
            if (activeCallRef.current.status === 'outgoing' && did) {
              const localIsPolite = did < senderDid;
              if (localIsPolite) {
                send({
                  type: 'reject_call',
                  conversationId: activeCallRef.current.conversationId,
                });
                cleanUp();
              } else {
                send({ type: 'reject_call', conversationId });
                break;
              }
            } else {
              send({ type: 'reject_call', conversationId });
              break;
            }
          }

          incomingOffer.current = offer;

          // Subscribe for signaling on this conversation
          send({ type: 'call_init', recipientDid: senderDid });

          setActiveCall({
            conversationId,
            recipientDid: senderDid,
            status: 'incoming',
            localStream: null,
            remoteStream: undefined,
          });

          void playImNotify();
          void heavyTap();

          // Auto-reject after timeout
          incomingCallTimer.current = setTimeout(() => {
            if (activeCallRef.current?.conversationId === conversationId) {
              send({ type: 'reject_call', conversationId });
              cleanUp();
            }
          }, INCOMING_CALL_TIMEOUT_MS);
          break;
        }

        case 'accept_call': {
          const { conversationId, answer } = msg.data;
          const pm = peerConnection.current;
          if (!pm || activeCallRef.current?.conversationId !== conversationId) break;

          const webrtc = getWebRTC();
          if (!webrtc) break;
          const { RTCSessionDescription } = webrtc;

          pm.pc
            .setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer }))
            .then(() => {
              pm.flushCandidates();
            })
            .catch((err: unknown) => {
              console.error('[VideoCall] Failed to set remote description', err);
            });

          setActiveCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
          break;
        }

        case 'reject_call': {
          const { conversationId } = msg.data;
          if (activeCallRef.current?.conversationId === conversationId) {
            cleanUp();
          }
          break;
        }

        case 'new_ice_candidate': {
          const { conversationId, candidate } = msg.data;
          if (activeCallRef.current?.conversationId !== conversationId) break;

          const pm = peerConnection.current;
          if (!pm) {
            pendingIceCandidates.current.push(candidate);
            break;
          }

          pm.addBufferedCandidate(candidate);
          break;
        }
      }
    });

    return () => {
      unsub();
    };
  }, [subscribe, send, initiateCall, cleanUp, did]);

  // Send reject_call when app goes to background during active call
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        const call = activeCallRef.current;
        if (call) {
          send({ type: 'reject_call', conversationId: call.conversationId });
          cleanUp();
        }
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [send, cleanUp]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (peerConnection.current) {
        peerConnection.current.pc.close();
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          track.stop();
        });
      }
      if (incomingCallTimer.current) {
        clearTimeout(incomingCallTimer.current);
      }
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, []);

  const value: VideoCallContextValue = useMemo(
    () => ({
      activeCall,
      callError,
      isMuted,
      isCameraOff,
      videoCall,
      acceptCall,
      rejectCall,
      hangUp,
      retryCall,
      toggleMute,
      toggleCamera,
      flipCamera,
    }),
    [
      activeCall,
      callError,
      isMuted,
      isCameraOff,
      videoCall,
      acceptCall,
      rejectCall,
      hangUp,
      retryCall,
      toggleMute,
      toggleCamera,
      flipCamera,
    ],
  );

  return <VideoCallContext.Provider value={value}>{children}</VideoCallContext.Provider>;
}

export function useVideoCall(): VideoCallContextValue {
  const ctx = useContext(VideoCallContext);
  if (!ctx) throw new Error('useVideoCall must be used within VideoCallProvider');
  return ctx;
}

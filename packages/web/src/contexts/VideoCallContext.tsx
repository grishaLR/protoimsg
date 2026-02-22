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
import { useWebSocket } from './WebSocketContext';
import { useAuth } from '../hooks/useAuth';
import { playImNotify } from '../lib/sounds';
import { fetchIceServers } from '../lib/api';
import { PeerManager, PeerConnectionType } from '../lib/peerconnection';
import { shouldForceRelayForDid } from '../lib/ip-protection';
import { Sentry } from '../sentry';
import type { ServerMessage, IceCandidateInit } from '@protoimsg/shared';

export { setInnerCircleDidsForCalls } from '../lib/ip-protection';
export type { IpProtectionLevel } from '../lib/ip-protection';

export interface VideoCall {
  conversationId: string;
  recipientDid: string;
  status: 'outgoing' | 'incoming' | 'active' | 'reconnecting' | 'failed';
  localStream: MediaStream | null;
  remoteStream: MediaStream | undefined;
}

interface VideoCallContextValue {
  activeCall: VideoCall | null;
  callError: string | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  videoCall: (recipientDid: string) => void;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangUp: () => void;
  retryCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  flipCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMutedRef = useRef(false);
  const isCameraOffRef = useRef(false);
  const currentFacingMode = useRef<'user' | 'environment'>('user');
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  const savedCameraTrack = useRef<MediaStreamTrack | null>(null);
  /** Camera track saved when user toggles camera off (distinct from screen share save) */
  const cameraOffTrack = useRef<MediaStreamTrack | null>(null);

  // Refs for internal state that WS handlers need without triggering re-renders
  const peerConnection = useRef<PeerManager | null>(null);
  const localStream = useRef<MediaStream | null>(null);
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
    if (screenTrack.current) {
      screenTrack.current.onended = null;
      screenTrack.current.stop();
      screenTrack.current = null;
    }
    savedCameraTrack.current = null;
    cameraOffTrack.current = null;
    setIsScreenSharing(false);
    isMutedRef.current = false;
    setIsMuted(false);
    isCameraOffRef.current = false;
    setIsCameraOff(false);
    currentFacingMode.current = 'user';
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
  const onRemoteStream = useCallback((_conversationId: string, stream: MediaStream) => {
    setActiveCall((prev) => (prev ? { ...prev, remoteStream: stream, status: 'active' } : prev));
  }, []);

  /** Handle ICE connection state changes — surface reconnecting/failed to UI */
  const onIceConnectionStateChange = useCallback(
    (state: RTCIceConnectionState) => {
      if (state === 'disconnected') {
        setActiveCall((prev) =>
          prev && prev.status === 'active' ? { ...prev, status: 'reconnecting' } : prev,
        );
      } else if (state === 'connected' || state === 'completed') {
        setActiveCall((prev) =>
          prev && prev.status === 'reconnecting' ? { ...prev, status: 'active' } : prev,
        );
      } else if (state === 'failed') {
        // Release media + peer connection but keep call metadata for retry UI
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
        if (screenTrack.current) {
          screenTrack.current.onended = null;
          screenTrack.current.stop();
          screenTrack.current = null;
        }
        savedCameraTrack.current = null;
        setIsScreenSharing(false);
        setActiveCall((prev) =>
          prev ? { ...prev, status: 'failed', localStream: null, remoteStream: undefined } : prev,
        );
      }
    },
    [cleanUp],
  );

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
      if (!did) return;

      try {
        const iceServers = await fetchIceServers();
        if (iceServers.length === 0) {
          Sentry.captureMessage('ICE servers unavailable — video call blocked', {
            level: 'error',
            tags: { component: 'VideoCall', role: 'caller' },
          });
          showCallError('Video calls are temporarily unavailable. Please try again later.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.current = stream;

        const useRelay = shouldForceRelayForDid(recipientDid);
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

        // Start with camera + mic off
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
          cameraOffTrack.current = videoTrack;
          const videoSender = pm.pc.getSenders().find((s) => s.track?.kind === 'video');
          void videoSender?.replaceTrack(null);
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
        console.error('Failed to start call', err);
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          showCallError('videoCall.error.mediaPermission');
        }
        cleanUp();
      }
    },
    [send, did, onRemoteStream, onIceConnectionStateChange, showCallError, cleanUp],
  );

  const videoCall = useCallback(
    (recipientDid: string) => {
      // Already in a call — ignore
      if (activeCallRef.current) return;

      pendingCallDid.current = recipientDid;
      // Dedicated call_init — gets a conversationId for signaling without
      // triggering a DM popover (DmContext doesn't process call_ready)
      send({ type: 'call_init', recipientDid });
    },
    [send],
  );

  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || call.status !== 'incoming' || !did) return;

    const offer = incomingOffer.current;
    if (!offer) {
      console.error('No incoming offer found');
      return;
    }

    if (incomingCallTimer.current) {
      clearTimeout(incomingCallTimer.current);
      incomingCallTimer.current = null;
    }

    try {
      const iceServers = await fetchIceServers();
      if (iceServers.length === 0) {
        Sentry.captureMessage('ICE servers unavailable — video call blocked', {
          level: 'error',
          tags: { component: 'VideoCall', role: 'callee' },
        });
        showCallError('Video calls are temporarily unavailable. Please try again later.');
        cleanUp();
        return;
      }
      const useRelay = shouldForceRelayForDid(call.recipientDid);
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

      await pm.pc.setRemoteDescription({ type: 'offer', sdp: offer });

      // Flush any ICE candidates that arrived before we accepted
      for (const c of pendingIceCandidates.current) {
        pm.addBufferedCandidate(c);
      }
      pendingIceCandidates.current = [];
      pm.flushCandidates();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStream.current = stream;

      stream.getTracks().forEach((track) => {
        pm.pc.addTrack(track, stream);
      });

      // Start with camera + mic off
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
        cameraOffTrack.current = videoTrack;
        const videoSender = pm.pc.getSenders().find((s) => s.track?.kind === 'video');
        void videoSender?.replaceTrack(null);
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
      console.error('Failed to accept call', err);
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        showCallError('videoCall.error.mediaPermission');
      }
      cleanUp();
    }
  }, [send, did, onRemoteStream, onIceConnectionStateChange, showCallError, cleanUp]);

  const rejectCall = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;

    send({ type: 'reject_call', conversationId: call.conversationId });
    cleanUp();
  }, [send, cleanUp]);

  // Semantically identical to rejectCall for now — both send reject_call + cleanUp
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

  /** Find the video sender (may have null track when camera is off) */
  const getVideoSender = useCallback(() => {
    const pm = peerConnection.current;
    if (!pm) return null;
    // Video sender is the one with a video track, or the one without an audio track
    return (
      pm.pc.getSenders().find((s) => s.track?.kind === 'video') ??
      pm.pc
        .getSenders()
        .find((s) => !s.track && s !== pm.pc.getSenders().find((a) => a.track?.kind === 'audio')) ??
      null
    );
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStream.current;
    if (!stream) return;

    const next = !isCameraOffRef.current;
    isCameraOffRef.current = next;
    setIsCameraOff(next);

    const sender = getVideoSender();

    if (next) {
      // Turning camera off — save track and replace with null so receiver gets mute event
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        cameraOffTrack.current = videoTrack;
        videoTrack.enabled = false;
        void sender?.replaceTrack(null);
      }
    } else {
      // Turning camera on — restore saved track
      const saved = cameraOffTrack.current;
      if (saved && saved.readyState !== 'ended') {
        saved.enabled = true;
        void sender?.replaceTrack(saved);
        cameraOffTrack.current = null;

        // Safari background: OS kills camera track, firing 'ended'.
        // Update local state so the UI reflects the camera is off.
        saved.addEventListener('ended', () => {
          isCameraOffRef.current = true;
          setIsCameraOff(true);
        });
      }
    }
  }, [getVideoSender]);

  const flipCamera = useCallback(async () => {
    const pm = peerConnection.current;
    const stream = localStream.current;
    if (!pm || !stream) return;

    const newFacing = currentFacingMode.current === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      // Replace track on the peer connection sender (no renegotiation needed)
      const sender = pm.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
      }

      // Stop old video track and swap into local stream
      const oldTrack = stream.getVideoTracks()[0];
      if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.addTrack(newTrack);
      currentFacingMode.current = newFacing;

      // Safari background: OS kills camera track, firing 'ended'.
      newTrack.addEventListener('ended', () => {
        isCameraOffRef.current = true;
        setIsCameraOff(true);
      });

      // Trigger re-render so PIP updates
      setActiveCall((prev) => (prev ? { ...prev, localStream: stream } : prev));
    } catch (err) {
      console.error('Failed to flip camera', err);
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    const pm = peerConnection.current;
    const stream = localStream.current;
    if (!pm || !stream) return;

    const scrTrack = screenTrack.current;
    const camTrack = savedCameraTrack.current;

    // If saved camera track ended (e.g. permission revoked), get a fresh one
    let restoreTrack = camTrack;
    if (!restoreTrack || restoreTrack.readyState === 'ended') {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: currentFacingMode.current },
          audio: false,
        });
        restoreTrack = camStream.getVideoTracks()[0] ?? null;
      } catch {
        restoreTrack = null;
      }
    }

    // Replace on sender
    if (restoreTrack) {
      const sender = pm.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(restoreTrack);
    }

    // Swap in local stream
    if (scrTrack) {
      stream.removeTrack(scrTrack);
      scrTrack.onended = null;
      scrTrack.stop();
    }
    if (restoreTrack) stream.addTrack(restoreTrack);

    screenTrack.current = null;
    savedCameraTrack.current = null;
    setIsScreenSharing(false);
    setActiveCall((prev) => (prev ? { ...prev, localStream: stream } : prev));
  }, []);

  const startScreenShare = useCallback(async () => {
    const pm = peerConnection.current;
    const stream = localStream.current;
    if (!pm || !stream) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const newTrack = screenStream.getVideoTracks()[0];
      if (!newTrack) return;

      // Save camera track for restoration
      const cameraTrk = stream.getVideoTracks()[0];
      if (cameraTrk) savedCameraTrack.current = cameraTrk;

      // Replace on sender (no renegotiation)
      const sender = pm.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);

      // Swap in local stream
      if (cameraTrk) stream.removeTrack(cameraTrk);
      stream.addTrack(newTrack);
      screenTrack.current = newTrack;
      setIsScreenSharing(true);
      setActiveCall((prev) => (prev ? { ...prev, localStream: stream } : prev));

      // Auto-stop when user clicks browser's "Stop sharing" button
      newTrack.onended = () => {
        void stopScreenShare();
      };
    } catch (err) {
      // User cancelled the picker — not an error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to start screen share', err);
    }
  }, [stopScreenShare]);

  // WS event handler
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'call_ready': {
          const { conversationId, recipientDid } = msg.data;
          if (pendingCallDid.current && pendingCallDid.current === recipientDid) {
            pendingCallDid.current = null;
            void initiateCall(conversationId, recipientDid);
          }
          break;
        }

        case 'incoming_call': {
          const { conversationId, senderDid, offer } = msg.data;

          // Glare handling: both users called each other simultaneously.
          // DID-based tiebreaker — lexicographically lower DID is the "polite"
          // peer (abandons its outgoing call, accepts the incoming one).
          // Higher DID is "impolite" (ignores incoming, keeps outgoing).
          if (activeCallRef.current) {
            if (activeCallRef.current.status === 'outgoing' && did) {
              const localIsPolite = did < senderDid;
              if (localIsPolite) {
                // We are polite — abandon our outgoing call, accept the incoming one
                send({
                  type: 'reject_call',
                  conversationId: activeCallRef.current.conversationId,
                });
                cleanUp();
                // Fall through to handle this as a normal incoming call
              } else {
                // We are impolite — ignore the incoming call, keep our outgoing
                send({ type: 'reject_call', conversationId });
                break;
              }
            } else {
              // Already in an active/incoming/reconnecting/failed call — reject incoming
              send({ type: 'reject_call', conversationId });
              break;
            }
          }

          playImNotify();
          incomingOffer.current = offer;

          // Subscribe for signaling on this conversation (call_init subscribes
          // the socket without triggering a DM popover)
          send({ type: 'call_init', recipientDid: senderDid });

          setActiveCall({
            conversationId,
            recipientDid: senderDid,
            status: 'incoming',
            localStream: null,
            remoteStream: undefined,
          });

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

          pm.pc
            .setRemoteDescription({ type: 'answer', sdp: answer })
            .then(() => {
              pm.flushCandidates();
            })
            .catch((err: unknown) => {
              console.error('Failed to set remote description', err);
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
            // Buffer until PeerManager is created (callee hasn't accepted yet)
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

  // Notify remote peer on tab close so they don't see frozen video for 30s
  useEffect(() => {
    const handleBeforeUnload = () => {
      const call = activeCallRef.current;
      if (call) {
        send({ type: 'reject_call', conversationId: call.conversationId });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [send]);

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
      isScreenSharing,
      videoCall,
      acceptCall,
      rejectCall,
      hangUp,
      retryCall,
      toggleMute,
      toggleCamera,
      flipCamera,
      startScreenShare,
      stopScreenShare,
    }),
    [
      activeCall,
      callError,
      isMuted,
      isCameraOff,
      isScreenSharing,
      videoCall,
      acceptCall,
      rejectCall,
      hangUp,
      retryCall,
      toggleMute,
      toggleCamera,
      flipCamera,
      startScreenShare,
      stopScreenShare,
    ],
  );

  return <VideoCallContext.Provider value={value}>{children}</VideoCallContext.Provider>;
}

export function useVideoCall(): VideoCallContextValue {
  const ctx = useContext(VideoCallContext);
  if (!ctx) throw new Error('useVideoCall must be used within VideoCallProvider');
  return ctx;
}

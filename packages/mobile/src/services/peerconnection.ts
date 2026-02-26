/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-condition */
import type { ClientMessage, IceCandidateInit } from '@protoimsg/shared';
import { getWebRTC } from './datachannel';

export enum PeerConnectionType {
  Caller = 'caller',
  Callee = 'callee',
}

// react-native-webrtc uses event-target-shim — same Evented pattern as DataChannelPeer
type Evented = {
  addEventListener: (type: string, handler: (event: never) => void) => void;
};

// Structural types for native objects (avoids top-level import)
interface NativePeerConnection {
  localDescription: { sdp: string; type: string | null } | null;
  remoteDescription: unknown;
  signalingState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  createOffer: (opts: Record<string, unknown>) => Promise<{ sdp?: string; type?: string }>;
  createAnswer: (opts?: Record<string, unknown>) => Promise<{ sdp?: string; type?: string }>;
  setLocalDescription: (desc: unknown) => Promise<void>;
  setRemoteDescription: (desc: unknown) => Promise<void>;
  addIceCandidate: (candidate: unknown) => Promise<void>;
  addTrack: (track: unknown, stream: unknown) => unknown;
  getSenders: () => Array<{
    track: { kind: string } | null;
    replaceTrack: (t: unknown) => Promise<void>;
  }>;
  restartIce: () => void;
  close: () => void;
}

interface PeerConnectionConfig {
  config: {
    iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    iceTransportPolicy?: 'all' | 'relay';
  };
  send: (msg: ClientMessage) => void;
  conversationId: string;
  onRemoteStream: (conversationId: string, stream: NativeMediaStream) => void;
  onIceConnectionStateChange?: (state: string) => void;
  type: PeerConnectionType;
}

// Structural type for the native MediaStream
export interface NativeMediaStream {
  toURL: () => string;
  getTracks: () => NativeMediaStreamTrack[];
  getAudioTracks: () => NativeMediaStreamTrack[];
  getVideoTracks: () => NativeMediaStreamTrack[];
  addTrack: (track: NativeMediaStreamTrack) => void;
  removeTrack: (track: NativeMediaStreamTrack) => void;
}

export interface NativeMediaStreamTrack {
  kind: string;
  enabled: boolean;
  readyState: string;
  _switchCamera: () => void;
  stop: () => void;
}

export class PeerManager {
  public pc: NativePeerConnection;
  private send: (msg: ClientMessage) => void;
  private conversationId: string;
  private onRemoteStream: (conversationId: string, stream: NativeMediaStream) => void;
  private onIceConnectionStateChange?: (state: string) => void;
  private type: PeerConnectionType;
  private pendingCandidates: IceCandidateInit[] = [];

  /** Negotiation mutex — prevents overlapping createOffer/setLocalDescription cycles */
  private isNegotiating = false;
  /** Set when onnegotiationneeded fires while a negotiation is already in progress */
  private negotiationNeededAgain = false;
  /** Whether we already attempted an ICE restart */
  private iceRestartAttempted = false;

  constructor(peerConfig: PeerConnectionConfig) {
    const webrtc = getWebRTC();
    if (!webrtc) throw new Error('WebRTC native module not available');
    const { RTCPeerConnection } = webrtc;

    this.send = peerConfig.send;
    this.conversationId = peerConfig.conversationId;
    this.onRemoteStream = peerConfig.onRemoteStream;
    this.onIceConnectionStateChange = peerConfig.onIceConnectionStateChange;
    this.type = peerConfig.type;

    this.pc = new RTCPeerConnection(peerConfig.config) as unknown as NativePeerConnection;
    const pcEvt = this.pc as unknown as Evented;
    pcEvt.addEventListener('icecandidate', this.handleICECandidateEvent.bind(this));
    pcEvt.addEventListener('track', this.handleTrackEvent.bind(this));
    pcEvt.addEventListener('negotiationneeded', this.handleNegotiationNeededEvent.bind(this));
    pcEvt.addEventListener(
      'iceconnectionstatechange',
      this.handleICEConnectionStateChangeEvent.bind(this),
    );
  }

  /** Buffer ICE candidates until remote description is set, then flush */
  addBufferedCandidate(candidate: IceCandidateInit): void {
    const { RTCIceCandidate } = getWebRTC()!;
    if (this.pc.signalingState === 'closed') return;
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          console.warn('[PeerManager] Failed to add ICE candidate', err);
        }
      });
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  /** Flush buffered ICE candidates — call after setRemoteDescription */
  flushCandidates(): void {
    const { RTCIceCandidate } = getWebRTC()!;
    if (this.pc.signalingState === 'closed') {
      this.pendingCandidates = [];
      return;
    }
    for (const c of this.pendingCandidates) {
      this.pc.addIceCandidate(new RTCIceCandidate(c)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          console.warn('[PeerManager] Failed to add buffered ICE candidate', err);
        }
      });
    }
    this.pendingCandidates = [];
  }

  private handleICECandidateEvent(event: never): void {
    const candidate = (event as { candidate: { toJSON: () => IceCandidateInit } | null }).candidate;
    if (candidate) {
      this.send({
        type: 'new_ice_candidate',
        conversationId: this.conversationId,
        candidate: candidate.toJSON(),
      });
    }
  }

  private handleTrackEvent(event: never): void {
    const t = event as { streams: NativeMediaStream[]; track: unknown };
    const stream = t.streams[0];
    if (stream) {
      this.onRemoteStream(this.conversationId, stream);
    }
  }

  private handleNegotiationNeededEvent(): void {
    // Only the caller should create offers — callee sends answers only
    if (this.type !== PeerConnectionType.Caller) return;

    if (this.isNegotiating) {
      this.negotiationNeededAgain = true;
      return;
    }
    this.isNegotiating = true;

    void this.pc
      .createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(
        (offer): Promise<{ sdp?: string; type?: string }> =>
          this.pc.setLocalDescription(offer).then(() => offer),
      )
      .then((offer): void => {
        if (!offer.sdp) {
          throw new Error('Offer SDP is undefined');
        }
        this.send({ type: 'make_call', conversationId: this.conversationId, offer: offer.sdp });
      })
      .catch((err: unknown) => {
        console.warn('[PeerManager] Error during negotiation', err);
      })
      .finally(() => {
        this.isNegotiating = false;
        if (this.negotiationNeededAgain) {
          this.negotiationNeededAgain = false;
          this.handleNegotiationNeededEvent();
        }
      });
  }

  private handleICEConnectionStateChangeEvent(): void {
    const state = this.pc.iceConnectionState;
    console.info('[PeerManager] ICE connection state:', state);

    if (state === 'connected' || state === 'completed') {
      this.iceRestartAttempted = false;
    }

    if (
      state === 'failed' &&
      !this.iceRestartAttempted &&
      this.type === PeerConnectionType.Caller
    ) {
      this.iceRestartAttempted = true;
      console.info('[PeerManager] Attempting ICE restart');
      this.pc.restartIce();
      this.onIceConnectionStateChange?.('disconnected');
      return;
    }

    this.onIceConnectionStateChange?.(state);
    if (state === 'failed') {
      console.warn('[PeerManager] ICE connection failed');
    }
  }
}

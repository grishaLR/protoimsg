import type { ClientMessage, IceCandidateInit } from '@protoimsg/shared';
import { Sentry } from '../sentry';
import { createLogger } from './logger';

const log = createLogger('PeerManager');

export enum PeerConnectionType {
  Caller = 'caller',
  Callee = 'callee',
}

interface PeerConnectionConfig {
  config: RTCConfiguration;
  send: (msg: ClientMessage) => void;
  conversationId: string;
  onRemoteStream: (conversationId: string, stream: MediaStream) => void;
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  type: PeerConnectionType;
}

export class PeerManager {
  public pc: RTCPeerConnection;
  private send: (msg: ClientMessage) => void;
  private conversationId: string;
  private onRemoteStream: (conversationId: string, stream: MediaStream) => void;
  private onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  private type: PeerConnectionType;
  private pendingCandidates: IceCandidateInit[] = [];

  /** Negotiation mutex — prevents overlapping createOffer/setLocalDescription cycles */
  private isNegotiating = false;
  /** Set when onnegotiationneeded fires while a negotiation is already in progress */
  private negotiationNeededAgain = false;

  constructor(peerConfig: PeerConnectionConfig) {
    this.send = peerConfig.send;
    this.pc = new RTCPeerConnection(peerConfig.config);
    this.conversationId = peerConfig.conversationId;
    this.onRemoteStream = peerConfig.onRemoteStream;
    this.onIceConnectionStateChange = peerConfig.onIceConnectionStateChange;
    this.type = peerConfig.type;

    this.pc.onicecandidate = this.handleICECandidateEvent.bind(this);
    this.pc.ontrack = this.handleTrackEvent.bind(this);
    this.pc.onnegotiationneeded = this.handleNegotiationNeededEvent.bind(this);
    this.pc.oniceconnectionstatechange = this.handleICEConnectionStateChangeEvent.bind(this);
    this.pc.onicegatheringstatechange = this.handleICEGatheringStateChangeEvent.bind(this);
    this.pc.onsignalingstatechange = this.handleSignalingStateChangeEvent.bind(this);
  }

  /** Buffer ICE candidates until remote description is set, then flush */
  addBufferedCandidate(candidate: IceCandidateInit): void {
    if (this.pc.signalingState === 'closed') return;
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          log.error('Failed to add ICE candidate', err);
        }
      });
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  /** Flush buffered ICE candidates — call after setRemoteDescription */
  flushCandidates(): void {
    if (this.pc.signalingState === 'closed') {
      this.pendingCandidates = [];
      return;
    }
    for (const c of this.pendingCandidates) {
      this.pc.addIceCandidate(new RTCIceCandidate(c)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          log.error('Failed to add buffered ICE candidate', err);
        }
      });
    }
    this.pendingCandidates = [];
  }

  private handleICECandidateEvent(event: RTCPeerConnectionIceEvent): void {
    if (event.candidate) {
      this.send({
        type: 'new_ice_candidate',
        conversationId: this.conversationId,
        candidate: event.candidate.toJSON() as IceCandidateInit,
      });
    }
  }

  private handleTrackEvent(t: RTCTrackEvent): void {
    const stream = t.streams[0] ?? new MediaStream([t.track]);
    this.onRemoteStream(this.conversationId, stream);
  }

  private handleNegotiationNeededEvent(_: Event): void {
    // Only the caller should create offers — callee sends answers only
    if (this.type !== PeerConnectionType.Caller) return;

    // Serialize negotiation — rapid track additions can fire this multiple
    // times before the previous createOffer/setLocalDescription completes,
    // causing "wrong state" InvalidStateError.
    if (this.isNegotiating) {
      this.negotiationNeededAgain = true;
      return;
    }
    this.isNegotiating = true;

    void this.pc
      .createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      .then(
        (offer): Promise<RTCSessionDescriptionInit> =>
          this.pc.setLocalDescription(offer).then(() => offer),
      )
      .then((offer): void => {
        if (!offer.sdp) {
          throw new Error('Offer SDP is undefined');
        }
        this.send({ type: 'make_call', conversationId: this.conversationId, offer: offer.sdp });
      })
      .catch((err: unknown) => {
        log.error('Error during negotiation', err);
      })
      .finally(() => {
        this.isNegotiating = false;
        if (this.negotiationNeededAgain) {
          this.negotiationNeededAgain = false;
          this.handleNegotiationNeededEvent(new Event('negotiationneeded'));
        }
      });
  }

  private iceRestartAttempted = false;

  private handleICEConnectionStateChangeEvent(_e: Event): void {
    const state = this.pc.iceConnectionState;
    log.debug('ICE connection state: %s', state);

    if (state === 'connected' || state === 'completed') {
      // Reset restart flag on successful connection
      this.iceRestartAttempted = false;
    }

    if (
      state === 'failed' &&
      !this.iceRestartAttempted &&
      this.type === PeerConnectionType.Caller
    ) {
      // Attempt ICE restart before giving up
      this.iceRestartAttempted = true;
      log.info('Attempting ICE restart');
      this.pc.restartIce();
      // Notify UI that we're reconnecting, not failed yet
      this.onIceConnectionStateChange?.('disconnected');
      return;
    }

    this.onIceConnectionStateChange?.(state);
    if (state === 'failed') {
      log.warn('ICE connection failed');
      Sentry.captureMessage('WebRTC ICE connection failed', {
        level: 'warning',
        extra: { conversationId: this.conversationId, type: this.type },
      });
    }
  }

  private handleICEGatheringStateChangeEvent(_e: Event): void {
    log.debug('ICE gathering state: %s', this.pc.iceGatheringState);
  }

  private handleSignalingStateChangeEvent(_: Event): void {
    log.debug('Signaling state: %s', this.pc.signalingState);
  }
}

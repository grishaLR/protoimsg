/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-this-alias, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-non-null-assertion */
// react-native-webrtc native module crashes at import time when the native binary isn't
// linked (e.g. Expo Go). Lazy-require it only when creating a peer so the rest of the
// app works without the native build.
import type { ClientMessage, IceCandidateInit } from '@protoimsg/shared';

const DC_LABEL = 'im';
const KEEPALIVE_INTERVAL_MS = 30_000;

// Check for the native module BEFORE requiring the JS wrapper.
// require('react-native-webrtc') creates a NativeEventEmitter during module init,
// which throws an Invariant Violation if the native module is missing (Expo Go).
// NativeModules is always safe to access.
import { NativeModules } from 'react-native';

const _webrtcAvailable = NativeModules.WebRTCModule != null;

let _RTCPeerConnection: unknown = null;
let _RTCIceCandidate: unknown = null;
let _RTCSessionDescription: unknown = null;
let _mediaDevices: unknown = null;
let _RTCView: unknown = null;
let _loaded = false;

function getWebRTC() {
  if (!_webrtcAvailable) return null;
  if (!_loaded) {
    _loaded = true;
    const mod = require('react-native-webrtc');
    _RTCPeerConnection = mod.RTCPeerConnection;
    _RTCIceCandidate = mod.RTCIceCandidate;
    _RTCSessionDescription = mod.RTCSessionDescription;
    _mediaDevices = mod.mediaDevices;
    _RTCView = mod.RTCView;
  }
  return {
    RTCPeerConnection: _RTCPeerConnection as any,
    RTCIceCandidate: _RTCIceCandidate as any,
    RTCSessionDescription: _RTCSessionDescription as any,
    mediaDevices: _mediaDevices as any,
    RTCView: _RTCView as any,
  };
}

export { getWebRTC };

/** Returns true if react-native-webrtc native module is available (dev client build). */
export function isWebRTCAvailable(): boolean {
  return _webrtcAvailable;
}

/** Messages sent over the RTCDataChannel (JSON-encoded) */
export interface DcTextMessage {
  type: 'text';
  id: string;
  text: string;
  ts: string;
  facets?: unknown[];
  embed?: unknown;
}

export interface DcTypingMessage {
  type: 'typing';
}

export interface DcPingMessage {
  type: 'ping';
}

export type DcMessage = DcTextMessage | DcTypingMessage | DcPingMessage;

export type DataChannelState = 'connecting' | 'open' | 'closed' | 'failed';

// react-native-webrtc uses EventTarget from event-target-shim, so addEventListener
// exists at runtime but isn't visible to TS. We use this helper type to access it.
type Evented = {
  addEventListener: (type: string, handler: (event: never) => void) => void;
};

// Structural types for the native objects (avoids importing the module at top-level)
interface NativePeerConnection {
  localDescription: { sdp: string; type: string | null } | null;
  remoteDescription: unknown;
  signalingState: string;
  iceConnectionState: string;
  createOffer: (opts: Record<string, unknown>) => Promise<{ sdp?: string; type?: string }>;
  createAnswer: () => Promise<{ sdp?: string; type?: string }>;
  setLocalDescription: (desc: unknown) => Promise<void>;
  setRemoteDescription: (desc: unknown) => Promise<void>;
  addIceCandidate: (candidate: unknown) => Promise<void>;
  createDataChannel: (label: string, opts: { ordered?: boolean }) => NativeDataChannel;
  close: () => void;
}

interface NativeDataChannel {
  readyState: string;
  send: (data: string) => void;
  close: () => void;
}

export interface DataChannelPeerConfig {
  rtcConfig: {
    iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    iceTransportPolicy?: 'all' | 'relay';
  };
  conversationId: string;
  send: (msg: ClientMessage) => void;
  onMessage: (msg: DcTextMessage) => void;
  onTyping: () => void;
  onStateChange: (state: DataChannelState) => void;
  isCaller: boolean;
}

export class DataChannelPeer {
  public pc: NativePeerConnection;
  public readonly isCaller: boolean;
  private dc: NativeDataChannel | null = null;
  private _send: (msg: ClientMessage) => void;
  private conversationId: string;
  private onMessage: (msg: DcTextMessage) => void;
  private onTyping: () => void;
  private onStateChange: (state: DataChannelState) => void;
  private pendingCandidates: IceCandidateInit[] = [];
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _state: DataChannelState = 'connecting';

  get state(): DataChannelState {
    return this._state;
  }

  constructor(config: DataChannelPeerConfig) {
    const webrtc = getWebRTC();
    if (!webrtc) throw new Error('WebRTC native module not available — requires dev client build');
    const { RTCPeerConnection } = webrtc;

    this._send = config.send;
    this.conversationId = config.conversationId;
    this.onMessage = config.onMessage;
    this.onTyping = config.onTyping;
    this.onStateChange = config.onStateChange;
    this.isCaller = config.isCaller;

    this.pc = new RTCPeerConnection(config.rtcConfig) as unknown as NativePeerConnection;
    const pcEvt = this.pc as unknown as Evented;
    pcEvt.addEventListener('icecandidate', this.handleIceCandidate.bind(this));
    pcEvt.addEventListener(
      'iceconnectionstatechange',
      this.handleIceConnectionStateChange.bind(this),
    );

    if (config.isCaller) {
      this.dc = this.pc.createDataChannel(DC_LABEL, { ordered: true });
      this.setupDataChannel(this.dc);
    } else {
      const self = this;
      pcEvt.addEventListener('datachannel', (event: never) => {
        const ch = (event as { channel: NativeDataChannel }).channel;
        self.dc = ch;
        if (self.dc) self.setupDataChannel(self.dc);
      });
    }
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp) throw new Error('Offer SDP is undefined');
    this._send({ type: 'im_offer', conversationId: this.conversationId, offer: sdp });
  }

  async handleOffer(sdp: string): Promise<void> {
    const { RTCSessionDescription } = getWebRTC()!;
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    const answerSdp = this.pc.localDescription?.sdp;
    if (!answerSdp) throw new Error('Answer SDP is undefined');
    this._send({ type: 'im_answer', conversationId: this.conversationId, answer: answerSdp });
  }

  async handleAnswer(sdp: string): Promise<void> {
    const { RTCSessionDescription } = getWebRTC()!;
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    this.flushCandidates();
  }

  addBufferedCandidate(candidate: IceCandidateInit): void {
    const { RTCIceCandidate } = getWebRTC()!;
    if (this.pc.signalingState === 'closed') return;
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          console.warn('[DataChannelPeer] Failed to add ICE candidate', err);
        }
      });
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  flushCandidates(): void {
    const { RTCIceCandidate } = getWebRTC()!;
    if (this.pc.signalingState === 'closed') {
      this.pendingCandidates = [];
      return;
    }
    for (const c of this.pendingCandidates) {
      this.pc.addIceCandidate(new RTCIceCandidate(c)).catch((err: unknown) => {
        if (this.pc.signalingState !== 'closed') {
          console.warn('[DataChannelPeer] Failed to add buffered ICE candidate', err);
        }
      });
    }
    this.pendingCandidates = [];
  }

  sendMessage(msg: DcTextMessage): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(msg));
    return true;
  }

  sendTyping(): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify({ type: 'typing' }));
    return true;
  }

  close(): void {
    this.stopKeepalive();
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    this.pc.close();
    this.updateState('closed');
  }

  private setupDataChannel(dc: NativeDataChannel): void {
    const dcEvt = dc as unknown as Evented;
    dcEvt.addEventListener('open', () => {
      console.info('[DataChannelPeer] Data channel open for', this.conversationId);
      this.updateState('open');
      this.startKeepalive();
    });
    dcEvt.addEventListener('close', () => {
      console.info('[DataChannelPeer] Data channel closed for', this.conversationId);
      this.stopKeepalive();
      this.updateState('closed');
    });
    dcEvt.addEventListener('error', () => {
      console.warn('[DataChannelPeer] Data channel error');
      this.stopKeepalive();
      this.pc.close();
      this.updateState('failed');
    });
    dcEvt.addEventListener('message', (event: never) => {
      try {
        const msg = JSON.parse((event as { data: string }).data) as DcMessage;
        switch (msg.type) {
          case 'text':
            this.onMessage(msg);
            break;
          case 'typing':
            this.onTyping();
            break;
          case 'ping':
            break;
        }
      } catch (err) {
        console.warn('[DataChannelPeer] Failed to parse data channel message', err);
      }
    });
  }

  private handleIceCandidate(event: never): void {
    const candidate = (event as { candidate: { toJSON: () => IceCandidateInit } | null }).candidate;
    if (candidate) {
      this._send({
        type: 'im_ice_candidate',
        conversationId: this.conversationId,
        candidate: candidate.toJSON(),
      });
    }
  }

  private handleIceConnectionStateChange(): void {
    const state = this.pc.iceConnectionState;
    if (state === 'failed') {
      console.warn('[DataChannelPeer] ICE connection failed for data channel');
      this.updateState('failed');
    }
  }

  private updateState(state: DataChannelState): void {
    if (this._state === state) return;
    this._state = state;
    this.onStateChange(state);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.dc?.readyState === 'open') {
        this.dc.send(JSON.stringify({ type: 'ping' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}

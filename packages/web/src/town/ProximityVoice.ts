import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteTrack,
  type VideoTrack,
} from 'livekit-client';
import type { TownProximityEvent } from '@protoimsg/shared';

type VoiceRoom = NonNullable<TownProximityEvent['data']['room']>;

/** One camera feed in your conversation (yours or a mesh member's). */
export interface ProximityVideo {
  key: string;
  did: string;
  track: VideoTrack;
  local: boolean;
}

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

/**
 * Proximity voice for proto town. The server decides who shares a room (the
 * aura cluster); this follows its assignments — joining, switching or leaving
 * the LiveKit room — and plays everyone's mic audio, plus camera video for
 * anyone who turns theirs on.
 *
 * Every assignment takes a sequence number synchronously; after each await we
 * bail if a newer assignment (or destroy) has happened, so a slow connect can
 * never leave you in a stale room or with a hot mic after leaving town.
 */
export class ProximityVoice {
  private room: Room | null = null;
  private roomId: string | null = null;
  private selfPid: string | null = null;
  private pidToDid = new Map<string, string>();
  private audioEls = new Set<HTMLMediaElement>();
  private micEnabled: boolean;
  /** Per conversation only — always starts off, and leaving the room turns it off. */
  private cameraOn = false;
  private seq = 0;
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_BASE_MS;

  /** Unique DIDs in your cluster (including you), or [] when nobody is near. */
  onMembersChange?: (dids: string[]) => void;
  /** DIDs currently speaking in your cluster. */
  onSpeakingChange?: (dids: Set<string>) => void;
  /** The browser blocked autoplay — call startAudio() from a user gesture. */
  onAudioBlockedChange?: (blocked: boolean) => void;
  /** Your mic is being published to the people around you right now. */
  onLiveChange?: (live: boolean) => void;
  /** Mic permission was denied or no device is available. */
  onMicError?: () => void;
  /** Connection lost or failed — ask the server for a fresh token. */
  onRequestRefresh?: () => void;
  /** Camera feeds currently showing in your conversation. */
  onVideoChange?: (videos: ProximityVideo[]) => void;
  /** Your camera turned on/off (including automatically when the conversation ends). */
  onCameraChange?: (on: boolean) => void;
  /** Camera permission was denied or no device is available. */
  onCameraError?: () => void;

  constructor(
    private audioHost: HTMLElement,
    private selfDid: string,
    micEnabled: boolean,
  ) {
    this.micEnabled = micEnabled;
  }

  async assign(next: VoiceRoom | null): Promise<void> {
    if (this.destroyed) return;
    const seq = ++this.seq;
    this.clearRetry();

    if (!next) {
      this.pidToDid.clear();
      this.onMembersChange?.([]);
      await this.leaveRoom();
      return;
    }

    this.pidToDid = new Map(next.members.map((m) => [m.pid, m.did]));
    this.onMembersChange?.([...new Set(next.members.map((m) => m.did))]);

    // Same room, same identity, still alive → roster refresh only.
    const state = this.room?.state;
    if (
      this.room &&
      next.roomId === this.roomId &&
      next.selfPid === this.selfPid &&
      state !== ConnectionState.Disconnected
    ) {
      this.applyPermissions(this.room);
      this.emitVideo();
      return;
    }

    await this.leaveRoom();
    if (this.isStale(seq)) return;

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      // GainNode volume — HTMLMediaElement.volume is ignored on iOS.
      webAudioMix: true,
      // "Mic off" must release the device, not just mute it.
      publishDefaults: { stopMicTrackOnMute: true },
      // Small tiles — no need to burn bandwidth on HD.
      videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
    });
    this.room = room;
    this.roomId = next.roomId;
    this.selfPid = next.selfPid;
    this.bindRoomEvents(room);

    try {
      await room.connect(next.url, next.token);
    } catch {
      if (this.room === room) {
        this.room = null;
        this.roomId = null;
        this.scheduleRetry();
      }
      return;
    }
    if (this.isStale(seq) || this.room !== room) {
      room.removeAllListeners();
      await room.disconnect();
      return;
    }
    this.retryDelay = RETRY_BASE_MS;
    this.applyPermissions(room);
    this.onAudioBlockedChange?.(!room.canPlaybackAudio);
    if (this.micEnabled) await this.publishMic(room, seq);
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
    const room = this.room;
    if (room?.state === ConnectionState.Connected) {
      if (enabled) {
        await this.publishMic(room, this.seq);
      } else {
        await room.localParticipant.setMicrophoneEnabled(false);
        this.onLiveChange?.(false);
      }
      return;
    }
    if (!enabled) return;
    // Not near anyone yet — ask for permission now, inside the click, so the
    // prompt doesn't ambush you the moment someone walks up.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
    } catch {
      this.micEnabled = false;
      this.onMicError?.();
    }
  }

  /**
   * Turn your camera on/off for the current conversation. Only works while
   * you're in one — there's nobody to show it to otherwise.
   */
  async setCameraEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (room?.state !== ConnectionState.Connected) return;
    const seq = this.seq;
    if (!on) {
      this.setCameraState(false);
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      this.emitVideo();
      return;
    }
    try {
      await room.localParticipant.setCameraEnabled(true);
    } catch {
      this.setCameraState(false);
      this.onCameraError?.();
      return;
    }
    // Conversation changed while the camera was starting — don't leave it on.
    if (this.isStale(seq) || this.room !== room) {
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      return;
    }
    this.setCameraState(true);
    this.emitVideo();
  }

  /** Per-member volume (0–1), e.g. by distance. Called on an interval. */
  setVolumes(volumeFor: (did: string) => number): void {
    const room = this.room;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) {
      const did = this.pidToDid.get(p.identity);
      // Unknown pids and your own other tabs stay silent (no echo).
      p.setVolume(did && did !== this.selfDid ? volumeFor(did) : 0);
    }
  }

  /** Resume playback after an autoplay block. Must run in a user gesture. */
  async startAudio(): Promise<void> {
    const room = this.room;
    if (room && !room.canPlaybackAudio) await room.startAudio();
  }

  destroy(): void {
    this.destroyed = true;
    this.seq++;
    this.clearRetry();
    this.onMembersChange = undefined;
    this.onSpeakingChange = undefined;
    this.onAudioBlockedChange = undefined;
    this.onLiveChange = undefined;
    this.onMicError = undefined;
    this.onRequestRefresh = undefined;
    this.onVideoChange = undefined;
    this.onCameraChange = undefined;
    this.onCameraError = undefined;
    void this.leaveRoom();
  }

  private bindRoomEvents(room: Room): void {
    // Every handler ignores a room we've already moved on from.
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (this.room !== room) return;
        if (track.kind === Track.Kind.Video) {
          this.emitVideo();
          return;
        }
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        this.audioHost.appendChild(el);
        this.audioEls.add(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video) {
          if (this.room === room) this.emitVideo();
          return;
        }
        for (const el of track.detach()) {
          el.remove();
          this.audioEls.delete(el);
        }
      })
      .on(RoomEvent.TrackMuted, () => {
        if (this.room === room) this.emitVideo();
      })
      .on(RoomEvent.TrackUnmuted, () => {
        if (this.room === room) this.emitVideo();
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        if (this.room === room) this.emitVideo();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (this.room !== room) return;
        const dids = new Set<string>();
        for (const s of speakers) {
          const did = this.pidToDid.get(s.identity);
          if (did) dids.add(did);
        }
        this.onSpeakingChange?.(dids);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (this.room !== room) return;
        this.onAudioBlockedChange?.(!room.canPlaybackAudio);
      })
      .on(RoomEvent.Disconnected, () => {
        // Unexpected drop (kicked on WS reconnect, network) — not our leave,
        // which detaches the room first.
        if (this.room !== room) return;
        this.room = null;
        this.roomId = null;
        this.clearAudio();
        this.clearVideo();
        this.onLiveChange?.(false);
        this.scheduleRetry();
      });
  }

  /**
   * Only roster members may subscribe to your tracks. LiveKit tokens can't be
   * revoked, so this stops anyone the server evicted (who reconnects with an
   * old token) from hearing you before the server reconciles them out.
   */
  private applyPermissions(room: Room): void {
    if (room.state !== ConnectionState.Connected) return;
    const allowed = [...this.pidToDid.keys()]
      .filter((pid) => pid !== this.selfPid)
      .map((pid) => ({ participantIdentity: pid, allowAll: true }));
    room.localParticipant.setTrackSubscriptionPermissions(false, allowed);
  }

  private async publishMic(room: Room, seq: number): Promise<void> {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      this.micEnabled = false;
      this.onMicError?.();
      return;
    }
    // Superseded while the device was opening — don't leave a hot mic.
    if (this.isStale(seq) || this.room !== room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      return;
    }
    this.onLiveChange?.(true);
  }

  private setCameraState(on: boolean): void {
    if (this.cameraOn === on) return;
    this.cameraOn = on;
    this.onCameraChange?.(on);
  }

  /** Rebuild the list of visible camera feeds: yours, then each roster member's. */
  private emitVideo(): void {
    const room = this.room;
    if (!room) {
      this.onVideoChange?.([]);
      return;
    }
    const videos: ProximityVideo[] = [];
    const own = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (this.cameraOn && own?.videoTrack && !own.isMuted) {
      videos.push({ key: 'self', did: this.selfDid, track: own.videoTrack, local: true });
    }
    for (const p of room.remoteParticipants.values()) {
      const did = this.pidToDid.get(p.identity);
      // Only roster members, and never your own other tab.
      if (!did || did === this.selfDid) continue;
      const pub = p.getTrackPublication(Track.Source.Camera);
      if (pub?.videoTrack && pub.isSubscribed && !pub.isMuted) {
        videos.push({ key: p.identity, did, track: pub.videoTrack, local: false });
      }
    }
    this.onVideoChange?.(videos);
  }

  private clearVideo(): void {
    this.setCameraState(false);
    this.onVideoChange?.([]);
  }

  /** A newer assignment (or destroy) happened while we were awaiting. */
  private isStale(seq: number): boolean {
    return seq !== this.seq || this.destroyed;
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.onRequestRefresh?.();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearAudio(): void {
    for (const el of this.audioEls) el.remove();
    this.audioEls.clear();
    this.onSpeakingChange?.(new Set());
    this.onAudioBlockedChange?.(false);
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.roomId = null;
    this.selfPid = null;
    this.clearAudio();
    // The conversation is over (or changing) — your camera goes off with it.
    this.clearVideo();
    this.onLiveChange?.(false);
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
  }
}

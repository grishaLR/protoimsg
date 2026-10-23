import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalVideoTrack,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type TrackPublication,
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
  /** Camera is live (published, unmuted). Per conversation only — always starts off. */
  private cameraOn = false;
  /** What the user asked for; a start in flight checks this before going live. */
  private cameraWanted = false;
  /** A camera track created but not yet published — stopped if we leave first. */
  private pendingCamera: LocalVideoTrack | null = null;
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
  /**
   * Your camera turned on/off. `reason` says why when it went off on its own:
   * someone new joined, or the conversation ended/changed.
   */
  onCameraChange?: (on: boolean, reason?: 'joined' | 'ended') => void;
  /** Camera permission was denied or no device is available. */
  onCameraError?: () => void;
  /** A camera start is in flight (asked for, not live yet). */
  onCameraPendingChange?: (pending: boolean) => void;
  private cameraPending = false;
  /** Bumped per camera start; only the latest start may settle the state. */
  private cameraStart = 0;

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

    const before = new Set(this.pidToDid.keys());
    this.pidToDid = new Map(next.members.map((m) => [m.pid, m.did]));
    this.onMembersChange?.([...new Set(next.members.map((m) => m.did))]);

    // Same room, same identity, still alive → roster refresh only.
    const room0 = this.room;
    if (
      room0 &&
      next.roomId === this.roomId &&
      next.selfPid === this.selfPid &&
      room0.state !== ConnectionState.Disconnected
    ) {
      // Someone new is joining the conversation: your camera goes off BEFORE
      // they're allowed to subscribe — they never see video you didn't
      // choose to show them.
      const joined = next.members.some(
        (m) => m.pid !== next.selfPid && m.did !== this.selfDid && !before.has(m.pid),
      );
      if (joined && (this.cameraOn || this.cameraWanted)) await this.stopCamera(room0, 'joined');
      this.applyPermissions(room0);
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
   * Turn your camera on/off for the current conversation. Turning it on only
   * works while connected (there's nobody to show it to otherwise); turning it
   * off always works, whatever state the connection is in.
   */
  async setCameraEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!on) {
      if (room) await this.stopCamera(room);
      else this.setWanted(false);
      return;
    }
    if (room?.state !== ConnectionState.Connected) return;
    this.setWanted(true);
    const seq = this.seq;
    const start = ++this.cameraStart;
    const live = (): boolean =>
      !this.isStale(seq) && this.room === room && this.cameraWanted && start === this.cameraStart;
    try {
      await this.startCamera(room, live);
    } finally {
      // An overtaken or failed start must not leave the button stuck on "starting".
      if (start === this.cameraStart && !this.cameraOn) this.setWanted(false);
    }
  }

  private async startCamera(room: Room, live: () => boolean): Promise<void> {
    const existing = room.localParticipant.getTrackPublication(Track.Source.Camera);
    try {
      if (existing?.track) {
        await room.localParticipant.setCameraEnabled(true);
      } else {
        // Create the track ourselves so a start that's overtaken (left the
        // conversation, clicked off again) can stop the device immediately.
        const track = await createLocalVideoTrack({
          resolution: VideoPresets.h360.resolution,
        });
        if (!live()) {
          track.stop();
          return;
        }
        this.pendingCamera = track;
        try {
          await room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
        } finally {
          if (this.pendingCamera === track) this.pendingCamera = null;
        }
        if (!live()) {
          await room.localParticipant.unpublishTrack(track).catch(() => undefined);
          track.stop();
          return;
        }
      }
    } catch (err) {
      // Only a real permission/device failure is worth telling the user about.
      if (live()) {
        this.setWanted(false);
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'NotFoundError') this.onCameraError?.();
      }
      return;
    }
    if (!live()) {
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      return;
    }
    this.setCameraState(true);
    this.emitVideo();
  }

  /** Flip the camera from what the user last asked for — safe to spam-click. */
  toggleCamera(): Promise<void> {
    return this.setCameraEnabled(!(this.cameraOn || this.cameraWanted));
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
    this.onCameraPendingChange = undefined;
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
      .on(RoomEvent.TrackMuted, (pub: TrackPublication, participant: Participant) => {
        if (this.room !== room) return;
        // Your own camera stopped outside our control (unplugged, OS revoked,
        // backgrounded) — don't keep claiming it's on.
        if (participant === room.localParticipant && pub.source === Track.Source.Camera) {
          this.setWanted(false);
          this.setCameraState(false);
        }
        this.emitVideo();
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub: TrackPublication) => {
        if (this.room !== room || pub.source !== Track.Source.Camera) return;
        this.setWanted(false);
        this.setCameraState(false);
        this.emitVideo();
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
    // LiveKit stores the list and (re)sends it once connected — don't skip it
    // while reconnecting, or an evicted pid keeps access after resume.
    if (room.state === ConnectionState.Disconnected) return;
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

  private setCameraState(on: boolean, reason?: 'joined' | 'ended'): void {
    if (this.cameraOn !== on) {
      this.cameraOn = on;
      this.onCameraChange?.(on, reason);
    }
    this.syncPending();
  }

  private setWanted(wanted: boolean): void {
    this.cameraWanted = wanted;
    this.syncPending();
  }

  private syncPending(): void {
    const pending = this.cameraWanted && !this.cameraOn;
    if (pending === this.cameraPending) return;
    this.cameraPending = pending;
    this.onCameraPendingChange?.(pending);
  }

  /** Camera off now: cancel any start in flight and release the device. */
  private async stopCamera(room: Room, reason?: 'joined' | 'ended'): Promise<void> {
    this.setWanted(false);
    this.pendingCamera?.stop();
    this.pendingCamera = null;
    this.setCameraState(false, reason);
    // Muting a camera stops its MediaStreamTrack locally, signal or not.
    await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
    this.emitVideo();
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
    this.setWanted(false);
    this.pendingCamera?.stop();
    this.pendingCamera = null;
    this.setCameraState(false, 'ended');
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

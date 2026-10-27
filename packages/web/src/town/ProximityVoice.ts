import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalVideoTrack,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
  type VideoTrack,
} from 'livekit-client';
import type { TownProximityEvent, TownVoiceRoomEvent } from '@protoimsg/shared';
import { Sentry } from '../sentry';

type VoiceRoom = NonNullable<TownVoiceRoomEvent['data']['voice']>;
type Conversation = NonNullable<TownProximityEvent['data']['conversation']>;

/** One camera feed in your conversation (yours or a mesh member's). */
export interface ProximityVideo {
  key: string;
  did: string;
  track: VideoTrack;
  local: boolean;
  /** The server paused this feed (congestion) — show a notice, not a frozen frame. */
  paused: boolean;
}

/**
 * Where your voice connection stands. `off` until you join audio; then the
 * real LiveKit state — never inferred from who's nearby.
 */
export type VoiceStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
/** Still not connected after this long: say so, and offer "Reconnect". */
const CONNECT_TIMEOUT_MS = 15_000;
/** Still reconnecting after this long: drop the room and fetch a fresh one. */
const RECONNECT_TIMEOUT_MS = 15_000;

/**
 * One AudioContext for every voice room this page ever joins. A context made
 * outside a click starts suspended on Safari (and sometimes Chrome), and
 * LiveKit's default makes a new one per room — so every new conversation
 * used to come up silent until you happened to click again. This one is
 * unlocked by your first click or keypress in town and stays unlocked.
 */
let sharedAudioContext: AudioContext | null = null;

function townAudioContext(): AudioContext | null {
  if (sharedAudioContext?.state !== 'closed' && sharedAudioContext) return sharedAudioContext;
  try {
    sharedAudioContext = new AudioContext({ latencyHint: 'interactive' });
  } catch {
    sharedAudioContext = null;
  }
  return sharedAudioContext;
}

/** Resume town audio. Must run inside a user gesture to lift an autoplay block. */
export function unlockTownAudio(): void {
  const ctx = townAudioContext();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/**
 * Proximity voice for proto town, Gather-style. Everyone who joined audio in
 * a scene shares ONE LiveKit room for as long as they're in it; the server
 * decides your conversation (the aura cluster), and this only changes who may
 * hear whom — track permissions and subscriptions — never the connection.
 * Walking away and back is instant: nothing reconnects.
 *
 * Privacy: you grant your tracks only to your current conversation's
 * identities, and subscribe only to theirs. Others in the scene's room see
 * an anonymous identity, never your audio or video.
 *
 * After each await we bail if we've since left that room (another room, no
 * room, or destroy), so a slow connect can never leave you in a stale room or
 * with a hot mic after leaving town.
 */
export class ProximityVoice {
  private room: Room | null = null;
  private roomName: string | null = null;
  private selfPidValue: string | null = null;
  /** The last assignment, kept so a failure can be retried. */
  private assignment: VoiceRoom | null = null;
  private joined = false;
  private status: VoiceStatus = 'off';
  /** Your conversation: other people's identities → DIDs (yourself excluded). */
  private pidToDid = new Map<string, string>();
  private conversationId: string | null = null;
  private audioEls = new Set<HTMLMediaElement>();
  private micEnabled: boolean;
  /** Mic changes run one at a time, each re-reading the latest wish. */
  private micChain: Promise<void> = Promise.resolve();
  /** Camera is live (published, unmuted). Per conversation only — always starts off. */
  private cameraOn = false;
  /** What the user asked for; a start in flight checks this before going live. */
  private cameraWanted = false;
  /** A camera track created but not yet published — stopped if we leave first. */
  private pendingCamera: LocalVideoTrack | null = null;
  /** Remote camera feeds the server has paused, by participant identity. */
  private pausedVideo = new Set<string>();
  private prepared = false;
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_BASE_MS;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** A failure was already sent to Sentry since the last good connection. */
  private reported = false;
  /** Roster changes apply one at a time (camera-off must finish before new grants). */
  private rosterChain: Promise<void> = Promise.resolve();
  private onContextState = (): void => {
    this.emitAudioBlocked();
  };

  /** Unique DIDs in your conversation (including you), or [] when nobody is near. */
  onMembersChange?: (dids: string[]) => void;
  /** Whether you chose "stay together" in this conversation (from the server). */
  onStayChange?: (stay: boolean) => void;
  /** DIDs currently speaking in your conversation. */
  onSpeakingChange?: (dids: Set<string>) => void;
  /** The browser blocked autoplay — call startAudio() from a user gesture. */
  onAudioBlockedChange?: (blocked: boolean) => void;
  /** Your mic is being sent to the people around you right now. */
  onLiveChange?: (live: boolean) => void;
  /** Mic permission was denied or no device is available. */
  onMicError?: () => void;
  /** Connection lost or failed — ask the server for a fresh token. */
  onRequestRefresh?: () => void;
  /** The real voice connection state. */
  onStatusChange?: (status: VoiceStatus) => void;
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
    townAudioContext()?.addEventListener('statechange', this.onContextState);
  }

  /** Your identity in the scene's voice room — sent on reconnect to resume it. */
  get selfPid(): string | null {
    return this.selfPidValue;
  }

  /** You joined (or left) audio. Leaving drops the voice connection. */
  setJoined(joined: boolean): void {
    if (this.destroyed || this.joined === joined) return;
    this.joined = joined;
    if (joined) {
      this.setStatus('connecting');
      return;
    }
    this.clearRetry();
    this.assignment = null;
    this.leaveRoom();
    this.setStatus('off');
  }

  /** The server's scene voice assignment (`town_voice_room`). */
  async setVoiceRoom(next: VoiceRoom | null): Promise<void> {
    if (this.destroyed) return;
    this.clearRetry();
    this.assignment = next;
    if (!next) {
      this.leaveRoom();
      this.setStatus(this.joined ? 'connecting' : 'off');
      return;
    }
    if (!this.joined) return;

    // Same room, same identity, still alive: a fresh token we don't need.
    // A room stuck reconnecting isn't alive — take the fresh token instead.
    const cur = this.room;
    if (
      cur &&
      next.room === this.roomName &&
      next.selfPid === this.selfPidValue &&
      (cur.state === ConnectionState.Connected || cur.state === ConnectionState.Connecting)
    ) {
      return;
    }

    this.leaveRoom();
    const ctx = townAudioContext();
    const room = new Room({
      // Only stream video that's actually on screen, at the size it's shown:
      // hidden feeds cost nothing, small tiles get the small layer.
      adaptiveStream: true,
      dynacast: true,
      // GainNode volume — HTMLMediaElement.volume is ignored on iOS. The
      // shared context stays unlocked across rooms (see townAudioContext).
      webAudioMix: ctx ? { audioContext: ctx } : true,
      // "Mic off" must release the device, not just mute it.
      publishDefaults: { stopMicTrackOnMute: true },
      // Small tiles — no need to burn bandwidth on HD.
      videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
    });
    this.room = room;
    this.roomName = next.room;
    this.selfPidValue = next.selfPid;
    this.bindRoomEvents(room);
    this.setStatus('connecting');

    try {
      // ICE servers come from LiveKit itself (incl. its TURN/TLS fallback) —
      // passing our own would replace them, not add to them.
      await room.connect(next.url, next.token, {
        // Nothing is heard until it's your conversation's — subscriptions
        // follow the roster (applySubscriptions).
        autoSubscribe: false,
      });
    } catch (err) {
      if (this.room === room) {
        this.room = null;
        this.roomName = null;
        this.setStatus('failed');
        this.reportOnce('connect failed', err);
        this.scheduleRetry();
      }
      return;
    }
    if (this.isStale(room)) {
      room.removeAllListeners();
      await room.disconnect();
      return;
    }
    this.retryDelay = RETRY_BASE_MS;
    this.reported = false;
    this.setStatus('connected');
    // The roster may have changed while connecting — apply the latest.
    this.syncRoster(room);
    this.emitAudioBlocked();
  }

  /** The server's conversation roster (`town_proximity`). Applied in order. */
  setConversation(conv: Conversation | null): Promise<void> {
    this.rosterChain = this.rosterChain.then(() => this.applyConversation(conv));
    return this.rosterChain;
  }

  private async applyConversation(conv: Conversation | null): Promise<void> {
    if (this.destroyed) return;
    const before = new Set(this.pidToDid.keys());
    this.conversationId = conv?.id ?? null;
    this.pidToDid = new Map(
      (conv?.members ?? [])
        .filter((m) => m.pid && m.pid !== this.selfPidValue && m.did !== this.selfDid)
        .map((m) => [m.pid, m.did]),
    );
    this.onMembersChange?.(conv ? [...new Set(conv.members.map((m) => m.did))] : []);
    this.onStayChange?.(conv?.members.some((m) => m.did === this.selfDid && m.stay) ?? false);

    const room = this.room;
    if (!conv) {
      // The conversation is over — your camera goes off with it.
      if (room && (this.cameraOn || this.cameraWanted)) await this.stopCamera(room, 'ended');
    } else {
      // Someone new can hear you: your camera goes off BEFORE they're allowed
      // to subscribe — they never see video you didn't choose to show them.
      const joined = [...this.pidToDid.keys()].some((pid) => !before.has(pid));
      if (joined && room && (this.cameraOn || this.cameraWanted)) {
        await this.stopCamera(room, 'joined');
      }
    }
    if (this.room) this.syncRoster(this.room);
    else this.emitVideo();
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
    const room = this.room;
    if (room?.state === ConnectionState.Connected) {
      this.syncMic(room);
      await this.micChain;
      return;
    }
    if (!enabled) return;
    // Not connected yet — ask for permission now, inside the click, so the
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
   * works while connected and in a conversation (there's nobody to show it to
   * otherwise); turning it off always works.
   */
  async setCameraEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!on) {
      if (room) await this.stopCamera(room);
      else this.setWanted(false);
      return;
    }
    if (room?.state !== ConnectionState.Connected || !this.conversationId) return;
    this.setWanted(true);
    const start = ++this.cameraStart;
    const convo = this.conversationId;
    const live = (): boolean =>
      !this.isStale(room) &&
      this.cameraWanted &&
      start === this.cameraStart &&
      this.conversationId === convo;
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
        if (!live()) {
          // Re-enabling reopened the device; don't leave the light on.
          existing.track.stop();
          return;
        }
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
          // Single layer: the server couldn't repair loss on the top simulcast
          // layer (no RTX), which froze video on lossy Wi-Fi. Small clusters
          // don't need simulcast anyway.
          await room.localParticipant.publishTrack(track, {
            source: Track.Source.Camera,
            simulcast: false,
            videoEncoding: { maxBitrate: 450_000, maxFramerate: 24 },
          });
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

  /**
   * Warm up the LiveKit connection (DNS, TLS, region lookup) so joining
   * connects faster. Safe to call repeatedly.
   */
  prepare(url: string): void {
    if (this.prepared || this.destroyed) return;
    this.prepared = true;
    void new Room().prepareConnection(url).catch(() => undefined);
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
      // Anyone outside your conversation stays silent (they aren't subscribed
      // anyway — this is belt and braces).
      p.setVolume(did ? volumeFor(did) : 0);
    }
  }

  /** Resume playback after an autoplay block. Must run in a user gesture. */
  async startAudio(): Promise<void> {
    unlockTownAudio();
    const room = this.room;
    if (room && !room.canPlaybackAudio) await room.startAudio();
    this.emitAudioBlocked();
  }

  /**
   * "Reconnect voice": throw away the connection and ask for a fresh one —
   * what leaving town and coming back used to be needed for. Run it in the
   * click (it also unlocks audio).
   */
  reconnect(): void {
    if (this.destroyed || !this.joined) return;
    unlockTownAudio();
    this.clearRetry();
    this.retryDelay = RETRY_BASE_MS;
    this.reported = false;
    this.leaveRoom();
    this.setStatus('connecting');
    this.onRequestRefresh?.();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearRetry();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    townAudioContext()?.removeEventListener('statechange', this.onContextState);
    this.onMembersChange = undefined;
    this.onStayChange = undefined;
    this.onSpeakingChange = undefined;
    this.onAudioBlockedChange = undefined;
    this.onLiveChange = undefined;
    this.onMicError = undefined;
    this.onRequestRefresh = undefined;
    this.onStatusChange = undefined;
    this.onVideoChange = undefined;
    this.onCameraChange = undefined;
    this.onCameraError = undefined;
    this.onCameraPendingChange = undefined;
    this.leaveRoom();
  }

  private bindRoomEvents(room: Room): void {
    // Every handler ignores a room we've already moved on from.
    room
      .on(RoomEvent.TrackPublished, (_pub: RemoteTrackPublication, p: RemoteParticipant) => {
        if (this.room === room) this.applySubscriptions(p);
      })
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
      .on(
        RoomEvent.TrackStreamStateChanged,
        (pub: RemoteTrackPublication, state: Track.StreamState, participant: Participant) => {
          if (this.room !== room || pub.source !== Track.Source.Camera) return;
          if (state === Track.StreamState.Paused) this.pausedVideo.add(participant.identity);
          else this.pausedVideo.delete(participant.identity);
          this.emitVideo();
        },
      )
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (this.room !== room) return;
        const dids = new Set<string>();
        for (const s of speakers) {
          if (s.identity === this.selfPidValue) {
            dids.add(this.selfDid);
            continue;
          }
          // Speaking indicators are room-wide: show only your conversation.
          const did = this.pidToDid.get(s.identity);
          if (did) dids.add(did);
        }
        this.onSpeakingChange?.(dids);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (this.room === room) this.emitAudioBlocked();
      })
      .on(RoomEvent.Reconnecting, () => {
        if (this.room === room) this.setStatus('reconnecting');
      })
      .on(RoomEvent.Reconnected, () => {
        if (this.room !== room) return;
        this.setStatus('connected');
        this.syncRoster(room);
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        // Unexpected drop (evicted, network, server restart) — not our leave,
        // which detaches the room first.
        if (this.room !== room) return;
        this.room = null;
        this.roomName = null;
        this.clearAudio();
        this.clearVideo();
        this.onLiveChange?.(false);
        // The server took us out (walked through a door, identity replaced):
        // a new token is on its way — not a failure. The connect timeout
        // still catches one that never comes.
        if (
          reason === DisconnectReason.PARTICIPANT_REMOVED ||
          reason === DisconnectReason.ROOM_DELETED
        ) {
          this.setStatus('connecting');
          return;
        }
        this.setStatus('failed');
        Sentry.addBreadcrumb({
          category: 'town.voice',
          message: 'disconnected',
          data: { reason: reason !== undefined ? DisconnectReason[reason] : 'unknown' },
        });
        this.scheduleRetry();
      });
  }

  /** Permissions, subscriptions and mic to match the current conversation. */
  private syncRoster(room: Room): void {
    if (room.state === ConnectionState.Disconnected) return;
    this.applyPermissions(room);
    for (const p of room.remoteParticipants.values()) this.applySubscriptions(p);
    this.syncMic(room);
    this.emitVideo();
  }

  /**
   * Only your conversation may subscribe to your tracks. The server decides
   * who that is; LiveKit enforces it, so nobody else in the scene's room
   * hears or sees you whatever their client does.
   */
  private applyPermissions(room: Room): void {
    room.localParticipant.setTrackSubscriptionPermissions(
      false,
      [...this.pidToDid.keys()].map((pid) => ({ participantIdentity: pid, allowAll: true })),
    );
  }

  /** Subscribe to your conversation's tracks, and only theirs. */
  private applySubscriptions(p: RemoteParticipant): void {
    const wanted = this.pidToDid.has(p.identity);
    for (const pub of p.trackPublications.values()) {
      if (pub.isDesired !== wanted) pub.setSubscribed(wanted);
    }
  }

  /**
   * Send your mic only while someone in your conversation can hear it, and
   * release the device otherwise. Queued, and each step re-reads the latest
   * wish, so rapid roster changes always settle on the right state.
   */
  private syncMic(room: Room): void {
    this.micChain = this.micChain.then(async () => {
      if (this.isStale(room) || room.state !== ConnectionState.Connected) return;
      const want = this.micEnabled && this.pidToDid.size > 0;
      if (room.localParticipant.isMicrophoneEnabled === want) {
        this.onLiveChange?.(want);
        return;
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(want);
      } catch (err) {
        // The room went away mid-change — not a device problem.
        if (this.isStale(room)) {
          releaseDevice(room, Track.Source.Microphone);
          return;
        }
        if (want) {
          this.micEnabled = false;
          this.onMicError?.();
          this.reportOnce('mic failed', err);
        }
        this.onLiveChange?.(false);
        return;
      }
      // Left while the device was (re)opening: it may be live but unpublished
      // — stop it, or the OS mic indicator stays on with nobody listening.
      if (this.isStale(room)) {
        releaseDevice(room, Track.Source.Microphone);
        return;
      }
      this.onLiveChange?.(want);
    });
  }

  private setStatus(status: VoiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (status === 'connecting') {
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (this.status === 'connecting' && this.joined && !this.destroyed) {
          this.setStatus('failed');
        }
      }, CONNECT_TIMEOUT_MS);
    } else if (status === 'reconnecting') {
      // LiveKit's own reconnect can hang (e.g. an ICE restart on a closed
      // peer connection) without ever firing Disconnected — give up on the
      // room ourselves and ask for a fresh one.
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (this.status === 'reconnecting' && this.joined && !this.destroyed) {
          this.abandonStuckRoom();
        }
      }, RECONNECT_TIMEOUT_MS);
    }
    this.onStatusChange?.(status);
  }

  private abandonStuckRoom(): void {
    Sentry.addBreadcrumb({
      category: 'town.voice',
      message: 'reconnect timed out',
      data: { room: this.roomName },
    });
    this.leaveRoom();
    this.setStatus('failed');
    this.scheduleRetry();
  }

  /** Persistent failures retry for as long as you're in town — report the first only. */
  private reportOnce(what: string, err: unknown): void {
    if (this.reported) return;
    this.reported = true;
    report(what, err);
  }

  private emitAudioBlocked(): void {
    const ctx = townAudioContext();
    const room = this.room;
    const blocked =
      (ctx !== null && ctx.state !== 'running') || (room !== null && !room.canPlaybackAudio);
    this.onAudioBlockedChange?.(blocked);
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

  /** Rebuild the list of visible camera feeds: yours, then each conversation member's. */
  private emitVideo(): void {
    const room = this.room;
    if (!room) {
      this.onVideoChange?.([]);
      return;
    }
    const videos: ProximityVideo[] = [];
    const own = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (this.cameraOn && own?.videoTrack && !own.isMuted) {
      videos.push({
        key: 'self',
        did: this.selfDid,
        track: own.videoTrack,
        local: true,
        paused: false,
      });
    }
    for (const p of room.remoteParticipants.values()) {
      const did = this.pidToDid.get(p.identity);
      if (!did) continue;
      const pub = p.getTrackPublication(Track.Source.Camera);
      if (pub?.videoTrack && pub.isSubscribed && !pub.isMuted) {
        videos.push({
          key: p.identity,
          did,
          track: pub.videoTrack,
          local: false,
          paused: this.pausedVideo.has(p.identity),
        });
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

  /** We left `room` (or were destroyed) while awaiting. */
  private isStale(room: Room): boolean {
    return this.room !== room || this.destroyed;
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer || !this.joined) return;
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
  }

  private leaveRoom(): void {
    const room = this.room;
    this.room = null;
    this.roomName = null;
    this.selfPidValue = null;
    this.clearAudio();
    // Leaving the room ends your camera too.
    this.clearVideo();
    this.onLiveChange?.(false);
    this.pausedVideo.clear();
    if (room) {
      room.removeAllListeners();
      // Don't wait for the old room to finish closing before joining the next
      // one — it still stops our tracks; we just stop blocking on it.
      void room.disconnect();
    }
  }
}

/** Stop a local device track directly — works even after the room disconnected. */
function releaseDevice(room: Room, source: Track.Source): void {
  room.localParticipant.getTrackPublication(source)?.track?.stop();
}

/** Voice failures are invisible to the user's console otherwise — send them to Sentry. */
function report(what: string, err: unknown): void {
  Sentry.captureException(err, { tags: { area: 'town-voice' }, extra: { what } });
}

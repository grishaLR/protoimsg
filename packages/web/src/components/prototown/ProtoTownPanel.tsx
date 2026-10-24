import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TOWN_JOIN_ASK_MS,
  TOWN_KNOCK_MS,
  TOWN_PROXIMITY,
  TOWN_SQUARE_LAYOUT,
  TOWN_TILE,
  parseTownSceneId,
  townArrival,
  townDoorwayTarget,
  townSceneId,
} from '@protoimsg/shared';
import type {
  PresenceVisibility,
  ServerMessage,
  TownGate,
  TownScene,
  TownSceneKind,
} from '@protoimsg/shared';
import { useAuth } from '../../hooks/useAuth';
import {
  effectiveVisibility,
  getCurrentStatus,
  setTownVisibilityCap,
} from '../../lib/presence-state';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { WorldEngine, type SignId } from '../../town/WorldEngine';
import { useProfiles } from '../../contexts/ProfileContext';
import { TownSignpost } from './TownSignpost';
import { GuestList, KnockPrompt, RequestCards, type PendingRequest } from './TownKnock';
import { playDoorOpen, playImNotify } from '../../lib/sounds';
import { ProximityVoice, type ProximityVideo } from '../../town/ProximityVoice';
import { TownVideoWindow } from './TownVideoWindow';
import { TownBetaNotice } from './TownBetaNotice';
import styles from './ProtoTownPanel.module.css';

// Visibility-IS-location: the scene you're in decides who sees you online.
const SCENE_VISIBILITY: Record<TownSceneKind, PresenceVisibility> = {
  home: 'inner-circle',
  neighborhood: 'community',
  square: 'everyone',
};

/**
 * Where you stand caps who sees you online; your own narrower setting still
 * wins ("invisible" stays invisible). Sets the shared cap — so the buddy list
 * and status menu respect it too — and returns what to send.
 */
function sceneVisibility(kind: TownSceneKind, fof: boolean): PresenceVisibility {
  // Friends-of-friends narrows the square; buddy-list presence follows suit.
  setTownVisibilityCap(kind === 'square' && fof ? 'community' : SCENE_VISIBILITY[kind]);
  return effectiveVisibility();
}

// Matches --cm-duration-slower: the fade covers the swap before we ask to enter.
const FADE_MS = 300;
// Past this, give up on the doorway and let the player walk on.
const ENTER_TIMEOUT_MS = 5000;

// Why a door didn't take you anywhere, or why you were moved.
type SceneError =
  | 'closed'
  | 'timeout'
  | 'outdated'
  | 'removed'
  | 'privateHouse'
  | 'visitOver'
  | 'noAnswer';
type NoticeKey = 'removed' | 'privateHouse' | 'visitOver' | 'noAnswer';
const NOTICE_KEYS = new Set<SceneError>(['removed', 'privateHouse', 'visitOver', 'noAnswer']);

const KNOCKING_STORAGE_KEY = 'protoimsg:townKnocking';

function readKnockingOpen(): boolean {
  try {
    return localStorage.getItem(KNOCKING_STORAGE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeKnockingOpen(open: boolean): void {
  try {
    localStorage.setItem(KNOCKING_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // localStorage unavailable
  }
}

const FOF_STORAGE_KEY = 'protoimsg:townFof';
// The signpost resolves names for at most this many neighborhoods.
const SIGNPOST_NAMES = 100;
// Gate signs sit 192 world px apart; longer names would run into the next one.
const GATE_NAME_MAX = 18;

/** `did:plc:abcd1234…` — something to show while (or if) a profile won't load. */
function shortDid(did: string): string {
  return did.length > 16 ? `${did.slice(0, 16)}…` : did;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const MIC_STORAGE_KEY = 'protoimsg:townMic';
const VOLUME_TICK_MS = 250;
// Full volume inside the join radius, easing down for mesh members who are
// only linked through someone else.
const MIN_VOLUME = 0.3;
const FADE_DIST = TOWN_PROXIMITY.joinRadius * 3;

/** The open knock notification (closed when the knock ends or you look). */
let knockNotification: Notification | null = null;

/**
 * A system notification for a knock — only while the tab is in the
 * background, and only if you've allowed them (we never ask unprompted).
 * Never throws: some mobile browsers expose Notification but forbid
 * constructing one (they need a service worker), and a knock card must
 * never be lost to that.
 */
function notifyKnock(title: string, body: string): void {
  if (!document.hidden || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    knockNotification?.close();
    const n = new Notification(title, { body, tag: 'town-knock' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    knockNotification = n;
  } catch {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.showNotification(title, { body, tag: 'town-knock' }))
      .catch(() => {});
  }
}

function closeKnockNotification(): void {
  knockNotification?.close();
  knockNotification = null;
}

function readFofPref(): boolean {
  try {
    return localStorage.getItem(FOF_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeFofPref(on: boolean): void {
  try {
    localStorage.setItem(FOF_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // localStorage unavailable
  }
}

function readMicPref(): boolean {
  try {
    return localStorage.getItem(MIC_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeMicPref(on: boolean): void {
  try {
    localStorage.setItem(MIC_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // localStorage unavailable
  }
}

function volumeAt(dist: number | null): number {
  if (dist === null) return MIN_VOLUME;
  const { joinRadius } = TOWN_PROXIMITY;
  if (dist <= joinRadius) return 1;
  const t = Math.min(1, (dist - joinRadius) / (FADE_DIST - joinRadius));
  return 1 - t * (1 - MIN_VOLUME);
}

export function ProtoTownPanel() {
  const { t } = useTranslation('common');
  const { did } = useAuth();
  const { send, subscribe, connected } = useWebSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioHostRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<ProximityVoice | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [micOn, setMicOn] = useState(readMicPref);
  const [micError, setMicError] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [scene, setScene] = useState<TownScene | null>(null);
  const sceneRef = useRef<TownScene | null>(null);
  // Door sign tooltip (hover/tap), and a short note when you enter a scene.
  const [signTip, setSignTip] = useState<{ sign: SignId; x: number; y: number } | null>(null);
  const [sceneNote, setSceneNote] = useState<TownSceneKind | null>(null);
  const [sceneError, setSceneError] = useState<SceneError | null>(null);
  // Whose neighborhood a "removed" / "knock soon" notice is about.
  const [noticeOwner, setNoticeOwner] = useState<string | null>(null);
  // The square's gate row, and neighborhoods beyond it (on the signpost).
  const [gates, setGates] = useState<TownGate[]>([]);
  const gatesRef = useRef<TownGate[]>([]);
  const [moreGates, setMoreGates] = useState<string[]>([]);
  const [signpostOpen, setSignpostOpen] = useState(false);
  const [fof, setFof] = useState(readFofPref);
  // Knocking: may you knock on this neighborhood's door; your knock prompt
  // (null = closed); knocks at your own door; your guests; your door's state.
  const canKnockRef = useRef(false);
  const [knockPrompt, setKnockPrompt] = useState<{ owner: string; knocking: boolean } | null>(null);
  const knockPromptRef = useRef(knockPrompt);
  knockPromptRef.current = knockPrompt;
  // Where the prompt opened: walking a tile away from it closes it.
  const promptAtRef = useRef<{ x: number; y: number } | null>(null);
  const [knocks, setKnocks] = useState<PendingRequest[]>([]);
  // Joining conversations: whether the server says "ask to join" applies,
  // whether we've already had an answer here (no re-offer until you step
  // away), your pending ask, and people asking to join yours.
  const [joinAvailable, setJoinAvailable] = useState(false);
  const [joinAnswered, setJoinAnswered] = useState(false);
  const [asking, setAsking] = useState(false);
  const [joinRequests, setJoinRequests] = useState<PendingRequest[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [knockingOpen, setKnockingOpen] = useState(readKnockingOpen);
  // Offer knock notifications only where the browser can still ask.
  const [canAskNotify, setCanAskNotify] = useState(
    () => 'Notification' in window && Notification.permission === 'default',
  );
  const knockingOpenRef = useRef(knockingOpen);
  knockingOpenRef.current = knockingOpen;
  const fofRef = useRef(fof);
  fofRef.current = fof;
  // Doorway hand-off: the fade is up and we're waiting to be let in.
  // The colour stays put while it fades back out, so it never flips mid-fade.
  const [fade, setFade] = useState<{ to: TownSceneKind; on: boolean } | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Scene id the current doorway hand-off is heading to. */
  const pendingSceneRef = useRef<string | null>(null);
  const transitioningRef = useRef(false);
  // Until the server confirms our scene, we send no moves and trust no town
  // traffic — an older server would put us in a shared world we think is private.
  const sceneConfirmedRef = useRef(false);
  const [bannerShown, setBannerShown] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [videos, setVideos] = useState<ProximityVideo[]>([]);
  const [cameraPending, setCameraPending] = useState(false);
  // Why the camera last changed — drives announcements + the "someone joined" notice.
  const [cameraEvent, setCameraEvent] = useState<'on' | 'off' | 'joined' | null>(null);
  // Other people's video starts hidden; you reveal each feed yourself.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  // Screen-reader announcement on voice transitions only, not every roster tick.
  const [announcement, setAnnouncement] = useState('');
  // A repeated message (same door, same signpost) must still be read out:
  // alternate a zero-width space so the live region always changes.
  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => (prev === text ? `${text}\u200b` : text));
  }, []);
  const prevNearbyRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;
  const sendRef = useRef(send);
  sendRef.current = send;
  const didRef = useRef(did);
  didRef.current = did;

  // Names for gate signs, the neighborhood you're visiting and the signpost.
  const nameDids = useMemo(() => {
    const out = new Set(gates.map((g) => g.owner));
    if (scene && scene.kind !== 'square') out.add(scene.owner);
    if (noticeOwner) out.add(noticeOwner);
    for (const k of knocks) out.add(k.from);
    for (const r of joinRequests) out.add(r.from);
    for (const g of guests) out.add(g);
    if (signpostOpen) for (const d of moreGates.slice(0, SIGNPOST_NAMES)) out.add(d);
    if (did) out.delete(did);
    return [...out];
  }, [gates, scene, noticeOwner, signpostOpen, moreGates, knocks, joinRequests, guests, did]);
  const { getProfile, version: namesVersion } = useProfiles(nameDids);
  const nameOf = useCallback(
    (d: string) => {
      const p = getProfile(d);
      return p?.displayName || p?.handle || shortDid(d);
    },
    [getProfile],
  );
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;
  const getProfileRef = useRef(getProfile);
  getProfileRef.current = getProfile;

  /** What a sign in the world says — the engine asks; i18n and names live here. */
  const signText = useCallback(
    (id: SignId): string => {
      const tt = tRef.current;
      const here = sceneRef.current;
      if (id.startsWith('gate:')) {
        const owner = id.slice('gate:'.length);
        return owner === did
          ? tt('town.doors.neighborhood.label')
          : clip(nameOfRef.current(owner), GATE_NAME_MAX);
      }
      if (id === 'door:home' && here?.kind === 'neighborhood' && here.owner !== did) {
        return tt('town.doors.houseOf.label', { name: nameOfRef.current(here.owner) });
      }
      if (id === 'door:home') return tt('town.doors.home.label');
      if (id === 'door:neighborhood' && here?.kind === 'home' && here.owner !== did) {
        return tt('town.doors.neighborhoodOf.label', { name: nameOfRef.current(here.owner) });
      }
      if (id === 'door:neighborhood') return tt('town.doors.neighborhood.label');
      if (id === 'door:square') return tt('town.doors.square.label');
      if (id === 'signpost') return tt('town.signpost.label');
      return tt(id === 'lot:arcade' ? 'town.lots.arcade' : 'town.lots.theater');
    },
    [did],
  );
  const signTextRef = useRef(signText);
  signTextRef.current = signText;
  /** Finish a doorway hand-off: drop the fade, and on failure step back off the door. */
  const endTransition = useCallback((error?: SceneError) => {
    if (!transitioningRef.current) return;
    transitioningRef.current = false;
    pendingSceneRef.current = null;
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
    setFade((f) => f && { ...f, on: false });
    if (error) {
      engineRef.current?.leaveDoorway();
      setSceneError(error);
    }
  }, []);

  /**
   * Head for `target`: fade, door sound, then ask the server to let us in.
   * The swap happens when town_state for that scene arrives.
   */
  const startTransition = useCallback(
    (target: TownScene) => {
      const from = sceneRef.current;
      if (!from || transitioningRef.current) return;
      const spawn = townArrival(target.kind, from.kind);
      transitioningRef.current = true;
      pendingSceneRef.current = townSceneId(target);
      setFade({ to: target.kind, on: true });
      setSceneNote(null);
      setSceneError(null);
      setSignpostOpen(false);
      playDoorOpen();
      transitionTimerRef.current = setTimeout(
        () => {
          sendRef.current({
            type: 'town_join',
            scene: townSceneId(target),
            x: spawn.x,
            y: spawn.y,
            dir: spawn.dir,
            fof: fofRef.current,
          });
          transitionTimerRef.current = setTimeout(() => {
            endTransition('timeout');
            // The server may have moved us after all — pull it back to where we are.
            const here = sceneRef.current;
            const p = engineRef.current?.getPosition();
            if (here && p) {
              sendRef.current({ type: 'town_join', scene: townSceneId(here), ...p });
            }
          }, ENTER_TIMEOUT_MS);
        },
        prefersReducedMotion() ? 0 : FADE_MS,
      );
    },
    [endTransition],
  );

  /** Your door's state, from the server or a toggle: show it and remember it. */
  const adoptKnocking = useCallback((open: boolean) => {
    setKnockingOpen(open);
    writeKnockingOpen(open);
  }, []);

  /** Take in a new gate row (square only). */
  const applyGates = useCallback((next: TownGate[], more: string[]) => {
    gatesRef.current = next;
    setGates(next);
    setMoreGates(more);
    engineRef.current?.setGates(next, more.length > 0);
  }, []);

  /** Now standing in `next`: remember it, say where you are, update who sees you. */
  const arriveIn = useCallback((next: TownScene) => {
    sceneRef.current = next;
    setScene(next);
    setSceneNote(next.kind);
    setSceneError(null);
    setSignTip(null);
    setKnockPrompt(null);
    setJoinRequests([]);
    setAsking(false);
    // Knock cards and the guest list only make sense inside your own home.
    if (next.kind !== 'home' || next.owner !== didRef.current) {
      setKnocks([]);
      setGuests([]);
    }
    sendRef.current({
      type: 'status_change',
      ...getCurrentStatus(),
      visibleTo: sceneVisibility(next.kind, fofRef.current),
    });
  }, []);

  // Bumped when an engine finishes initialising — gates the WS-join effect so
  // it runs once the engine is ready, and re-runs when the engine is recreated.
  const [engineEpoch, setEngineEpoch] = useState(0);

  // Engine lifecycle — tied to the authenticated DID. town_leave is sent here
  // (real unmount / DID change), never on a transient reconnect.
  useEffect(() => {
    const container = containerRef.current;
    const audioHost = audioHostRef.current;
    if (!container || !audioHost || !did) return;
    const engine = new WorldEngine();
    engineRef.current = engine;
    const home: TownScene = { kind: 'home', owner: did };
    sceneRef.current = home;
    setScene(home);
    // Capped from the first moment — before the socket or engine is ready, so
    // a buddy-list resend can't widen it in between.
    setTownVisibilityCap(SCENE_VISIBILITY.home);

    const voice = new ProximityVoice(audioHost, did, readMicPref());
    voiceRef.current = voice;
    voice.onMembersChange = (dids) => {
      engine.setVoiceCluster(dids);
      setNearbyCount(Math.max(0, dids.length - 1));
    };
    voice.onSpeakingChange = (dids) => {
      engine.setSpeaking(dids);
    };
    voice.onAudioBlockedChange = setAudioBlocked;
    voice.onLiveChange = setMicLive;
    voice.onVideoChange = setVideos;
    voice.onCameraChange = (on, reason) => {
      setCameraOn(on);
      // 'ended' is already covered by the "voice ended" announcement.
      if (reason !== 'ended') setCameraEvent(on ? 'on' : (reason ?? 'off'));
    };
    voice.onCameraPendingChange = setCameraPending;
    voice.onCameraError = () => {
      setCameraError(true);
    };
    voice.onMicError = () => {
      setMicOn(false);
      setMicError(true);
      writeMicPref(false);
    };
    voice.onRequestRefresh = () => {
      sendRef.current({ type: 'town_voice_refresh' });
    };
    const volumeTimer = setInterval(() => {
      voice.setVolumes((peerDid) => volumeAt(engine.distanceTo(peerDid)));
    }, VOLUME_TICK_MS);
    // Walking (a keypress) or clicking is a user gesture — use it to lift any
    // autoplay block so the "click to hear" button is rarely needed.
    const unlockAudio = (): void => {
      void voice.startAudio();
    };
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('pointerdown', unlockAudio);

    engine.onMove = (x, y, dir, sprint) => {
      // Not mid-doorway either: a move landing after the server has switched
      // scenes would place us in the new scene at the old coordinates.
      if (sceneConfirmedRef.current && !transitioningRef.current) {
        sendRef.current({ type: 'town_move', x, y, dir, ...(sprint ? { sprint } : {}) });
      }
      // Walked away from the door without knocking: put the prompt away.
      const at = promptAtRef.current;
      const prompt = knockPromptRef.current;
      if (prompt && !prompt.knocking && at && Math.hypot(x - at.x, y - at.y) > TOWN_TILE) {
        promptAtRef.current = null;
        setKnockPrompt(null);
      }
    };
    engine.onSignHover = (sign, x, y) => {
      setSignTip(sign ? { sign, x, y } : null);
    };
    // Stepped onto a doorway. Someone else's house: their inner circle gets
    // a knock prompt, anyone else just a name on the door. An empty gate
    // slot is just fence.
    engine.onDoorway = (door) => {
      const from = sceneRef.current;
      if (!from) return;
      if (door.to === 'home' && from.kind === 'neighborhood' && from.owner !== did) {
        engine.leaveDoorway();
        if (canKnockRef.current) {
          const p = engine.getPosition();
          promptAtRef.current = { x: p.x, y: p.y };
          if (!knockPromptRef.current) {
            announce(tRef.current('town.knock.prompt', { name: nameOfRef.current(from.owner) }));
          }
          setKnockPrompt((k) => k ?? { owner: from.owner, knocking: false });
        } else {
          setNoticeOwner(from.owner);
          setSceneError('privateHouse');
        }
        return;
      }
      const target = townDoorwayTarget(from, door, gatesRef.current);
      if (!target) {
        engine.leaveDoorway();
        return;
      }
      startTransition(target);
    };
    engine.onSignpost = (on) => {
      setSignpostOpen(on);
      if (on) announce(tRef.current('town.signpost.title'));
    };
    void engine.init(container, did, home.kind).then(() => {
      if (engineRef.current === engine) setEngineEpoch((e) => e + 1);
    });
    engine.setSignText((id) => signTextRef.current(id));
    return () => {
      clearInterval(volumeTimer);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
      voiceRef.current = null;
      voice.destroy();
      setVoiceSupported(false);
      setNearbyCount(0);
      setJoinAvailable(false);
      setJoinAnswered(false);
      setAsking(false);
      setJoinRequests([]);
      endTransition();
      sceneRef.current = null;
      setScene(null);
      gatesRef.current = [];
      setGates([]);
      setMoreGates([]);
      setSignpostOpen(false);
      setAudioBlocked(false);
      setMicLive(false);
      setCameraOn(false);
      setCameraError(false);
      setCameraPending(false);
      setCameraEvent(null);
      setVideos([]);
      setRevealed(new Set());
      setMicError(false);
      sendRef.current({ type: 'town_leave' });
      // Leaving town: lift the cap and restore your own setting.
      setTownVisibilityCap(null);
      sendRef.current({
        type: 'status_change',
        ...getCurrentStatus(),
        visibleTo: effectiveVisibility(),
      });
      engineRef.current = null;
      engine.destroy();
    };
  }, [did, endTransition, startTransition]);

  // Join the town and subscribe to peer events — only once the socket is
  // connected and the engine is ready.
  useEffect(() => {
    if (!connected || engineEpoch === 0) return;
    const engine = engineRef.current;
    if (!engine) return;
    // (Re)join wherever we are — a reconnect puts you back in the same scene.
    const current = sceneRef.current;
    if (!current) return;
    const p = engine.getPosition();
    // Friends-of-friends mode is per socket — a new connection carries it in
    // the join so the very first view is already narrowed.
    send({
      type: 'town_join',
      scene: townSceneId(current),
      x: p.x,
      y: p.y,
      dir: p.dir,
      fof: fofRef.current,
    });
    // Your door's state lives on the server (all your tabs share it). Only a
    // closed door is restated — a stale tab must never reopen it.
    if (!readKnockingOpen()) send({ type: 'town_knocking', open: false });
    // Knocks and join requests don't survive a reconnect on the server.
    setKnocks([]);
    setKnockPrompt(null);
    setJoinRequests([]);
    setAsking(false);
    send({
      type: 'status_change',
      ...getCurrentStatus(),
      visibleTo: sceneVisibility(current.kind, fofRef.current),
    });
    sceneConfirmedRef.current = false;
    const unsub = subscribe((msg: ServerMessage) => {
      const e = engineRef.current;
      if (!e) return;
      if (msg.type === 'town_denied' && !sceneConfirmedRef.current) {
        // The scene we rejoined won't have us any more (an older server says
        // so with a bare refusal): go home, and mark it as where we're
        // heading so its town_state is adopted rather than "corrected".
        const p = e.getPosition();
        if (didRef.current) {
          const home = townSceneId({ kind: 'home', owner: didRef.current });
          pendingSceneRef.current = home;
          send({ type: 'town_join', scene: home, ...p });
        }
        return;
      }
      if (msg.type.startsWith('town_') && msg.type !== 'town_state' && !sceneConfirmedRef.current) {
        return;
      }
      switch (msg.type) {
        case 'town_state': {
          // A server without scenes (deploy skew) ignores the scene we asked
          // for and drops us into one shared world: leave at once, show nobody.
          if (typeof (msg.data as Partial<typeof msg.data>).scene !== 'string') {
            send({ type: 'town_leave' });
            e.setPeers([]);
            void voiceRef.current?.assign(null);
            endTransition('outdated');
            setSceneError('outdated');
            return;
          }
          sceneConfirmedRef.current = true;
          const cur = sceneRef.current;
          const next = parseTownSceneId(msg.data.scene);
          // The gate row comes first: the square is built with it. A server
          // that predates gates sends none — keep at least your own gate open.
          if (msg.data.gates) applyGates(msg.data.gates, msg.data.moreGates ?? []);
          else if (next?.kind === 'square' && did) {
            applyGates([{ owner: did, slot: TOWN_SQUARE_LAYOUT.ownSlot }], []);
          }
          canKnockRef.current = msg.data.canKnock ?? false;
          if (msg.data.knockingOpen !== undefined) adoptKnocking(msg.data.knockingOpen);
          if (msg.data.reason && next) {
            // The server moved us: let in after a knock, the visit ended, or
            // we lost access (taken off the owner's list, or a block).
            const left = cur && cur.kind !== 'square' ? cur.owner : null;
            e.setWindowLit(msg.data.windowLit ?? false);
            arriveIn(next); // first, so the new scene's signs read right
            e.enterScene(next.kind, msg.data.self);
            endTransition();
            if (msg.data.reason === 'visitOver') setSceneError('visitOver');
            else if (msg.data.reason === 'removed' && left) {
              setNoticeOwner(left);
              setSceneError('removed');
            }
          } else if (msg.data.scene === pendingSceneRef.current && next) {
            // Let in: swap scenes behind the fade, then lift it.
            e.setWindowLit(msg.data.windowLit ?? false);
            arriveIn(next);
            e.enterScene(next.kind, msg.data.self);
            endTransition();
            pendingSceneRef.current = null;
          } else if (!cur || msg.data.scene !== townSceneId(cur)) {
            // A late answer for a door we already gave up on — snap the
            // server back to where we really are.
            const p = e.getPosition();
            if (cur) send({ type: 'town_join', scene: townSceneId(cur), ...p });
            break;
          }
          // Otherwise a (re)join confirming the scene we're in: refresh peers,
          // leave any doorway hand-off in flight alone.
          e.setWindowLit(msg.data.windowLit ?? false);
          e.setPeers(msg.data.peers);
          setVoiceSupported(msg.data.voice);
          // Warm up DNS/TLS to LiveKit before anyone walks up to you.
          if (msg.data.voiceUrl) voiceRef.current?.prepare(msg.data.voiceUrl);
          break;
        }
        case 'town_denied':
          endTransition('closed');
          break;
        case 'town_gates':
          applyGates(msg.data.gates, msg.data.moreGates);
          break;
        case 'town_knock_request': {
          playImNotify();
          const atDoor = tRef.current(
            msg.data.again ? 'town.knock.atDoorAgain' : 'town.knock.atDoor',
            { name: nameOfRef.current(msg.data.from) },
          );
          announce(atDoor);
          setKnocks((ks) =>
            ks.some((k) => k.id === msg.data.knockId)
              ? ks
              : [
                  ...ks,
                  {
                    id: msg.data.knockId,
                    from: msg.data.from,
                    again: msg.data.again,
                    until: Date.now() + TOWN_KNOCK_MS,
                  },
                ],
          );
          // Last: the card is up even if the notification can't be shown.
          notifyKnock(tRef.current('town.knock.tabTitle'), atDoor);
          break;
        }
        case 'town_knock_access':
          canKnockRef.current = msg.data.canKnock;
          if (!msg.data.canKnock) setKnockPrompt((k) => (k?.knocking ? k : null));
          break;
        case 'town_door':
          adoptKnocking(msg.data.open);
          break;
        case 'town_window':
          e.setWindowLit(msg.data.lit);
          break;
        case 'town_join_available':
          setJoinAvailable(msg.data.available);
          if (!msg.data.available) setJoinAnswered(false);
          break;
        case 'town_join_request':
          playImNotify();
          // It's from someone you can't see, so their profile is rarely
          // loaded yet: don't announce a truncated id.
          announce(
            getProfileRef.current(msg.data.from)
              ? tRef.current('town.join.request', { name: nameOfRef.current(msg.data.from) })
              : tRef.current('town.join.requestSomeone'),
          );
          setJoinRequests((rs) =>
            rs.some((r) => r.id === msg.data.requestId)
              ? rs
              : [
                  ...rs,
                  {
                    id: msg.data.requestId,
                    from: msg.data.from,
                    until: Date.now() + TOWN_JOIN_ASK_MS,
                  },
                ],
          );
          break;
        case 'town_join_request_end':
          setJoinRequests((rs) => rs.filter((r) => r.id !== msg.data.requestId));
          break;
        case 'town_join_result':
          setAsking(false);
          setJoinAnswered(true);
          if (msg.data.outcome === 'accepted') {
            announce(tRef.current('town.join.accepted'));
          } else setSceneError('noAnswer');
          break;
        case 'town_knock_end':
          closeKnockNotification();
          setKnocks((ks) => ks.filter((k) => k.id !== msg.data.knockId));
          break;
        case 'town_knock_result':
          setKnockPrompt(null);
          setSceneError('noAnswer');
          break;
        case 'town_guests':
          setGuests(msg.data.guests);
          break;
        case 'town_view':
          // Batched: who appeared/moved in your view, and who left it.
          for (const p of msg.data.upsert) e.peerMove(p);
          for (const peerDid of msg.data.remove) e.peerLeave(peerDid);
          break;
        case 'town_proximity':
          void voiceRef.current?.assign(msg.data.room);
          break;
        case 'town_peer_join':
          e.peerJoin(msg.data);
          break;
        case 'town_peer_move':
          e.peerMove(msg.data);
          break;
        case 'town_peer_leave':
          e.peerLeave(msg.data.did);
          break;
        case 'town_chat':
          e.showChat(msg.data.did, msg.data.text);
          break;
        default:
          break;
      }
    });
    return () => {
      unsub();
      // Socket gone mid-doorway: stay put; the rejoin uses the scene we're in.
      endTransition('timeout');
      // Socket gone: the server has already evicted us from voice; a fresh
      // assignment follows the next town_join.
      void voiceRef.current?.assign(null);
    };
  }, [
    connected,
    engineEpoch,
    subscribe,
    send,
    arriveIn,
    endTransition,
    applyGates,
    adoptKnocking,
    did,
  ]);

  useEffect(() => {
    const prev = prevNearbyRef.current;
    prevNearbyRef.current = nearbyCount;
    if (prev === 0 && nearbyCount > 0) announce(t('town.voice.announceJoined'));
    else if (prev > 0 && nearbyCount === 0) {
      announce(t('town.voice.announceEnded'));
      // New conversation, fresh consent: hide everyone's video again.
      setRevealed(new Set());
    }
  }, [nearbyCount, t]);

  useEffect(() => {
    if (!cameraEvent) return;
    const key =
      cameraEvent === 'on'
        ? 'town.voice.camOnAnnounce'
        : cameraEvent === 'joined'
          ? 'town.voice.camAutoOff'
          : 'town.voice.camOffAnnounce';
    announce(t(key));
    if (cameraEvent !== 'joined') return;
    // Keep the visible "someone joined" notice up briefly.
    const timer = setTimeout(() => {
      setCameraEvent(null);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [cameraEvent, t]);

  const toggleCamera = useCallback(() => {
    setCameraError(false);
    setCameraEvent(null);
    void voiceRef.current?.toggleCamera();
  }, []);

  // With your own camera on you've opted into a video conversation, so others'
  // feeds show automatically. Otherwise they start hidden until you reveal
  // them — and a newcomer turns your camera off, so they always start hidden.
  const isRevealed = useCallback(
    (v: ProximityVideo) => v.local || cameraOn || revealed.has(v.key),
    [cameraOn, revealed],
  );

  const toggleReveal = useCallback((key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    setMicError(false);
    writeMicPref(next);
    void voiceRef.current?.startAudio();
    void voiceRef.current?.setMicEnabled(next);
  }, [micOn]);

  const enableAudio = useCallback(() => {
    void voiceRef.current?.startAudio();
  }, []);

  // Relabel signs when the language, the scene or a resolved name changes.
  useEffect(() => {
    if (engineEpoch === 0) return;
    engineRef.current?.refreshSigns();
  }, [t, engineEpoch, scene, namesVersion]);

  const toggleFof = useCallback(() => {
    const next = !fof;
    setFof(next);
    writeFofPref(next);
    fofRef.current = next;
    send({ type: 'town_fof', on: next });
    if (sceneRef.current) {
      send({
        type: 'status_change',
        ...getCurrentStatus(),
        visibleTo: sceneVisibility(sceneRef.current.kind, next),
      });
    }
    announce(t(next ? 'town.fof.announceOn' : 'town.fof.announceOff'));
  }, [fof, send, t]);

  const knock = useCallback(() => {
    send({ type: 'town_knock' });
    setKnockPrompt((k) => k && { ...k, knocking: true });
    announce(t('town.knock.knocking'));
  }, [send, t]);

  // Safety net: if the answer never arrives (it's sent after TOWN_KNOCK_MS),
  // don't leave "Knocking…" up forever.
  const knocking = knockPrompt?.knocking ?? false;
  useEffect(() => {
    if (!knocking) return;
    const timer = setTimeout(() => {
      setKnockPrompt(null);
      setSceneError('noAnswer');
    }, TOWN_KNOCK_MS + 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [knocking]);

  // Request cards expire with the request on the server.
  useEffect(() => {
    const all = [...knocks, ...joinRequests];
    if (all.length === 0) return;
    const next = Math.min(...all.map((r) => r.until));
    const timer = setTimeout(
      () => {
        const now = Date.now();
        // Same array when nothing expired, so the other list doesn't re-render.
        const live = (rs: PendingRequest[]) =>
          rs.some((r) => r.until <= now) ? rs.filter((r) => r.until > now) : rs;
        setKnocks(live);
        setJoinRequests(live);
      },
      Math.max(0, next - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [knocks, joinRequests]);

  const inNeighborhood = scene?.kind === 'neighborhood';
  const canAskToJoin = inNeighborhood && joinAvailable && !joinAnswered;

  const askToJoin = useCallback(() => {
    if (asking) return; // aria-disabled, not disabled: focus stays put
    send({ type: 'town_join_ask' });
    setAsking(true);
    announce(t('town.join.asking'));
  }, [asking, send, t]);

  // Safety net: the answer comes within TOWN_JOIN_ASK_MS; don't spin forever.
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => {
      setAsking(false);
      setJoinAnswered(true);
      setSceneError('noAnswer');
    }, TOWN_JOIN_ASK_MS + 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [asking]);

  const answerJoin = useCallback(
    (requestId: string, accept: boolean) => {
      send({ type: 'town_join_answer', requestId, accept });
      setJoinRequests((rs) => rs.filter((r) => r.id !== requestId));
    },
    [send],
  );

  const answerKnock = useCallback(
    (knockId: string, letIn: boolean) => {
      send({ type: 'town_knock_answer', knockId, letIn });
      setKnocks((ks) => ks.filter((k) => k.id !== knockId));
    },
    [send],
  );

  const askToLeave = useCallback(
    (guest: string) => {
      send({ type: 'town_kick', did: guest });
    },
    [send],
  );

  const askNotify = useCallback(() => {
    // Older Safari takes a callback and returns nothing; newer browsers
    // return a promise. Either way, re-read the permission afterwards.
    const done = (): void => {
      setCanAskNotify(Notification.permission === 'default');
    };
    try {
      const pending = Notification.requestPermission(done) as Promise<unknown> | undefined;
      void pending?.then(done, done);
    } catch {
      done();
    }
  }, []);

  const toggleKnocking = useCallback(() => {
    const next = !knockingOpen;
    adoptKnocking(next);
    send({ type: 'town_knocking', open: next });
  }, [knockingOpen, send, adoptKnocking]);

  // Another tab changed the door (same browser): follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === KNOCKING_STORAGE_KEY) setKnockingOpen(readKnockingOpen());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Coming back to the tab: the system notification has done its job.
  useEffect(() => {
    const onVisible = (): void => {
      if (!document.hidden) closeKnockNotification();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // A knock while you're in another tab: say so in the tab title until you look.
  useEffect(() => {
    if (knocks.length === 0) return;
    const base = document.title;
    const flag = (): void => {
      document.title = document.hidden ? `${t('town.knock.tabTitle')} · ${base}` : base;
    };
    flag();
    document.addEventListener('visibilitychange', flag);
    return () => {
      document.removeEventListener('visibilitychange', flag);
      document.title = base;
    };
  }, [knocks.length, t]);

  const visitFromSignpost = useCallback(
    (owner: string) => {
      engineRef.current?.freeze();
      startTransition({ kind: 'neighborhood', owner });
    },
    [startTransition],
  );

  // Where you are, in words: the chip and the arrival note.
  const visitingName =
    scene?.kind === 'neighborhood' && scene.owner !== did ? nameOf(scene.owner) : null;
  const hostName = scene?.kind === 'home' && scene.owner !== did ? nameOf(scene.owner) : null;
  const atOwnHome = scene?.kind === 'home' && scene.owner === did;
  const chipText = !scene
    ? ''
    : hostName
      ? t('town.scenes.guestHome.chip', { name: hostName })
      : visitingName
        ? t('town.scenes.visiting.chip', { name: visitingName })
        : scene.kind === 'square' && fof
          ? t('town.scenes.square.chipFof')
          : t(`town.scenes.${scene.kind}.chip`);
  const noteText = sceneError
    ? NOTICE_KEYS.has(sceneError)
      ? t(`town.scenes.notice.${sceneError as NoticeKey}`, {
          name: noticeOwner ? nameOf(noticeOwner) : '…',
        })
      : t(`town.scenes.error.${sceneError as 'closed' | 'timeout' | 'outdated'}`)
    : sceneNote
      ? visitingName && sceneNote === 'neighborhood'
        ? t('town.scenes.visiting.enter', { name: visitingName })
        : hostName && sceneNote === 'home'
          ? t('town.scenes.guestHome.enter', { name: hostName })
          : t(`town.scenes.${sceneNote}.enter`)
      : '';
  const tipText = (id: SignId): { label: string; tip: string } => {
    const label = signText(id);
    if (id.startsWith('gate:')) {
      const owner = id.slice('gate:'.length);
      return {
        label,
        tip:
          owner === did
            ? t('town.doors.neighborhood.tooltip')
            : t('town.doors.gateOf.tooltip', { name: nameOf(owner) }),
      };
    }
    if (id === 'door:neighborhood' && hostName) {
      return { label, tip: t('town.doors.neighborhoodOf.tooltip', { name: hostName }) };
    }
    if (id === 'door:home' && visitingName) {
      return { label, tip: t('town.doors.houseOf.tooltip', { name: visitingName }) };
    }
    if (id.startsWith('door:')) {
      return { label, tip: t(`town.doors.${id.slice('door:'.length) as TownSceneKind}.tooltip`) };
    }
    if (id === 'signpost') return { label, tip: t('town.signpost.tooltip') };
    return { label, tip: t('town.lots.tooltip') };
  };

  // The "you're in…" note (or why a door didn't open) fades after a few seconds.
  useEffect(() => {
    // "Reload shortly" stays up — there's nothing else to do until you do.
    if ((!sceneNote && !sceneError) || sceneError === 'outdated') return;
    const timer = setTimeout(() => {
      setSceneNote(null);
      setSceneError(null);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [sceneNote, sceneError]);

  const sendChat = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (text) send({ type: 'town_chat', text: text.slice(0, 280) });
    input.value = '';
    input.blur();
  }, [send]);

  return (
    <div className={styles.panel}>
      <div className={styles.world} ref={containerRef} />
      <div ref={audioHostRef} hidden />
      <div className={styles.srOnly} aria-live="polite">
        {announcement}
      </div>
      <div
        className={`${styles.fade} ${fade?.to === 'home' ? styles.fadeIndoors : ''} ${fade?.on ? styles.fadeOn : ''}`}
        aria-hidden="true"
      />
      <TownBetaNotice onBannerChange={setBannerShown} />
      {signTip && (
        <div className={styles.areaTip} role="tooltip" style={{ left: signTip.x, top: signTip.y }}>
          <strong>{tipText(signTip.sign).label}</strong>
          <span>{tipText(signTip.sign).tip}</span>
        </div>
      )}
      {/* Always mounted so screen readers announce changes; hidden visually when empty. */}
      <div className={noteText ? styles.zoneNote : styles.srOnly} role="status">
        {noteText}
      </div>
      <div className={`${styles.topBar} ${bannerShown ? styles.belowBanner : ''}`}>
        <div className={styles.hudGroup}>
          {scene && <div className={styles.sceneChip}>{chipText}</div>}
          <div className={styles.hud}>{t('town.hud.controls')}</div>
          {scene?.kind === 'square' && (
            <button
              type="button"
              className={`${styles.voiceButton} ${styles.fofToggle} ${fof ? styles.micOn : ''}`}
              aria-describedby="town-fof-hint"
              title={t('town.fof.hint')}
              onClick={toggleFof}
            >
              {/* The label carries the state ("…: on"), so no aria-pressed. */}
              {t(fof ? 'town.fof.on' : 'town.fof.off')}
            </button>
          )}
          {scene?.kind === 'square' && (
            <span id="town-fof-hint" className={styles.srOnly}>
              {t('town.fof.hint')}
            </span>
          )}
          {atOwnHome && (
            <button
              type="button"
              className={`${styles.voiceButton} ${styles.fofToggle} ${knockingOpen ? '' : styles.micOn}`}
              aria-describedby="town-door-hint"
              title={t('town.door.hint')}
              onClick={toggleKnocking}
            >
              {t(knockingOpen ? 'town.door.open' : 'town.door.closed')}
            </button>
          )}
          {atOwnHome && (
            <span id="town-door-hint" className={styles.srOnly}>
              {t('town.door.hint')}
            </span>
          )}
          {atOwnHome && canAskNotify && knockingOpen && (
            <button
              type="button"
              className={`${styles.voiceButton} ${styles.fofToggle}`}
              onClick={askNotify}
            >
              {t('town.knock.notifyMe')}
            </button>
          )}
        </div>
        {voiceSupported && (
          <div className={styles.voiceBar}>
            {nearbyCount > 0 && (
              <span className={`${styles.nearby} ${micLive ? styles.live : ''}`}>
                {micLive
                  ? t('town.voice.live', { count: nearbyCount })
                  : t('town.voice.nearby', { count: nearbyCount })}
              </span>
            )}
            {audioBlocked && nearbyCount > 0 && (
              <button type="button" className={styles.voiceButton} onClick={enableAudio}>
                {t('town.voice.enableAudio')}
              </button>
            )}
            {/* First, so appearing never shifts mic/camera under a finger. */}
            {(canAskToJoin || asking) && (
              <button
                type="button"
                className={styles.voiceButton}
                aria-describedby="town-join-hint"
                title={t('town.join.askHint')}
                aria-disabled={asking}
                onClick={askToJoin}
              >
                {asking ? t('town.join.asking') : t('town.join.ask')}
              </button>
            )}
            {(canAskToJoin || asking) && (
              <span id="town-join-hint" className={styles.srOnly}>
                {t('town.join.askHint')}
              </span>
            )}
            <button
              type="button"
              className={`${styles.voiceButton} ${micOn ? styles.micOn : ''}`}
              onClick={toggleMic}
            >
              {micOn ? t('town.voice.micOn') : t('town.voice.micOff')}
            </button>
            {/* Never hide the off switch while the camera is live or starting. */}
            {(nearbyCount > 0 || cameraOn || cameraPending) && (
              <button
                type="button"
                className={`${styles.voiceButton} ${cameraOn ? styles.micOn : ''}`}
                aria-busy={cameraPending}
                onClick={toggleCamera}
              >
                {cameraPending
                  ? t('town.voice.camStarting')
                  : cameraOn
                    ? t('town.voice.camOn')
                    : t('town.voice.camOff')}
              </button>
            )}
            {cameraOn && (
              <span className={`${styles.nearby} ${styles.camLive}`}>
                {t('town.voice.camLive')}
              </span>
            )}
            {cameraEvent === 'joined' && (
              <span className={styles.nearby}>{t('town.voice.camAutoOff')}</span>
            )}

            {micError && (
              <span className={styles.micError} role="alert">
                {t('town.voice.micDenied')}
              </span>
            )}
            {cameraError && (
              <span className={styles.micError} role="alert">
                {t('town.voice.camDenied')}
              </span>
            )}
          </div>
        )}
      </div>
      {knockPrompt && scene?.kind === 'neighborhood' && (
        <KnockPrompt
          ownerName={nameOf(knockPrompt.owner)}
          knocking={knockPrompt.knocking}
          onKnock={knock}
          onCancel={() => {
            setKnockPrompt(null);
          }}
        />
      )}
      {atOwnHome && knocks.length > 0 && (
        <RequestCards
          requests={knocks}
          textOf={(r) =>
            t(r.again ? 'town.knock.atDoorAgain' : 'town.knock.atDoor', { name: nameOf(r.from) })
          }
          acceptLabel={t('town.knock.letIn')}
          declineLabel={t('town.knock.notNow')}
          onAnswer={answerKnock}
        />
      )}
      {inNeighborhood && joinRequests.length > 0 && (
        <RequestCards
          abovePrompt={knockPrompt !== null}
          requests={joinRequests}
          textOf={(r) => t('town.join.request', { name: nameOf(r.from) })}
          acceptLabel={t('town.join.accept')}
          declineLabel={t('town.join.decline')}
          onAnswer={answerJoin}
        />
      )}
      {atOwnHome && guests.length > 0 && (
        <GuestList guests={guests} nameOf={nameOf} onAskToLeave={askToLeave} />
      )}
      {signpostOpen && moreGates.length > 0 && (
        <TownSignpost
          owners={moreGates}
          nameOf={nameOf}
          onVisit={visitFromSignpost}
          onClose={() => {
            setSignpostOpen(false);
          }}
        />
      )}
      {videos.length > 0 && (
        <TownVideoWindow videos={videos} isRevealed={isRevealed} onToggleReveal={toggleReveal} />
      )}
      <form
        className={styles.chatBar}
        onSubmit={(e) => {
          e.preventDefault();
          sendChat();
        }}
      >
        <input
          ref={inputRef}
          className={styles.chatInput}
          aria-label={t('town.chat.placeholder')}
          placeholder={t('town.chat.placeholder')}
          maxLength={280}
          onFocus={() => engineRef.current?.setInputEnabled(false)}
          onBlur={() => engineRef.current?.setInputEnabled(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <button type="submit" className={styles.chatSend}>
          {t('town.chat.send')}
        </button>
      </form>
    </div>
  );
}

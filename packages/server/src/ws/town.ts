import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import {
  TOWN_PROXIMITY,
  TOWN_VIEW,
  parseTownSceneId,
  TOWN_JOIN_ASK_MS,
  TOWN_KNOCK_MS,
  TOWN_SQUARE_LAYOUT,
  townArrival,
  townClamp,
  townGateArrival,
  townSceneId,
} from '@protoimsg/shared';
import type {
  PresenceVisibility,
  ServerMessage,
  TownPeer,
  TownGate,
  TownScene,
  TownSceneKind,
  TownSpawn,
  TownVoiceMember,
} from '@protoimsg/shared';
import type { BlockService } from '../moderation/block-service.js';
import type { TownVoice } from '../calls/town-voice.js';
import { createLogger } from '../logger.js';
import { EMPTY_TOWN_GRAPH, type TownGraph } from './town-graph.js';
import type { OwnerBlocks } from './town-blocks.js';

/** Knows no offline owner's blocks: every offline owner's gate stays shut. */
const UNKNOWN_OWNER_BLOCKS: OwnerBlocks = {
  blocks: () => null,
  prefetch: () => {},
};
import { assignRooms, buildClusters, type ClusterRules, type ProxNode } from './town-proximity.js';

const log = createLogger('town');

interface TownMember extends TownPeer {
  id: number;
  ws: WebSocket;
  /** Scene this socket is in (`townSceneId`) — views, chat and voice stay inside it. */
  scene: string;
  /** Its kind, for clamping moves to the scene's bounds. */
  kind: TownSceneKind;
  /** Whose home / neighborhood this is (null in the square). */
  owner: string | null;
  /** Friends-of-friends mode (square): see and be seen only within two steps. */
  fof: boolean;
  /** Square: the gate row this socket was last sent. */
  gates: TownGate[];
  /** Holds a reference in the graph (released on leave). */
  graphRef: boolean;
  /** Square: the signpost list this socket was last sent. */
  moreGates: string[];
  /** Visiting a neighborhood: whether this socket was told it may knock. */
  canKnock: boolean;
  /** Whether this socket was told "ask to join" applies. */
  joinAvailable: boolean;
  /** Outside someone's house: whether this socket was told their window glows. */
  windowLit: boolean;
  moveBudget: number;
  moveBudgetTs: number;
  /** Proximity voice room this socket is assigned to, if any. */
  roomId: string | null;
  /** Anonymous LiveKit identity for the current room. */
  pid: string;
  /** Bumped on every position change — views re-send only what moved. */
  ver: number;
  /** What this socket's client currently shows: DID → `${memberId}:${ver}`. */
  known: Map<string, string>;
}

interface VoiceRoomState {
  /** Bumped per send — a slower, older send never overwrites a newer roster. */
  version: number;
  /** The one createRoom call for this room — tokens wait on it so they never race ahead of the cap. */
  ready: Promise<void>;
}

// Server-side cap on town_move so the rate-limit exemption can't be weaponised:
// a token bucket per socket, generous enough never to throttle honest clients
// (which send ~9/s) but bounding a flood to a fixed O(N) fan-out rate.
const MOVE_RATE = 30; // tokens refilled per second
const MOVE_BURST = 30; // bucket capacity

// Proximity clusters are recomputed at most this often, not per move.
const PROXIMITY_TICK_MS = 200;
// Avatar views are diffed and sent in one batch per viewer at most this often.
const VIEW_TICK_MS = 100;
// Spatial grid for view lookups: a viewer's box spans at most 3×3 cells.
const VIEW_CELL = Math.max(TOWN_VIEW.halfWidth, TOWN_VIEW.halfHeight);
// A new link must hold this long before a room is minted — stops jittering
// across the radius from churning LiveKit rooms.
const LINK_DWELL_MS = 600;
// After a LiveKit failure, pause voice assignment and retry on our own timer
// (not on the next move) — no hammering during an outage, no stuck rooms.
const VOICE_RETRY_MS = 5000;
// How often every active room is checked for participants who shouldn't be
// there (kicked members reconnecting with a still-valid token).
const RECONCILE_MS = 5000;

function cellKey(scene: string, cx: number, cy: number): string {
  return `${scene}|${String(cx)},${String(cy)}`;
}

/** Identity + version of what a viewer was last sent about an avatar. */
function viewKey(m: TownMember): string {
  return `${String(m.id)}:${String(m.ver)}`;
}

function randomId(prefix: string): string {
  return `${prefix}${randomBytes(8).toString('hex')}`;
}

function pairKey(a: ProxNode, b: ProxNode): string {
  return a.id < b.id ? `${String(a.id)}:${String(b.id)}` : `${String(b.id)}:${String(a.id)}`;
}

// Order other people's gates fill the row: outward from your own, in the middle.
const OTHER_GATE_SLOTS = TOWN_SQUARE_LAYOUT.gateSlots
  .map((_, i) => i)
  .filter((i) => i !== TOWN_SQUARE_LAYOUT.ownSlot)
  .sort(
    (a, b) =>
      Math.abs(a - TOWN_SQUARE_LAYOUT.ownSlot) - Math.abs(b - TOWN_SQUARE_LAYOUT.ownSlot) || a - b,
  );
// Knocking: how long a knock waits for an answer (declined, away and
// unanswered all end here, so they look the same to the visitor), and how
// long before the same visitor can knock on the same door again.
const KNOCK_MS = TOWN_KNOCK_MS;
// Minimum gap between knocks from the same person that reach the owner.
const KNOCK_COOLDOWN_MS = 60_000;
// How long a "not now" is remembered, so a returning knock says "again".
const KNOCK_DECLINE_MEMORY_MS = 30 * 60_000;
const KICK_COOLDOWN_MS = 10 * 60_000;
// How often expired knock cooldowns are dropped.
const SWEEP_MS = 60_000;

// Asking to join a conversation: how long before the same person can ask the
// same conversation again, and how long a granted pass may wait for them to
// actually connect before it lapses.
const JOIN_ASK_COOLDOWN_MS = 3 * 60_000;
const JOIN_PASS_GRACE_MS = 10_000;

interface JoinRequest {
  id: string;
  fromWs: WebSocket;
  scene: string;
  roomId: string;
  /** People who'd newly see and hear the asker — each must agree. */
  waitingOn: Set<string>;
  /** Everyone asked. */
  asked: Set<string>;
  /** Asked people whose card is still up. */
  open: Set<string>;
  declined: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Lets two people who otherwise can't see each other share a conversation:
 * granted when everyone in it agreed to let someone join. Lives in memory
 * only, for as long as they're in that conversation together.
 */
interface JoinPass {
  scene: string;
  grantedAt: number;
  /** The conversation it was granted for (followed if its id changes). */
  roomId: string;
  /** They've actually shared it — before that, the pass only waits briefly. */
  connected: boolean;
}

interface Knock {
  id: string;
  owner: string;
  visitorWs: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  /** The owner said "not now": it just runs out, like any unanswered knock. */
  declined: boolean;
  /** The owner was told (so they need telling when it ends). */
  notified: boolean;
}

// Bounds the signpost list (and the message carrying it).
const MAX_MORE_GATES = 100;

function didPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sameGates(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * In-memory membership for the spatial world ("proto town").
 * Ephemeral by design — positions are never persisted (privacy model:
 * presence is server-only and transient). Every socket is in exactly one
 * scene (a home, a neighborhood or the square); avatars, chat and voice
 * never cross scenes, so who can see you is decided by where you are.
 *
 * Also runs proximity voice: avatars close together form a cluster (the
 * "aura mesh") and the server — never the client — decides who shares a
 * LiveKit room. Safety rules, all fail-closed:
 * - blocked pairs never share a room, even through a third person;
 * - nobody is voice-eligible until their block list has synced;
 * - scenes are admission-checked on entry and never leak into each other,
 *   and re-checked whenever relationships or blocks change (removed → square);
 * - inside a scene, who sees and hears whom follows its rule (`canSee`):
 *   a neighborhood shows you its owner and your mutuals, and the square is
 *   open unless friends-of-friends mode narrows it;
 * - removed participants are evicted, and rooms are reconciled against the
 *   expected roster because LiveKit tokens can't be revoked.
 */
export class TownRoom {
  private members = new Map<WebSocket, TownMember>();
  private nextId = 1;
  private proximityTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private voiceBackoffUntil = 0;
  /** Rooms whose roster must be re-sent on the next tick. */
  private pendingDirty = new Set<string>();
  /** When each not-yet-linked close pair first came within range. */
  private closeSince = new Map<string, number>();
  private rooms = new Map<string, VoiceRoomState>();
  /** DIDs with friends-of-friends mode on in any of their sockets. */
  private fofDids = new Set<string>();
  /** Knocks waiting for an answer, by id. */
  private knocks = new Map<string, Knock>();
  /** Owner → DIDs they let in (valid while the guest stays inside). */
  private guests = new Map<string, Set<string>>();
  /** Owners who closed their door to knocks. */
  private knockingClosed = new Set<string>();
  /**
   * Who each person lets see them online (their latest status_change).
   * Unknown counts as nobody — a window never glows on a guess.
   */
  private visibility = new Map<string, PresenceVisibility>();
  /** `${owner}|${visitor}` → time the visitor's knock may reach the owner again. */
  private knockCooldowns = new Map<string, number>();
  /** `${owner}|${visitor}` → when the owner last said "not now". */
  private knockDeclines = new Map<string, number>();
  /** Requests to join a conversation, by id. */
  private joinRequests = new Map<string, JoinRequest>();
  /** `${asker}|${asked}` → time `asker` may ask that person again. */
  private joinCooldowns = new Map<string, number>();
  /** Sorted `${didA}|${didB}` → pass letting them share a conversation. */
  private joinPasses = new Map<string, JoinPass>();

  constructor(
    private blockService: BlockService,
    private voice: TownVoice | null = null,
    private graph: TownGraph = { ...EMPTY_TOWN_GRAPH },
    private ownerBlockLists: OwnerBlocks = { ...UNKNOWN_OWNER_BLOCKS },
  ) {
    graph.onChange = () => {
      this.recheckAll();
    };
    ownerBlockLists.onLoaded = () => {
      this.recheckAll();
    };
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const map of [this.knockCooldowns, this.joinCooldowns]) {
        for (const [key, until] of map) {
          if (until <= now) map.delete(key);
        }
      }
      for (const [key, at] of this.knockDeclines) {
        if (now - at >= KNOCK_DECLINE_MEMORY_MS) this.knockDeclines.delete(key);
      }
    }, SWEEP_MS);
    this.sweepTimer.unref();
    if (voice) {
      this.reconcileTimer = setInterval(() => {
        for (const roomId of this.rooms.keys()) this.reconcileRoom(roomId);
      }, RECONCILE_MS);
      this.reconcileTimer.unref();
    }
  }

  /**
   * `join`, after loading the socket's relationships on its first join (so
   * admission and visibility rules can be answered synchronously).
   */
  async enter(
    ws: WebSocket,
    did: string,
    sceneId: string | undefined,
    x: number,
    y: number,
    dir: number,
    fof?: boolean,
  ): Promise<void> {
    const existing = this.members.get(ws);
    // Load relationships on the first join — and retry on later joins if an
    // earlier load failed (until then the socket has no gates or mutuals).
    let acquired = false;
    if (!existing?.graphRef) {
      acquired = await this.graph.acquire(did);
      // The socket closed (or the town shut down) while we were loading.
      if (this.disposed || ws.readyState !== ws.OPEN) {
        if (acquired) this.graph.release(did);
        return;
      }
    }
    this.join(ws, did, sceneId, x, y, dir, fof);
    const m = this.members.get(ws);
    if (acquired) {
      if (m && !m.graphRef) m.graphRef = true;
      else this.graph.release(did); // refused entry, or a ref already held
    }
  }

  /**
   * Enter a scene — the first join, a reconnect, or walking through a door.
   * `sceneId` undefined means your own home. Refused entry leaves the socket
   * exactly where it was.
   */
  join(
    ws: WebSocket,
    did: string,
    sceneId: string | undefined,
    x: number,
    y: number,
    dir: number,
    fof?: boolean,
  ): void {
    const scene: TownScene | null =
      sceneId === undefined ? { kind: 'home', owner: did } : parseTownSceneId(sceneId);
    if (
      scene?.kind === 'home' &&
      scene.owner !== did &&
      !this.members.has(ws) &&
      !this.admits(did, scene)
    ) {
      // Reconnecting into someone's home you were a guest in (the dropped
      // socket gave up the pass): the visit's over — out to their doormat,
      // or your own home.
      const outside: TownScene = { kind: 'neighborhood', owner: scene.owner };
      const fallback: TownScene = this.admits(did, outside)
        ? outside
        : { kind: 'home', owner: did };
      this.place(ws, did, fallback, townArrival(fallback.kind, 'home'), 'visitOver', fof);
      return;
    }
    if (!scene || !this.admits(did, scene)) {
      this.sendTo(ws, { type: 'town_denied', data: { scene: sceneId ?? '' } });
      return;
    }
    this.place(ws, did, scene, { ...townClamp(scene.kind, x, y), dir }, undefined, fof);
  }

  /** Friends-of-friends mode on/off for this socket (applies in the square). */
  setFof(ws: WebSocket, on: boolean): void {
    const m = this.members.get(ws);
    if (!m || m.fof === on) return;
    m.fof = on;
    this.recountFof();
    this.scheduleView();
    this.scheduleProximity();
  }

  /** Forward a community-list sync to the graph (it calls back via onChange). */
  communityChanged(owner: string, members: string[], innerCircle: string[] = []): void {
    this.graph.communityChanged?.(owner, members, innerCircle);
  }

  /**
   * May `did` enter `scene`? The square is open. Your own home and
   * neighborhood are always yours. Someone else's neighborhood needs you in
   * their community (and no block either way). Other homes stay closed until
   * knocking arrives — fail closed.
   */
  private admits(did: string, scene: TownScene): boolean {
    if (scene.kind === 'square' || scene.owner === did) return true;
    if (scene.kind === 'home') {
      // Only someone the owner let in — and never across a block.
      return (
        (this.guests.get(scene.owner)?.has(did) ?? false) && !this.blockedByOrOf(scene.owner, did)
      );
    }
    return this.graph.gatesFor(did).has(scene.owner) && !this.blockedByOrOf(scene.owner, did);
  }

  /**
   * Is there a block between neighborhood owner and `did`? The visitor's own
   * blocks are always synced (they're connected); the owner's are known if
   * they're connected too, otherwise read from their public block records.
   * Not known yet counts as blocked.
   */
  private blockedByOrOf(owner: string, did: string): boolean {
    if (this.blockService.isBlocked(did, owner)) return true;
    if (this.blockService.hasSynced(owner)) return false;
    return this.ownerBlockLists.blocks(owner, did) ?? true;
  }

  private mutualsFirst(did: string): (a: string, b: string) => number {
    return (a, b) =>
      Number(this.graph.mutual(did, b)) - Number(this.graph.mutual(did, a)) ||
      (a < b ? -1 : a > b ? 1 : 0);
  }

  /**
   * Who `a` may see (and hear) in its scene — symmetric, so voice can use it
   * as cluster compatibility. Blocks always win.
   */
  private canSee(a: TownMember, b: TownMember): boolean {
    if (a.scene !== b.scene || a.did === b.did) return false;
    if (this.blockService.isBlocked(a.did, b.did)) return false;
    if (a.kind === 'neighborhood') {
      return (
        a.did === a.owner ||
        b.did === a.owner ||
        this.graph.mutual(a.did, b.did) ||
        this.joinPasses.get(didPair(a.did, b.did))?.scene === a.scene
      );
    }
    if (a.kind === 'square') {
      const narrowed = this.fofDids.has(a.did) || this.fofDids.has(b.did);
      return !narrowed || this.graph.friendOfFriend(a.did, b.did);
    }
    return true;
  }

  /** Your gate row in the square: yours in the middle, then theirs outward. */
  private gateRowFor(did: string): { gates: TownGate[]; more: string[] } {
    const listed = [...this.graph.gatesFor(did)].filter((o) => o !== did);
    // Offline owners' block lists load in the background; their gates
    // appear once we know they haven't blocked you.
    this.ownerBlockLists.prefetch(
      listed.filter((o) => !this.blockService.hasSynced(o)).sort(this.mutualsFirst(did)),
    );
    const owners = listed.filter((o) => !this.blockedByOrOf(o, did));
    // Mutuals first, then alphabetical. Never by who's online — the order
    // would reveal it, even for someone hidden at home.
    owners.sort(this.mutualsFirst(did));
    const gates: TownGate[] = [{ owner: did, slot: TOWN_SQUARE_LAYOUT.ownSlot }];
    owners.slice(0, OTHER_GATE_SLOTS.length).forEach((owner, i) => {
      const slot = OTHER_GATE_SLOTS[i];
      if (slot !== undefined) gates.push({ owner, slot });
    });
    return { gates, more: owners.slice(OTHER_GATE_SLOTS.length, MAX_MORE_GATES) };
  }

  /**
   * Put a socket into an (already admitted) scene and send it the scene's
   * state. `requested` is where a fresh join / reconnect says it is.
   */
  private place(
    ws: WebSocket,
    did: string,
    scene: TownScene,
    requested: TownSpawn,
    reason?: 'removed' | 'letIn' | 'visitOver',
    fof?: boolean,
  ): void {
    const id = townSceneId(scene);
    const prev = this.members.get(ws);
    const canKnock =
      scene.kind === 'neighborhood' && scene.owner !== did
        ? this.canKnock(scene.owner, did)
        : undefined;
    const knockingOpen =
      scene.kind === 'home' && scene.owner === did ? !this.knockingClosed.has(did) : undefined;
    const windowLit =
      scene.kind === 'neighborhood' && scene.owner !== did
        ? this.windowLitFor(scene.owner, did)
        : false;
    const row = scene.kind === 'square' ? this.gateRowFor(did) : null;
    // Through a door, the server places you at the scene's arrival point —
    // a client never picks where it lands: out of a neighborhood, below its
    // gate. Otherwise (first join, reconnect) trust the clamped position.
    let place = requested;
    if (prev && prev.scene !== id) {
      const fromGate =
        row && prev.kind === 'neighborhood'
          ? row.gates.find((g) => g.owner === prev.owner)
          : undefined;
      place = fromGate ? townGateArrival(fromGate.slot) : townArrival(scene.kind, prev.kind);
    }

    // A re-join into the same scene keeps its voice assignment, and gets it
    // re-sent (the client may have rebuilt its voice connection). Changing
    // scene drops it at once — voice never follows you through a door.
    let roomId = prev?.roomId ?? null;
    let pid = prev?.pid ?? '';
    if (prev && roomId && prev.scene !== id) {
      this.voice?.removeParticipant(roomId, pid);
      this.pendingDirty.add(roomId);
      // Tokens can't be revoked: sweep the old room now rather than on the
      // next reconcile interval, so a reused token can't slip back in.
      this.reconcileRoom(roomId);
      this.sendTo(ws, { type: 'town_proximity', data: { room: null } });
      roomId = null;
      pid = '';
    }
    this.members.set(ws, {
      id: prev?.id ?? this.nextId++,
      ws,
      did,
      scene: id,
      kind: scene.kind,
      owner: scene.kind === 'square' ? null : scene.owner,
      fof: fof ?? prev?.fof ?? false,
      gates: row?.gates ?? [],
      graphRef: prev?.graphRef ?? false,
      moreGates: row?.more ?? [],
      canKnock: canKnock ?? false,
      // Re-sent after the next proximity tick if it applies here.
      joinAvailable: false,
      windowLit,
      x: place.x,
      y: place.y,
      dir: place.dir,
      sprint: false,
      moveBudget: MOVE_BURST,
      moveBudgetTs: Date.now(),
      roomId,
      pid,
      ver: (prev?.ver ?? 0) + 1,
      known: new Map(),
    });
    if (roomId) this.pendingDirty.add(roomId);
    // Friends-of-friends from the join must narrow the very first view.
    if ((fof ?? prev?.fof ?? false) !== (prev?.fof ?? false)) this.recountFof();

    // Your initial view, sent directly; everyone else learns about you on the
    // next view tick.
    const self = this.members.get(ws);
    const peers: TownPeer[] = [];
    if (self) {
      for (const [peerDid, m] of this.viewOf(self, this.buildViewGrid())) {
        self.known.set(peerDid, viewKey(m));
        peers.push({
          did: m.did,
          x: m.x,
          y: m.y,
          dir: m.dir,
          ...(m.sprint ? { sprint: true } : {}),
        });
      }
    }
    this.sendTo(ws, {
      type: 'town_state',
      data: {
        scene: id,
        self: place,
        peers,
        voice: this.voice !== null,
        voiceUrl: this.voice?.url,
        ...(row ? { gates: row.gates, moreGates: row.more } : {}),
        ...(canKnock !== undefined ? { canKnock } : {}),
        ...(knockingOpen !== undefined ? { knockingOpen } : {}),
        ...(scene.kind === 'neighborhood' && scene.owner !== did ? { windowLit } : {}),
        ...(reason ? { reason } : {}),
      },
    });
    if (prev && prev.scene !== id) this.leftScene(prev);
    if (scene.kind === 'home' && scene.owner === did) this.sendGuests(did);
    // The owner came home or went out: their window changes for visitors.
    const homeOwner = scene.kind === 'home' ? scene.owner : null;
    if (homeOwner === did || (prev?.kind === 'home' && prev.owner === did)) {
      this.refreshWindows(did);
    }
    this.scheduleView();
    this.scheduleProximity();
  }

  // ── Knocking and guests ───────────────────────────────────────────────

  /** A visitor knocks on the door of the neighborhood they're in. */
  knock(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m || m.kind !== 'neighborhood' || !m.owner || m.owner === m.did) return;
    if ([...this.knocks.values()].some((k) => k.visitorWs === ws)) return; // one at a time
    const owner = m.owner;
    const knock: Knock = {
      id: randomId('k_'),
      owner,
      visitorWs: ws,
      declined: false,
      notified: false,
      timer: setTimeout(() => {
        this.endKnock(knock, true);
      }, KNOCK_MS),
    };
    knock.timer.unref();
    this.knocks.set(knock.id, knock);

    // Whatever happens next, the visitor sees the same thing: either the
    // door opens, or after KNOCK_MS, "no answer". The owner hears it if all
    // of this holds — including after a "not now": the owner decides again,
    // and is told it's a repeat.
    const key = `${owner}|${m.did}`;
    const now = Date.now();
    const until = this.knockCooldowns.get(key) ?? 0;
    const allowed = this.canKnock(owner, m.did) && !this.knockingClosed.has(owner) && until <= now;
    if (!allowed) return;
    const atHome = this.ownerAtHome(owner);
    if (atHome.length === 0) return;
    // Only a knock that reached the owner starts the gap — attempts during
    // it don't stretch it, and it never shortens a longer one (a kick's).
    this.knockCooldowns.set(key, Math.max(until, now + KNOCK_COOLDOWN_MS));
    const declinedAt = this.knockDeclines.get(key);
    const again = declinedAt !== undefined && now - declinedAt < KNOCK_DECLINE_MEMORY_MS;
    knock.notified = true;
    for (const o of atHome) {
      this.sendTo(o.ws, {
        type: 'town_knock_request',
        data: { knockId: knock.id, from: m.did, ...(again ? { again } : {}) },
      });
    }
  }

  /** The owner answers a knock from inside their home. */
  answerKnock(ws: WebSocket, knockId: string, letIn: boolean): void {
    const m = this.members.get(ws);
    const knock = this.knocks.get(knockId);
    if (
      !m ||
      !knock ||
      knock.declined ||
      m.did !== knock.owner ||
      m.scene !== townSceneId({ kind: 'home', owner: m.did })
    ) {
      return;
    }
    if (!letIn) {
      // Closes every card, in every tab, but says nothing to the visitor yet:
      // they hear "no answer" when the knock runs out, like any other.
      knock.declined = true;
      const visitor = this.members.get(knock.visitorWs);
      if (visitor) this.knockDeclines.set(`${m.did}|${visitor.did}`, Date.now());
      this.dismissKnock(knock);
      return;
    }
    const visitor = this.members.get(knock.visitorWs);
    if (!visitor) return;
    const home: TownScene = { kind: 'home', owner: m.did };
    let set = this.guests.get(m.did);
    if (!set) {
      set = new Set();
      this.guests.set(m.did, set);
    }
    set.add(visitor.did);
    if (!this.admits(visitor.did, home)) {
      // A block landed in between: treat it as declined, so the visitor
      // hears "no answer" at the usual time.
      set.delete(visitor.did);
      knock.declined = true;
      this.dismissKnock(knock);
      return;
    }
    this.endKnock(knock, false);
    this.place(visitor.ws, visitor.did, home, townArrival('home', 'neighborhood'), 'letIn');
    this.knockCooldowns.delete(`${m.did}|${visitor.did}`);
    this.knockDeclines.delete(`${m.did}|${visitor.did}`);
    this.sendGuests(m.did);
  }

  /** The owner asks a guest to leave. They stay in the inner circle. */
  kick(ws: WebSocket, guest: string): void {
    const m = this.members.get(ws);
    if (!m || m.scene !== townSceneId({ kind: 'home', owner: m.did })) return;
    if (!this.guests.get(m.did)?.delete(guest)) return;
    this.knockCooldowns.set(`${m.did}|${guest}`, Date.now() + KICK_COOLDOWN_MS);
    this.walkGuestOut(m.did, guest);
    this.sendGuests(m.did);
  }

  /** The owner opens or closes their door to knocks — for all their tabs. */
  setKnocking(ws: WebSocket, open: boolean): void {
    const m = this.members.get(ws);
    if (!m) return;
    if (open === !this.knockingClosed.has(m.did)) return;
    if (open) this.knockingClosed.delete(m.did);
    else this.knockingClosed.add(m.did);
    for (const o of this.members.values()) {
      if (o.did === m.did) this.sendTo(o.ws, { type: 'town_door', data: { open } });
    }
  }

  // ── Asking to join a conversation ─────────────────────────────────────

  /**
   * Ask to join the nearest conversation (in a neighborhood) that you can't
   * join because some of its people aren't your mutuals. Everyone who'd newly
   * see and hear you is asked; whatever happens, you hear back either
   * `accepted` or — after TOWN_JOIN_ASK_MS — `noAnswer`.
   */
  askToJoin(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m || m.kind !== 'neighborhood') return;
    if ([...this.joinRequests.values()].some((r) => r.fromWs === ws)) return; // one at a time

    // The conversation: whoever nearest you can see is in a room you're not.
    const roomId = this.nearestOtherRoom(m) ?? '';
    const request: JoinRequest = {
      id: randomId('j_'),
      fromWs: ws,
      scene: m.scene,
      roomId,
      waitingOn: new Set(),
      asked: new Set(),
      open: new Set(),
      declined: false,
      timer: setTimeout(() => {
        this.endJoinRequest(request, 'noAnswer');
      }, TOWN_JOIN_ASK_MS),
    };
    request.timer.unref();
    this.joinRequests.set(request.id, request);
    if (!roomId) return; // nothing to join: just "no answer"

    const inRoom = this.roomMembers(roomId).filter((r) => r.scene === m.scene);
    const unseen = new Set(inRoom.filter((r) => !this.canSee(m, r)).map((r) => r.did));
    // Cooldowns are per person asked (room ids change all the time), and
    // only an ask that reached them starts one — retries don't stretch it.
    const now = Date.now();
    const cooling = [...unseen].some((d) => (this.joinCooldowns.get(`${m.did}|${d}`) ?? 0) > now);
    // Never across a block, never into a full room, never while cooling down.
    // The asker can't tell which: it's all "no answer".
    if (
      cooling ||
      unseen.size === 0 ||
      inRoom.some((r) => this.blockService.isBlocked(m.did, r.did)) ||
      new Set(inRoom.map((r) => r.did)).size >= TOWN_PROXIMITY.maxClusterSize
    ) {
      return;
    }
    request.waitingOn = new Set(unseen);
    request.asked = new Set(unseen);
    request.open = new Set(unseen);
    for (const d of unseen) this.joinCooldowns.set(`${m.did}|${d}`, now + JOIN_ASK_COOLDOWN_MS);
    for (const r of inRoom) {
      if (request.asked.has(r.did)) {
        this.sendTo(r.ws, {
          type: 'town_join_request',
          data: { requestId: request.id, from: m.did },
        });
      }
    }
  }

  /** The room of whoever nearest `m` can see is in a conversation `m` isn't. */
  private nearestOtherRoom(m: TownMember): string | null {
    let nearest: TownMember | null = null;
    let best = TOWN_PROXIMITY.joinRadius ** 2;
    for (const o of this.members.values()) {
      if (!o.roomId || o.roomId === m.roomId || !this.canSee(m, o)) continue;
      const d2 = (o.x - m.x) ** 2 + (o.y - m.y) ** 2;
      if (d2 < best) {
        best = d2;
        nearest = o;
      }
    }
    return nearest?.roomId ?? null;
  }

  /**
   * Would asking to join do anything? A neighborhood conversation next to `m`
   * has someone `m` can't see, no block, and room to spare. (Cooldowns aren't
   * revealed here — asking during one is just "no answer".)
   */
  private joinApplies(m: TownMember): boolean {
    if (m.kind !== 'neighborhood') return false;
    const roomId = this.nearestOtherRoom(m);
    if (!roomId) return false;
    const inRoom = this.roomMembers(roomId).filter((r) => r.scene === m.scene);
    if (inRoom.some((r) => this.blockService.isBlocked(m.did, r.did))) return false;
    if (new Set(inRoom.map((r) => r.did)).size >= TOWN_PROXIMITY.maxClusterSize) return false;
    return inRoom.some((r) => !this.canSee(m, r));
  }

  /** Someone asked answers. Everyone asked must agree. */
  answerJoin(ws: WebSocket, requestId: string, accept: boolean): void {
    const m = this.members.get(ws);
    const request = this.joinRequests.get(requestId);
    if (!m || !request || request.declined || !request.waitingOn.has(m.did)) return;
    if (m.roomId !== request.roomId) return; // left the conversation: can't vote
    const asker = this.members.get(request.fromWs);
    if (!accept) {
      // Only the decliner's card goes now; the others stay up until the usual
      // end and the asker hears "no answer" then — nobody learns who said no.
      request.declined = true;
      this.closeJoinCards(request, m.did);
      return;
    }
    request.waitingOn.delete(m.did);
    this.closeJoinCards(request, m.did);
    if (request.waitingOn.size > 0) return;
    if (!asker || asker.scene !== request.scene || !this.joinStillConsented(request, asker)) {
      // The conversation changed under the request: someone who wasn't asked
      // is there now, someone asked left, or a block landed. No pass.
      request.declined = true;
      return;
    }
    const now = Date.now();
    for (const did of request.asked) {
      this.joinPasses.set(didPair(asker.did, did), {
        scene: request.scene,
        grantedAt: now,
        roomId: request.roomId,
        connected: false,
      });
    }
    // Make sure an unused pass lapses on time even in a quiet town.
    setTimeout(() => {
      this.scheduleProximity();
    }, JOIN_PASS_GRACE_MS + 100).unref();
    this.endJoinRequest(request, 'accepted');
    this.scheduleView();
    this.scheduleProximity();
  }

  /**
   * Everyone asked is still in the conversation, everyone in it who can't
   * see the asker was asked, and no block has landed.
   */
  private joinStillConsented(request: JoinRequest, asker: TownMember): boolean {
    const inRoom = this.roomMembers(request.roomId).filter((r) => r.scene === request.scene);
    const present = new Set(inRoom.map((r) => r.did));
    if ([...request.asked].some((d) => !present.has(d))) return false;
    for (const r of inRoom) {
      if (this.blockService.isBlocked(asker.did, r.did)) return false;
      if (!this.canSee(asker, r) && !request.asked.has(r.did)) return false;
    }
    return true;
  }

  /** Take down request cards — one person's, or (default) every open one. */
  private closeJoinCards(request: JoinRequest, only?: string): void {
    for (const r of this.members.values()) {
      if (r.scene !== request.scene || !request.open.has(r.did)) continue;
      if (only && r.did !== only) continue;
      this.sendTo(r.ws, { type: 'town_join_request_end', data: { requestId: request.id } });
    }
    if (only) request.open.delete(only);
    else request.open = new Set();
  }

  private endJoinRequest(request: JoinRequest, outcome: 'accepted' | 'noAnswer' | null): void {
    if (!this.joinRequests.delete(request.id)) return;
    clearTimeout(request.timer);
    this.closeJoinCards(request);
    if (outcome && this.members.has(request.fromWs)) {
      this.sendTo(request.fromWs, { type: 'town_join_result', data: { outcome } });
    }
  }

  /**
   * A pass lasts while the pair share the conversation it was granted for
   * (following it if its id changes when groups merge), or — before they've
   * connected — for a short grace period. Runs before clustering, on the
   * rooms as they stand. Returns whether any ended.
   */
  private expireJoinPasses(now: number): boolean {
    if (this.joinPasses.size === 0) return false;
    const roomOf = new Map<string, string>();
    for (const m of this.members.values()) {
      if (m.roomId) roomOf.set(`${m.scene}|${m.did}`, m.roomId);
    }
    let ended = false;
    for (const [pair, pass] of this.joinPasses) {
      const [a, b] = pair.split('|');
      const ra = roomOf.get(`${pass.scene}|${a ?? ''}`);
      const rb = roomOf.get(`${pass.scene}|${b ?? ''}`);
      if (ra && ra === rb) {
        if (ra === pass.roomId) {
          pass.connected = true;
          continue;
        }
        // Same people, new room id: their conversation merged or re-formed.
        if (pass.connected && !this.rooms.has(pass.roomId)) {
          pass.roomId = ra;
          continue;
        }
      } else if (!pass.connected && now - pass.grantedAt < JOIN_PASS_GRACE_MS) {
        continue;
      }
      this.joinPasses.delete(pair);
      ended = true;
    }
    return ended;
  }

  // ── The lit window ────────────────────────────────────────────────────

  /** `did` changed who may see them online (their window may need updating). */
  setVisibility(did: string, visibleTo: PresenceVisibility | undefined): void {
    const next = visibleTo ?? this.visibility.get(did) ?? 'no-one';
    if (this.visibility.get(did) === next) return;
    this.visibility.set(did, next);
    this.refreshWindows(did);
  }

  /** `did`'s last connection closed: their presence is gone, so is the window. */
  forgetVisibility(did: string): void {
    if (!this.visibility.delete(did)) return;
    this.refreshWindows(did);
  }

  /**
   * Does `owner`'s window glow for `viewer`? Only when the owner is inside,
   * visible to anyone at all, and the viewer is in their inner circle — home
   * is an inner-circle place, whatever the owner's wider setting says (a
   * reconnect can re-send that wider setting while they sit at home).
   */
  private windowLitFor(owner: string, viewer: string): boolean {
    if (owner === viewer || this.blockedByOrOf(owner, viewer)) return false;
    if (this.ownerAtHome(owner).length === 0) return false;
    if ((this.visibility.get(owner) ?? 'no-one') === 'no-one') return false;
    return this.graph.inInnerCircle(owner, viewer);
  }

  /** Re-check the window for everyone outside `owner`'s house (or all houses). */
  private refreshWindows(owner?: string): void {
    for (const m of this.members.values()) {
      if (m.kind !== 'neighborhood' || !m.owner || m.owner === m.did) continue;
      if (owner && m.owner !== owner) continue;
      const lit = this.windowLitFor(m.owner, m.did);
      if (lit !== m.windowLit) {
        m.windowLit = lit;
        this.sendTo(m.ws, { type: 'town_window', data: { lit } });
      }
    }
  }

  /** In `owner`'s inner circle, with no block either way. */
  private canKnock(owner: string, did: string): boolean {
    return this.graph.inInnerCircle(owner, did) && !this.blockedByOrOf(owner, did);
  }

  /** Every socket of `owner` currently inside their own home. */
  private ownerAtHome(owner: string): TownMember[] {
    const id = townSceneId({ kind: 'home', owner });
    return [...this.members.values()].filter((o) => o.did === owner && o.scene === id);
  }

  private dismissKnock(knock: Knock): void {
    // A knock the owner never heard ends silently — even its ending would
    // tell them someone knocked (say, at a closed door).
    if (!knock.notified) return;
    knock.notified = false;
    for (const o of this.ownerAtHome(knock.owner)) {
      this.sendTo(o.ws, { type: 'town_knock_end', data: { knockId: knock.id } });
    }
  }

  /** Stop tracking a knock; `noAnswer` tells the visitor it went unanswered. */
  private endKnock(knock: Knock, noAnswer: boolean): void {
    if (!this.knocks.delete(knock.id)) return;
    clearTimeout(knock.timer);
    this.dismissKnock(knock);
    if (noAnswer && this.members.has(knock.visitorWs)) {
      this.sendTo(knock.visitorWs, { type: 'town_knock_result', data: { outcome: 'noAnswer' } });
    }
  }

  /** Walk every socket of `guest` inside `owner`'s home back out to the doormat. */
  private walkGuestOut(owner: string, guest: string): void {
    const home = townSceneId({ kind: 'home', owner });
    const outside: TownScene = { kind: 'neighborhood', owner };
    for (const g of [...this.members.values()]) {
      if (g.did !== guest || g.scene !== home) continue;
      if (this.admits(guest, outside)) {
        this.place(g.ws, guest, outside, townArrival('neighborhood', 'home'), 'visitOver');
      } else {
        this.place(g.ws, guest, { kind: 'square' }, townArrival('square', null), 'removed');
      }
    }
  }

  private sendGuests(owner: string): void {
    const guests = [...(this.guests.get(owner) ?? [])];
    for (const o of this.ownerAtHome(owner)) {
      this.sendTo(o.ws, { type: 'town_guests', data: { guests } });
    }
  }

  /** `m` (its previous state) just left its scene — or town. */
  private leftScene(m: TownMember): void {
    // A knock, or a request to join, is withdrawn by walking away.
    for (const k of [...this.knocks.values()]) {
      if (k.visitorWs === m.ws) this.endKnock(k, false);
    }
    for (const r of [...this.joinRequests.values()]) {
      if (r.fromWs === m.ws) this.endJoinRequest(r, null);
    }
    // Passes are for one conversation in one scene: leaving the scene ends them.
    if (![...this.members.values()].some((o) => o.did === m.did && o.scene === m.scene)) {
      for (const [pair, pass] of this.joinPasses) {
        if (pass.scene === m.scene && pair.split('|').includes(m.did)) this.joinPasses.delete(pair);
      }
    }
    if (m.kind !== 'home' || !m.owner) return;
    const home = m.scene;
    const stillInside = [...this.members.values()].some((o) => o.did === m.did && o.scene === home);
    if (stillInside) return;
    if (m.did === m.owner) {
      // The owner stepped out: the visit is over for everyone inside.
      const set = this.guests.get(m.owner);
      this.guests.delete(m.owner);
      for (const guest of set ?? []) this.walkGuestOut(m.owner, guest);
    } else if (this.guests.get(m.owner)?.delete(m.did)) {
      // A guest leaving gives up their pass; coming back means knocking again.
      this.sendGuests(m.owner);
    }
  }

  /**
   * Relationships or blocks changed: move anyone no longer allowed where they
   * are out to the square, refresh changed gate rows, and re-diff every view
   * and voice cluster.
   */
  private recheckAll(): void {
    if (this.disposed) return;
    const removed: TownMember[] = [];
    for (const m of this.members.values()) {
      if (m.kind === 'square') {
        const row = this.gateRowFor(m.did);
        if (!sameGates(row.gates, m.gates) || !sameGates(row.more, m.moreGates)) {
          m.gates = row.gates;
          m.moreGates = row.more;
          this.sendTo(m.ws, {
            type: 'town_gates',
            data: { gates: row.gates, moreGates: row.more },
          });
        }
      } else if (m.owner && !this.admits(m.did, { kind: m.kind, owner: m.owner })) {
        removed.push(m);
      } else if (m.kind === 'neighborhood' && m.owner && m.owner !== m.did) {
        // The owner may have edited their inner circle: keep the door honest.
        const canKnock = this.canKnock(m.owner, m.did);
        if (canKnock !== m.canKnock) {
          m.canKnock = canKnock;
          this.sendTo(m.ws, { type: 'town_knock_access', data: { canKnock } });
        }
      }
    }
    this.refreshWindows();
    // A block between asker and anyone asked quietly ends the request (the
    // asker still hears "no answer" at the usual time).
    for (const r of this.joinRequests.values()) {
      const asker = this.members.get(r.fromWs);
      if (!asker || r.declined) continue;
      if ([...r.asked].some((d) => this.blockService.isBlocked(asker.did, d))) {
        r.declined = true;
        this.closeJoinCards(r);
      }
    }
    for (const m of removed) {
      log.info({ scene: m.scene }, 'Moving a visitor out of a scene they lost access to');
      this.place(m.ws, m.did, { kind: 'square' }, townArrival('square', null), 'removed');
    }
    this.scheduleView();
    this.scheduleProximity();
  }

  private recountFof(): void {
    this.fofDids = new Set([...this.members.values()].filter((m) => m.fof).map((m) => m.did));
  }

  move(ws: WebSocket, x: number, y: number, dir: number, sprint = false): void {
    const m = this.members.get(ws);
    if (!m || !this.consumeMoveToken(m)) return;
    const pos = townClamp(m.kind, x, y);
    m.x = pos.x;
    m.y = pos.y;
    m.dir = dir;
    m.sprint = sprint;
    m.ver++;
    this.scheduleView();
    this.scheduleProximity();
  }

  chat(ws: WebSocket, text: string): void {
    const m = this.members.get(ws);
    if (!m) return;
    // Echoed to everyone, including the sender, so all clients render the
    // bubble identically. `text` is relayed verbatim — clients MUST render it
    // as plain text (the Pixi bubble uses Text, never markup).
    const payload = JSON.stringify({ type: 'town_chat', data: { did: m.did, text } });
    for (const v of this.members.values()) {
      // You always see your own bubble; others only if they share your scene
      // and you're in their view.
      // canSee too: `known` can trail a visibility change (a block, friends-
      // of-friends mode) by up to a view tick.
      const sees = v.ws === ws || (v.known.has(m.did) && this.canSee(v, m));
      if (sees && v.ws.readyState === v.ws.OPEN) v.ws.send(payload);
    }
  }

  leave(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m) return;
    this.members.delete(ws);
    if (m.graphRef) this.graph.release(m.did);
    if (m.fof) this.recountFof();
    this.leftScene(m);
    if (m.kind === 'home' && m.owner === m.did) this.refreshWindows(m.did);
    if (m.roomId) {
      this.voice?.removeParticipant(m.roomId, m.pid);
      // Remaining members need a roster without this pid.
      this.pendingDirty.add(m.roomId);
      this.scheduleProximity();
    }
    // Viewers drop the avatar on the next view tick — unless another visible
    // socket of the same DID keeps it alive.
    this.scheduleView();
  }

  private scheduleView(): void {
    if (this.disposed || this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.flushViews();
    }, VIEW_TICK_MS);
  }

  /** Members bucketed by scene + grid cell, one representative socket per DID per scene. */
  private buildViewGrid(): Map<string, TownMember[]> {
    const rep = new Map<string, TownMember>();
    for (const m of this.members.values()) {
      // Several tabs of one DID in a scene: the most recently moved one is the avatar.
      const key = `${m.scene}|${m.did}`;
      const cur = rep.get(key);
      if (!cur || m.ver > cur.ver) rep.set(key, m);
    }
    const grid = new Map<string, TownMember[]>();
    for (const m of rep.values()) {
      const k = cellKey(m.scene, Math.floor(m.x / VIEW_CELL), Math.floor(m.y / VIEW_CELL));
      const bucket = grid.get(k);
      if (bucket) bucket.push(m);
      else grid.set(k, [m]);
    }
    return grid;
  }

  /** Everyone `v` should currently see, by DID. */
  private viewOf(v: TownMember, grid: Map<string, TownMember[]>): Map<string, TownMember> {
    const out = new Map<string, TownMember>();
    const cx = Math.floor(v.x / VIEW_CELL);
    const cy = Math.floor(v.y / VIEW_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of grid.get(cellKey(v.scene, cx + dx, cy + dy)) ?? []) {
          if (!this.canSee(v, m)) continue;
          if (Math.abs(m.x - v.x) > TOWN_VIEW.halfWidth) continue;
          if (Math.abs(m.y - v.y) > TOWN_VIEW.halfHeight) continue;
          out.set(m.did, m);
        }
      }
    }
    return out;
  }

  /** Send each viewer one batched diff of who appeared, moved or left its view. */
  private flushViews(): void {
    if (this.disposed) return;
    const grid = this.buildViewGrid();
    for (const v of this.members.values()) {
      const view = this.viewOf(v, grid);
      const upsert: TownPeer[] = [];
      const remove: string[] = [];
      for (const [did, m] of view) {
        const key = viewKey(m);
        if (v.known.get(did) === key) continue;
        v.known.set(did, key);
        upsert.push({
          did: m.did,
          x: m.x,
          y: m.y,
          dir: m.dir,
          ...(m.sprint ? { sprint: true } : {}),
        });
      }
      for (const did of v.known.keys()) {
        if (!view.has(did)) {
          v.known.delete(did);
          remove.push(did);
        }
      }
      if (upsert.length > 0 || remove.length > 0) {
        this.sendTo(v.ws, { type: 'town_view', data: { upsert, remove } });
      }
    }
  }

  /**
   * Block lists changed: re-check access (a block shuts a neighborhood gate),
   * re-diff every view (a newly blocked avatar vanishes now, not on the next
   * move) and re-evaluate clusters (blocked pairs split).
   */
  refreshBlocks(): void {
    this.recheckAll();
  }

  /** The client lost its voice connection — re-send its room with a fresh token. */
  refreshVoice(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m?.roomId) return;
    this.pendingDirty.add(m.roomId);
    this.scheduleProximity();
  }

  dispose(): void {
    this.disposed = true;
    if (this.proximityTimer) clearTimeout(this.proximityTimer);
    if (this.viewTimer) clearTimeout(this.viewTimer);
    for (const k of this.knocks.values()) clearTimeout(k.timer);
    this.knocks.clear();
    for (const r of this.joinRequests.values()) clearTimeout(r.timer);
    this.joinRequests.clear();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.viewTimer = null;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.proximityTimer = null;
    this.reconcileTimer = null;
  }

  private scheduleProximity(): void {
    if (!this.voice || this.disposed || this.proximityTimer) return;
    const delay = Math.max(PROXIMITY_TICK_MS, this.voiceBackoffUntil - Date.now());
    this.proximityTimer = setTimeout(() => {
      this.proximityTimer = null;
      this.updateProximity();
    }, delay);
  }

  private updateProximity(): void {
    const voice = this.voice;
    if (!voice || this.disposed) return;
    const now = Date.now();
    if (now < this.voiceBackoffUntil) {
      this.scheduleProximity(); // a move queued us early — wait out the backoff
      return;
    }

    // Clusters never span scenes: solve each scene on its own.
    const byId = new Map<number, TownMember>();
    const scenes = new Map<string, ProxNode[]>();
    for (const m of this.members.values()) {
      byId.set(m.id, m);
      const node = { id: m.id, did: m.did, x: m.x, y: m.y, roomId: m.roomId };
      const list = scenes.get(m.scene);
      if (list) list.push(node);
      else scenes.set(m.scene, [node]);
    }

    const prevClose = this.closeSince;
    const nextClose = new Map<string, number>();
    const dwell = { pending: false };
    const rules: ClusterRules = {
      eligible: (n) => this.blockService.hasSynced(n.did),
      compatible: (a, b) => {
        const ma = byId.get(a.id);
        const mb = byId.get(b.id);
        return ma !== undefined && mb !== undefined && this.canSee(ma, mb);
      },
      newLinkReady: (a, b) => {
        const key = pairKey(a, b);
        const since = prevClose.get(key) ?? now;
        nextClose.set(key, since);
        if (now - since >= LINK_DWELL_MS) return true;
        dwell.pending = true;
        return false;
      },
    };
    // Passes that lapsed stop counting before anyone is clustered with them.
    if (this.expireJoinPasses(now)) this.scheduleView();
    const clusters = [...scenes.values()].flatMap((nodes) => buildClusters(nodes, rules));
    this.closeSince = nextClose;
    const roomIds = assignRooms(clusters, () => randomId('town_'));

    const nextRoom = new Map<number, string>();
    clusters.forEach((cluster, i) => {
      const roomId = roomIds[i];
      if (roomId) for (const n of cluster) nextRoom.set(n.id, roomId);
    });

    const dirty = new Set(this.pendingDirty);
    this.pendingDirty.clear();
    for (const m of byId.values()) {
      const target = nextRoom.get(m.id) ?? null;
      if (target === m.roomId) continue;
      if (m.roomId) {
        voice.removeParticipant(m.roomId, m.pid);
        dirty.add(m.roomId);
      }
      m.roomId = target;
      m.pid = target ? randomId('p_') : '';
      if (target) dirty.add(target);
      else this.sendTo(m.ws, { type: 'town_proximity', data: { room: null } });
    }

    const active = new Set(nextRoom.values());
    for (const roomId of this.rooms.keys()) {
      if (!active.has(roomId)) this.rooms.delete(roomId);
    }
    for (const m of byId.values()) {
      const available = this.joinApplies(m);
      if (available !== m.joinAvailable) {
        m.joinAvailable = available;
        this.sendTo(m.ws, { type: 'town_join_available', data: { available } });
      }
    }
    for (const roomId of dirty) {
      if (active.has(roomId)) void this.sendRoom(voice, roomId);
    }

    if (dwell.pending) this.scheduleProximity();
  }

  private roomMembers(roomId: string): TownMember[] {
    return [...this.members.values()].filter((m) => m.roomId === roomId);
  }

  private async sendRoom(voice: TownVoice, roomId: string): Promise<void> {
    let state = this.rooms.get(roomId);
    if (!state) {
      // createRoom once per room (sets the participant cap) — later roster
      // sends just await it instead of paying a LiveKit round-trip each time.
      // A failure drops the state, so the retry creates it again.
      state = {
        version: 0,
        ready: voice.ensureRoom(roomId, TOWN_PROXIMITY.maxClusterSize),
      };
      this.rooms.set(roomId, state);
    }
    const version = ++state.version;
    const ready = state.ready;

    const targets = this.roomMembers(roomId).map((m) => ({ m, pid: m.pid }));
    try {
      await ready;
      const tokens = await Promise.all(targets.map((t) => voice.issueToken(roomId, t.pid)));
      // A newer send for this room supersedes us.
      if (this.rooms.get(roomId) !== state || state.version !== version) return;

      // Roster from live state, not the snapshot — anyone who left while we
      // were signing is already gone from it.
      const live = this.roomMembers(roomId);
      targets.forEach(({ m, pid }, i) => {
        const token = tokens[i];
        if (!token || this.members.get(m.ws) !== m || m.roomId !== roomId || m.pid !== pid) return;
        // Clusters already exclude pairs who can't see each other; this is
        // defense in depth.
        const members: TownVoiceMember[] = live
          .filter((r) => r === m || this.canSee(m, r))
          .map((r) => ({ did: r.did, pid: r.pid }));
        this.sendTo(m.ws, {
          type: 'town_proximity',
          data: { room: { roomId, url: voice.url, token, selfPid: pid, members } },
        });
      });
      this.reconcileRoom(roomId);
    } catch (err) {
      if (this.rooms.get(roomId) !== state) return;
      log.error({ err, roomId }, 'Failed to set up proximity voice room');
      this.voiceBackoffUntil = Date.now() + VOICE_RETRY_MS;
      this.rooms.delete(roomId);
      // Release everyone so the backoff retry re-forms the room cleanly.
      for (const m of this.roomMembers(roomId)) {
        voice.removeParticipant(roomId, m.pid);
        m.roomId = null;
        m.pid = '';
        this.sendTo(m.ws, { type: 'town_proximity', data: { room: null } });
      }
      this.scheduleProximity();
    }
  }

  /** Evict any LiveKit participant who isn't on the room's current roster. */
  private reconcileRoom(roomId: string): void {
    const voice = this.voice;
    if (!voice || this.disposed) return;
    voice
      .listParticipants(roomId)
      .then((identities) => {
        const expected = new Set(this.roomMembers(roomId).map((m) => m.pid));
        for (const identity of identities) {
          if (!expected.has(identity)) {
            log.info({ roomId }, 'Evicting unexpected proximity participant');
            voice.removeParticipant(roomId, identity);
          }
        }
      })
      .catch((err: unknown) => {
        log.debug({ err, roomId }, 'Proximity room reconcile skipped');
      });
  }

  private consumeMoveToken(m: TownMember): boolean {
    const now = Date.now();
    const elapsed = (now - m.moveBudgetTs) / 1000;
    m.moveBudgetTs = now;
    m.moveBudget = Math.min(MOVE_BURST, m.moveBudget + elapsed * MOVE_RATE);
    if (m.moveBudget < 1) return false;
    m.moveBudget -= 1;
    return true;
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}

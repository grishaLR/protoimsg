import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import { TOWN_PROXIMITY, TOWN_VIEW, townZoneAtPixel } from '@protoimsg/shared';
import type { ServerMessage, TownPeer, TownVoiceMember } from '@protoimsg/shared';
import type { BlockService } from '../moderation/block-service.js';
import type { TownVoice } from '../calls/town-voice.js';
import { createLogger } from '../logger.js';
import {
  assignRooms,
  buildClusters,
  zoneOf,
  type ClusterRules,
  type ProxNode,
} from './town-proximity.js';

const log = createLogger('town');

interface TownMember extends TownPeer {
  id: number;
  ws: WebSocket;
  moveBudget: number;
  moveBudgetTs: number;
  /** Proximity voice room this socket is assigned to, if any. */
  roomId: string | null;
  /** Anonymous LiveKit identity for the current room. */
  pid: string;
  /** At home: invisible to everyone else (never in anyone's view). */
  hidden: boolean;
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

function cellKey(cx: number, cy: number): string {
  return `${String(cx)},${String(cy)}`;
}

/** Identity + version of what a viewer was last sent about an avatar. */
function viewKey(m: TownMember): string {
  return `${String(m.id)}:${String(m.ver)}`;
}

function isHome(x: number, y: number): boolean {
  return townZoneAtPixel(x, y) === 'home';
}

function randomId(prefix: string): string {
  return `${prefix}${randomBytes(8).toString('hex')}`;
}

function pairKey(a: ProxNode, b: ProxNode): string {
  return a.id < b.id ? `${String(a.id)}:${String(b.id)}` : `${String(b.id)}:${String(a.id)}`;
}

/**
 * In-memory membership for the shared spatial world ("proto town").
 * Ephemeral by design — positions are never persisted (privacy model:
 * presence is server-only and transient). A single shared instance backs
 * the one public town.
 *
 * Also runs proximity voice: avatars close together form a cluster (the
 * "aura mesh") and the server — never the client — decides who shares a
 * LiveKit room. Safety rules, all fail-closed:
 * - blocked pairs never share a room, even through a third person;
 * - nobody is voice-eligible until their block list has synced;
 * - home is private: nobody there is seen, heard or broadcast; the rest of
 *   the map is the public world (circle-gated spaces arrive as scenes);
 * - removed participants are evicted, and rooms are reconciled against the
 *   expected roster because LiveKit tokens can't be revoked.
 */
export class TownRoom {
  private members = new Map<WebSocket, TownMember>();
  private nextId = 1;
  private proximityTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private voiceBackoffUntil = 0;
  /** Rooms whose roster must be re-sent on the next tick. */
  private pendingDirty = new Set<string>();
  /** When each not-yet-linked close pair first came within range. */
  private closeSince = new Map<string, number>();
  private rooms = new Map<string, VoiceRoomState>();

  constructor(
    private blockService: BlockService,
    private voice: TownVoice | null = null,
  ) {
    if (voice) {
      this.reconcileTimer = setInterval(() => {
        for (const roomId of this.rooms.keys()) this.reconcileRoom(roomId);
      }, RECONCILE_MS);
      this.reconcileTimer.unref();
    }
  }

  join(ws: WebSocket, did: string, x: number, y: number, dir: number): void {
    // A re-join on the same socket keeps its voice assignment, and gets it
    // re-sent (the client may have rebuilt its voice connection).
    const prev = this.members.get(ws);
    this.members.set(ws, {
      id: prev?.id ?? this.nextId++,
      ws,
      did,
      x,
      y,
      dir,
      moveBudget: MOVE_BURST,
      moveBudgetTs: Date.now(),
      roomId: prev?.roomId ?? null,
      pid: prev?.pid ?? '',
      hidden: isHome(x, y),
      ver: (prev?.ver ?? 0) + 1,
      known: new Map(),
    });
    if (prev?.roomId) this.pendingDirty.add(prev.roomId);

    // Your initial view, sent directly; everyone else learns about you on the
    // next view tick.
    const self = this.members.get(ws);
    const peers: TownPeer[] = [];
    if (self) {
      for (const [peerDid, m] of this.viewOf(self, this.buildViewGrid())) {
        self.known.set(peerDid, viewKey(m));
        peers.push({ did: m.did, x: m.x, y: m.y, dir: m.dir });
      }
    }
    this.sendTo(ws, {
      type: 'town_state',
      data: { peers, voice: this.voice !== null, voiceUrl: this.voice?.url },
    });
    this.scheduleView();
    this.scheduleProximity();
  }

  move(ws: WebSocket, x: number, y: number, dir: number): void {
    const m = this.members.get(ws);
    if (!m || !this.consumeMoveToken(m)) return;
    m.x = x;
    m.y = y;
    m.dir = dir;
    m.ver++;
    // Stepping inside drops you out of every view (looks like leaving town);
    // stepping out puts you back (looks like arriving).
    m.hidden = isHome(x, y);
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
      // You always see your own bubble; others only if you're in their view
      // (never while you're home — you're in nobody's view then).
      const sees = v.ws === ws || (!m.hidden && v.known.has(m.did));
      if (sees && v.ws.readyState === v.ws.OPEN) v.ws.send(payload);
    }
  }

  leave(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m) return;
    this.members.delete(ws);
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

  /** Visible members bucketed by grid cell, one representative socket per DID. */
  private buildViewGrid(): Map<string, TownMember[]> {
    const rep = new Map<string, TownMember>();
    for (const m of this.members.values()) {
      if (m.hidden) continue;
      // Several tabs of one DID: the most recently moved one is the avatar.
      const cur = rep.get(m.did);
      if (!cur || m.ver > cur.ver) rep.set(m.did, m);
    }
    const grid = new Map<string, TownMember[]>();
    for (const m of rep.values()) {
      const k = cellKey(Math.floor(m.x / VIEW_CELL), Math.floor(m.y / VIEW_CELL));
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
        for (const m of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (m.did === v.did || this.blockService.isBlocked(v.did, m.did)) continue;
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
        upsert.push({ did: m.did, x: m.x, y: m.y, dir: m.dir });
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

  /** Re-evaluate clusters now that block lists changed (blocked pairs split). */
  refreshProximity(): void {
    this.scheduleProximity();
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

    const byId = new Map<number, TownMember>();
    const nodes: ProxNode[] = [];
    for (const m of this.members.values()) {
      byId.set(m.id, m);
      nodes.push({ id: m.id, did: m.did, x: m.x, y: m.y, roomId: m.roomId });
    }

    const prevClose = this.closeSince;
    const nextClose = new Map<string, number>();
    const dwell = { pending: false };
    const rules: ClusterRules = {
      eligible: (n) => this.blockService.hasSynced(n.did) && zoneOf(n) !== 'home',
      compatible: (a, b) => a.did !== b.did && !this.blockService.isBlocked(a.did, b.did),
      newLinkReady: (a, b) => {
        const key = pairKey(a, b);
        const since = prevClose.get(key) ?? now;
        nextClose.set(key, since);
        if (now - since >= LINK_DWELL_MS) return true;
        dwell.pending = true;
        return false;
      },
    };
    const clusters = buildClusters(nodes, rules);
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
        // Clusters already exclude blocked pairs; this is defense in depth.
        const members: TownVoiceMember[] = live
          .filter((r) => r === m || !this.blockService.isBlocked(m.did, r.did))
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

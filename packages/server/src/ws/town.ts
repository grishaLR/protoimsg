import type { WebSocket } from 'ws';
import type { ServerMessage, TownPeer } from '@protoimsg/shared';
import type { BlockService } from '../moderation/block-service.js';

interface TownMember extends TownPeer {
  ws: WebSocket;
  moveBudget: number;
  moveBudgetTs: number;
}

// Server-side cap on town_move so the rate-limit exemption can't be weaponised:
// a token bucket per socket, generous enough never to throttle honest clients
// (which send ~9/s) but bounding a flood to a fixed O(N) fan-out rate.
const MOVE_RATE = 30; // tokens refilled per second
const MOVE_BURST = 30; // bucket capacity

/**
 * In-memory membership for the shared spatial world ("proto town").
 * Ephemeral by design — positions are never persisted (privacy model:
 * presence is server-only and transient). A single shared instance backs
 * the one public town.
 */
export class TownRoom {
  private members = new Map<WebSocket, TownMember>();

  constructor(private blockService: BlockService) {}

  join(ws: WebSocket, did: string, x: number, y: number, dir: number): void {
    this.members.set(ws, { ws, did, x, y, dir, moveBudget: MOVE_BURST, moveBudgetTs: Date.now() });

    const peers: TownPeer[] = [];
    for (const m of this.members.values()) {
      if (m.ws === ws || m.did === did) continue;
      if (this.blockService.isBlocked(did, m.did)) continue;
      peers.push({ did: m.did, x: m.x, y: m.y, dir: m.dir });
    }
    this.sendTo(ws, { type: 'town_state', data: { peers } });
    this.broadcast(did, { type: 'town_peer_join', data: { did, x, y, dir } }, ws);
  }

  move(ws: WebSocket, x: number, y: number, dir: number): void {
    const m = this.members.get(ws);
    if (!m || !this.consumeMoveToken(m)) return;
    m.x = x;
    m.y = y;
    m.dir = dir;
    this.broadcast(m.did, { type: 'town_peer_move', data: { did: m.did, x, y, dir } }, ws);
  }

  chat(ws: WebSocket, text: string): void {
    const m = this.members.get(ws);
    if (!m) return;
    // Echoed to everyone, including the sender, so all clients render the
    // bubble identically. `text` is relayed verbatim — clients MUST render it
    // as plain text (the Pixi bubble uses Text, never markup).
    this.broadcast(m.did, { type: 'town_chat', data: { did: m.did, text } });
  }

  leave(ws: WebSocket): void {
    const m = this.members.get(ws);
    if (!m) return;
    this.members.delete(ws);
    // Only announce the leave if the DID has no other socket still present
    // (a second tab keeps the avatar alive for everyone else).
    for (const other of this.members.values()) {
      if (other.did === m.did) return;
    }
    this.broadcast(m.did, { type: 'town_peer_leave', data: { did: m.did } }, ws);
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

  /**
   * Broadcast a message *about* `subjectDid`. Recipients with a block
   * relationship to the subject are skipped — a blocked user is invisible
   * (avatar, movement, chat) to the user who blocked them, and vice versa.
   */
  private broadcast(subjectDid: string, msg: ServerMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const m of this.members.values()) {
      if (m.ws === exclude || m.ws.readyState !== m.ws.OPEN) continue;
      if (this.blockService.isBlocked(m.did, subjectDid)) continue;
      m.ws.send(payload);
    }
  }
}

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { RoomSubscriptions } from './rooms.js';
import { DmSubscriptions } from '../dms/subscriptions.js';
import { BuddyWatchers } from './buddy-watchers.js';
import { handleClientMessage } from './handlers.js';
import { attachHeartbeat } from './heartbeat.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { ServerMessage } from './types.js';
import { parseClientMessage } from './validation.js';
import type { Sql } from '../db/client.js';
import type { SessionStore } from '../auth/session.js';
import type { RateLimiter } from '../moderation/rate-limiter.js';
import { BlockService } from '../moderation/block-service.js';

const AUTH_TIMEOUT_MS = 5000;

/** Maps a DID to all of its connected WebSocket sessions */
export class UserSockets {
  private sockets = new Map<string, Set<WebSocket>>();

  add(did: string, ws: WebSocket): void {
    let set = this.sockets.get(did);
    if (!set) {
      set = new Set();
      this.sockets.set(did, set);
    }
    set.add(ws);
  }

  remove(did: string, ws: WebSocket): void {
    const set = this.sockets.get(did);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.sockets.delete(did);
      }
    }
  }

  get(did: string): Set<WebSocket> {
    return this.sockets.get(did) ?? new Set();
  }
}

export interface WsServer {
  broadcastToRoom: (roomId: string, message: ServerMessage) => void;
  close: () => void;
}

export function createWsServer(
  httpServer: Server,
  sql: Sql,
  service: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiter,
  dmService: DmService,
  blockService: BlockService,
): WsServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 100_000, // 100KB — prevent OOM from single malicious message
  });
  const roomSubs = new RoomSubscriptions();
  const dmSubs = new DmSubscriptions();
  const userSockets = new UserSockets();
  blockService.startSweep();
  const buddyWatchers = new BuddyWatchers(sql, blockService);

  wss.on('connection', (ws: WebSocket) => {
    let did: string | null = null;
    let authenticated = false;
    let cleanupHeartbeat: (() => void) | null = null;

    // Auth timeout — close if no auth message within 5 seconds
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Auth timeout' }));
        ws.close(4001, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf-8'));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      // First message must be auth (handled separately — not in validated union)
      if (!authenticated) {
        const msg = json as Record<string, unknown>;
        if (msg.type !== 'auth' || typeof msg.token !== 'string') {
          ws.send(JSON.stringify({ type: 'error', message: 'First message must be auth' }));
          ws.close(4001, 'Auth required');
          return;
        }

        const session = sessions.get(msg.token);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
          ws.close(4001, 'Invalid token');
          return;
        }

        clearTimeout(authTimer);
        authenticated = true;
        did = session.did;
        service.handleUserConnect(did);
        userSockets.add(did, ws);
        blockService.touch(did);
        buddyWatchers.notify(did, 'online');
        cleanupHeartbeat = attachHeartbeat(ws);
        console.log(`WS authenticated: ${did}`);
        return;
      }

      if (!did) return;

      // Validate all post-auth messages with Zod
      const data = parseClientMessage(json);
      if (!data) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      void handleClientMessage(
        ws,
        did,
        data,
        roomSubs,
        buddyWatchers,
        service,
        sql,
        rateLimiter,
        dmSubs,
        userSockets,
        dmService,
        blockService,
      );
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      cleanupHeartbeat?.();
      if (did) {
        // Remove this socket first so we can check remaining connections
        userSockets.remove(did, ws);
        roomSubs.unsubscribeAll(ws);
        buddyWatchers.unwatchAll(ws);

        const abandonedConvos = dmSubs.unsubscribeAll(ws);
        for (const conversationId of abandonedConvos) {
          void dmService.cleanupIfEmpty(conversationId);
        }

        // Only tear down presence if this was the user's last connection
        const remaining = userSockets.get(did);
        if (remaining.size === 0) {
          const rooms = service.getUserRooms(did);
          for (const roomId of rooms) {
            service.handleLeaveRoom(did, roomId);
            roomSubs.broadcast(roomId, {
              type: 'presence',
              data: { did, status: 'offline' },
            });
          }
          buddyWatchers.notify(did, 'offline');
          service.handleUserDisconnect(did);
        }

        // Keep block list across reconnections — it will be overwritten by
        // the next sync_blocks message, avoiding a flash of real presence.
        console.log(`WS disconnected: ${did} (${String(remaining.size)} sessions remain)`);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  return {
    broadcastToRoom: (roomId: string, message: ServerMessage) => {
      roomSubs.broadcast(roomId, message);
    },
    close: () => {
      blockService.stopSweep();
      wss.close();
    },
  };
}

import { randomUUID } from 'crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { RoomSubscriptions } from './rooms.js';
import { DmSubscriptions } from '../dms/subscriptions.js';
import { CommunityWatchers } from './buddy-watchers.js';
import { handleClientMessage } from './handlers.js';
import { attachHeartbeat } from './heartbeat.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { ServerMessage } from './types.js';
import { parseClientMessage } from './validation.js';
import type { Sql } from '../db/client.js';
import type { SessionStore } from '../auth/session-store.js';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';
import { BlockService } from '../moderation/block-service.js';
import { createLogger } from '../logger.js';
import { Sentry } from '../sentry.js';

const log = createLogger('ws');
const AUTH_TIMEOUT_MS = 5000;
const MAX_WS_CONNECTIONS_PER_IP = 20;

/** Tracks WebSocket connections per IP for rate limiting. */
class WsConnectionTracker {
  private counts = new Map<string, number>();

  tryIncrement(ip: string): boolean {
    const count = this.counts.get(ip) ?? 0;
    if (count >= MAX_WS_CONNECTIONS_PER_IP) return false;
    this.counts.set(ip, count + 1);
    return true;
  }

  decrement(ip: string): void {
    const count = this.counts.get(ip) ?? 0;
    if (count <= 1) {
      this.counts.delete(ip);
    } else {
      this.counts.set(ip, count - 1);
    }
  }
}

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
  close: () => Promise<void>;
}

export function createWsServer(
  httpServer: Server,
  sql: Sql,
  service: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiterStore,
  dmService: DmService,
  blockService: BlockService,
): WsServer {
  const connectionTracker = new WsConnectionTracker();

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 100_000, // 100KB — prevent OOM from single malicious message
    verifyClient: (info, callback) => {
      const ip = info.req.socket.remoteAddress ?? 'unknown';
      if (!connectionTracker.tryIncrement(ip)) {
        callback(false, 429, 'Too many WebSocket connections');
        return;
      }
      (info.req as IncomingMessage & { _wsRemoteIp?: string })._wsRemoteIp = ip;
      callback(true);
    },
  });
  const roomSubs = new RoomSubscriptions();
  const dmSubs = new DmSubscriptions();
  const userSockets = new UserSockets();
  blockService.startSweep();
  const communityWatchers = new CommunityWatchers(sql, blockService);
  const pendingCleanup = new Set<Promise<void>>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const remoteIp = (req as IncomingMessage & { _wsRemoteIp?: string })._wsRemoteIp ?? 'unknown';
    (ws as WebSocket & { socketId?: string; remoteIp?: string }).socketId = randomUUID();
    (ws as WebSocket & { socketId?: string; remoteIp?: string }).remoteIp = remoteIp;

    let did: string | null = null;
    let authenticated = false;
    let cleanupHeartbeat: (() => void) | null = null;
    let msgQueue: Promise<void> = Promise.resolve();

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

        sessions
          .get(msg.token)
          .then(async (session) => {
            if (!session) {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
              ws.close(4001, 'Invalid token');
              return;
            }

            clearTimeout(authTimer);
            authenticated = true;
            did = session.did;
            await service.handleUserConnect(did);
            userSockets.add(did, ws);
            blockService.touch(did);
            // Don't notify community watchers here — visibility hasn't been
            // restored yet (client sends status_change with saved visibility
            // immediately after auth). Notifying here with default 'everyone'
            // would leak presence to users outside the visibility scope.
            cleanupHeartbeat = attachHeartbeat(ws);
            ws.send(JSON.stringify({ type: 'auth_success' }));
            log.info({ did }, 'WS authenticated');
          })
          .catch((err: unknown) => {
            Sentry.captureException(err);
            ws.close(4001, 'Auth error');
          });
        return;
      }

      if (!did) return;
      const authedDid = did;

      // Validate all post-auth messages with Zod
      const data = parseClientMessage(json);
      if (!data) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      // Queue messages so each handler's async DB work completes before
      // the next starts (e.g. sync_community writes must finish before
      // status_change reads community_members for visibility checks).
      msgQueue = msgQueue
        .then(() =>
          handleClientMessage(
            ws,
            authedDid,
            data,
            roomSubs,
            communityWatchers,
            service,
            sql,
            rateLimiter,
            dmSubs,
            userSockets,
            dmService,
            blockService,
          ),
        )
        .catch((err: unknown) => {
          Sentry.captureException(err);
          log.error({ err }, 'Message handler error');
        });
    });

    ws.on('close', () => {
      const ip = (ws as WebSocket & { remoteIp?: string }).remoteIp;
      if (ip) connectionTracker.decrement(ip);
      clearTimeout(authTimer);
      cleanupHeartbeat?.();
      if (did) {
        // Remove this socket first so we can check remaining connections
        userSockets.remove(did, ws);
        roomSubs.unsubscribeAll(ws);
        communityWatchers.unwatchAll(ws);

        const abandonedConvos = dmSubs.unsubscribeAll(ws);
        for (const conversationId of abandonedConvos) {
          void dmService.cleanupIfEmpty(conversationId);
        }

        // Only tear down presence if this was the user's last connection
        const remaining = userSockets.get(did);
        if (remaining.size === 0) {
          const closeDid = did;
          const cleanup = (async () => {
            const rooms = await service.getUserRooms(closeDid);
            for (const roomId of rooms) {
              await service.handleLeaveRoom(closeDid, roomId);
              roomSubs.broadcast(roomId, {
                type: 'presence',
                data: { did: closeDid, status: 'offline' },
              });
            }
            await communityWatchers.notify(closeDid, 'offline', undefined, 'everyone');
            await service.handleUserDisconnect(closeDid);
          })();
          pendingCleanup.add(cleanup);
          void cleanup.finally(() => {
            pendingCleanup.delete(cleanup);
          });
        }

        // Keep block list across reconnections — it will be overwritten by
        // the next sync_blocks message, avoiding a flash of real presence.
        log.info({ did, remaining: remaining.size }, 'WS disconnected');
      }
    });

    ws.on('error', (err) => {
      Sentry.captureException(err);
      log.error({ err }, 'WebSocket error');
    });
  });

  return {
    broadcastToRoom: (roomId: string, message: ServerMessage) => {
      roomSubs.broadcast(roomId, message);
    },
    close: async () => {
      blockService.stopSweep();
      // Close all client sockets first so their 'close' handlers fire
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      // Wait for all async close handlers to complete (presence cleanup, notifications)
      await Promise.all(pendingCleanup);
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

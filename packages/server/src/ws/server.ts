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
import type { ImRegistry } from '../dms/registry.js';
import type { ServerMessage } from './types.js';
import { parseClientMessage } from './validation.js';
import type { Sql } from '../db/client.js';
import type { SessionStore } from '../auth/session-store.js';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';
import { BlockService } from '../moderation/block-service.js';
import type { GlobalBanService } from '../moderation/global-ban-service.js';
import type { GlobalAllowlistService } from '../moderation/global-allowlist-service.js';
import type { LabelerService } from '../moderation/labeler-service.js';
import type { BotService } from '../bot/service.js';
import type { NotificationService } from '../notifications/service.js';
import type { GroupCallService } from '../calls/service.js';
import { ERROR_CODES } from '@protoimsg/shared';

import { createLogger } from '../logger.js';
import { Sentry } from '../sentry.js';
import {
  incWsConnections,
  decWsConnections,
  incWsAuthFailure,
  incWsMessage,
  observeWsHandlerDuration,
  getWsConnectionCount,
} from '../metrics.js';
import { updatePeakWsConns } from '../stats/queries.js';

const log = createLogger('ws');
const AUTH_TIMEOUT_MS = 5000;
const MAX_WS_CONNECTIONS_PER_IP = 50;
const MAX_WS_CONNECTIONS_PER_DID = 5;

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

  count(did: string): number {
    return this.sockets.get(did)?.size ?? 0;
  }

  oldest(did: string): WebSocket | undefined {
    const set = this.sockets.get(did);
    if (!set || set.size === 0) return undefined;
    return set.values().next().value;
  }
}

export interface WsServer {
  broadcastToRoom: (roomId: string, message: ServerMessage) => void;
  sendToUser: (did: string, message: ServerMessage) => void;
  isSubscribedToRoom: (did: string, roomId: string) => boolean;
  close: () => Promise<void>;
}

export function createWsServer(
  httpServer: Server,
  sql: Sql,
  service: PresenceService,
  sessions: SessionStore,
  rateLimiter: RateLimiterStore,
  dmService: DmService,
  imRegistry: ImRegistry,
  blockService: BlockService,
  globalBans: GlobalBanService,
  globalAllowlist: GlobalAllowlistService,
  labelerService: LabelerService,
  botService: BotService | null,
  notificationService?: NotificationService | null,
  groupCallService?: GroupCallService | null,
): WsServer {
  const connectionTracker = new WsConnectionTracker();

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 100_000, // 100KB — prevent OOM from single malicious message
    verifyClient: (info, callback) => {
      const flyIp = info.req.headers['fly-client-ip'];
      const ip =
        (typeof flyIp === 'string' ? flyIp : undefined) ??
        info.req.socket.remoteAddress ??
        'unknown';
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
  const callSubs = new DmSubscriptions();
  const userSockets = new UserSockets();
  blockService.startSweep();
  const communityWatchers = new CommunityWatchers(sql, blockService);
  const pendingCleanup = new Set<Promise<void>>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const remoteIp = (req as IncomingMessage & { _wsRemoteIp?: string })._wsRemoteIp ?? 'unknown';
    (ws as WebSocket & { socketId?: string; remoteIp?: string }).socketId = randomUUID();
    (ws as WebSocket & { socketId?: string; remoteIp?: string }).remoteIp = remoteIp;

    let did: string | null = null;
    let handle: string = '';
    let authenticated = false;
    let cleanupHeartbeat: (() => void) | null = null;
    let msgQueue: Promise<void> = Promise.resolve();

    // Auth timeout — close if no auth message within 5 seconds
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Auth timeout',
            errorCode: ERROR_CODES.AUTH_TIMEOUT,
          }),
        );
        ws.close(4001, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf-8'));
      } catch {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid JSON',
            errorCode: ERROR_CODES.INVALID_JSON,
          }),
        );
        return;
      }

      // First message must be auth (handled separately — not in validated union)
      if (!authenticated) {
        const msg = json as Record<string, unknown>;
        if (msg.type !== 'auth' || typeof msg.token !== 'string') {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'First message must be auth',
              errorCode: ERROR_CODES.AUTH_REQUIRED,
            }),
          );
          ws.close(4001, 'Auth required');
          return;
        }

        sessions
          .get(msg.token)
          .then(async (session) => {
            if (!session) {
              incWsAuthFailure();
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Invalid or expired token',
                  errorCode: ERROR_CODES.INVALID_SESSION,
                }),
              );
              ws.close(4001, 'Invalid token');
              return;
            }

            if (globalBans.isBanned(session.did)) {
              log.warn({ did: session.did }, 'WS rejected: globally banned');
              void sessions.revokeByDid(session.did);
              ws.close(4003, 'Account banned');
              return;
            }

            if (!globalAllowlist.isAllowed(session.did)) {
              log.warn({ did: session.did }, 'WS rejected: not on allowlist');
              void sessions.revokeByDid(session.did);
              ws.close(4003, 'Account banned');
              return;
            }

            clearTimeout(authTimer);
            authenticated = true;
            did = session.did;
            handle = session.handle;
            await service.handleUserConnect(did);
            userSockets.add(did, ws);

            // Phase 2: per-DID connection limit — evict oldest socket.
            // Remove from userSockets before closing so the count decreases
            // synchronously (close handler fires async on next tick).
            while (userSockets.count(did) > MAX_WS_CONNECTIONS_PER_DID) {
              const oldest = userSockets.oldest(did);
              if (!oldest || oldest === ws) break;
              log.info({ did, reason: 'per-DID limit' }, 'Evicting oldest socket');
              userSockets.remove(did, oldest);
              oldest.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Connection replaced by newer session',
                  errorCode: ERROR_CODES.CONNECTION_LIMIT_DID,
                }),
              );
              oldest.close(4008, 'Connection limit per user');
            }

            blockService.touch(did);
            // Don't notify community watchers here — visibility hasn't been
            // restored yet (client sends status_change with saved visibility
            // immediately after auth). Notifying here with default 'everyone'
            // would leak presence to users outside the visibility scope.
            cleanupHeartbeat = attachHeartbeat(ws);
            incWsConnections();
            const connCount = getWsConnectionCount();
            void updatePeakWsConns(sql, connCount);
            ws.send(JSON.stringify({ type: 'auth_success' }));
            log.info({ did }, 'WS authenticated');
          })
          .catch((err: unknown) => {
            Sentry.withScope((scope) => {
              if (did) scope.setUser({ id: did });
              Sentry.captureException(err);
            });
            ws.close(4001, 'Auth error');
          });
        return;
      }

      if (!did) return;
      const authedDid = did;

      // Validate all post-auth messages with Zod
      const data = parseClientMessage(json);
      if (!data) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            errorCode: ERROR_CODES.INVALID_MESSAGE_FORMAT,
          }),
        );
        return;
      }

      incWsMessage(data.type);

      // Queue messages so each handler's async DB work completes before
      // the next starts (e.g. sync_community writes must finish before
      // status_change reads community_members for visibility checks).
      const authedHandle = handle;
      msgQueue = msgQueue
        .then(async () => {
          const start = performance.now();
          await handleClientMessage(
            ws,
            authedDid,
            authedHandle,
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
            imRegistry,
            labelerService,
            callSubs,
            botService,
            notificationService,
            groupCallService,
          );
          observeWsHandlerDuration(data.type, (performance.now() - start) / 1000);
        })
        .catch((err: unknown) => {
          Sentry.withScope((scope) => {
            scope.setUser({ id: authedDid });
            Sentry.captureException(err);
          });
          log.error({ err }, 'Message handler error');
        });
    });

    ws.on('close', () => {
      const ip = (ws as WebSocket & { remoteIp?: string }).remoteIp;
      if (ip) connectionTracker.decrement(ip);
      clearTimeout(authTimer);
      cleanupHeartbeat?.();
      if (did) {
        decWsConnections();
        // Remove this socket first so we can check remaining connections
        userSockets.remove(did, ws);
        roomSubs.unsubscribeAll(ws);
        communityWatchers.unwatchAll(ws);
        botService?.handleClose(ws);

        const abandonedConvos = dmSubs.unsubscribeAll(ws);
        for (const conversationId of abandonedConvos) {
          if (imRegistry.has(conversationId)) {
            imRegistry.unregister(conversationId);
          } else {
            void dmService.cleanupIfEmpty(conversationId);
          }
        }
        callSubs.unsubscribeAll(ws);

        // Remove from group calls when this is the user's last connection
        const remaining = userSockets.get(did);
        if (remaining.size === 0 && groupCallService) {
          const leftCalls = groupCallService.removeFromAllCalls(did);
          for (const { call, callId, roomId } of leftCalls) {
            if (!roomId) continue; // Standalone meeting — no room to broadcast to
            if (call === null) {
              roomSubs.broadcast(roomId, {
                type: 'group_call_ended',
                data: { callId, roomId },
              });
            } else {
              roomSubs.broadcast(roomId, {
                type: 'group_call_participant_left',
                data: { callId, roomId, participantCount: call.participants.size },
              });
            }
          }
        }

        // Only tear down presence if this was the user's last connection
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
      Sentry.withScope((scope) => {
        if (did) scope.setUser({ id: did });
        Sentry.captureException(err);
      });
      log.error({ err }, 'WebSocket error');
    });
  });

  return {
    broadcastToRoom: (roomId: string, message: ServerMessage) => {
      roomSubs.broadcast(roomId, message);
    },
    sendToUser: (did: string, message: ServerMessage) => {
      const sockets = userSockets.get(did);
      const payload = JSON.stringify(message);
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    },
    isSubscribedToRoom: (did: string, roomId: string) => {
      const sockets = userSockets.get(did);
      const subscribers = roomSubs.getSubscribers(roomId);
      for (const ws of sockets) {
        if (subscribers.has(ws)) return true;
      }
      return false;
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

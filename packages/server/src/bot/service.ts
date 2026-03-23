import type { WebSocket } from 'ws';
import { BOT } from '@protoimsg/shared';
import type { EmailService } from '../email/service.js';
import type { Sql } from '../db/client.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { createLogger } from '../logger.js';
import { getGreeting, handleCommand, handleRoomCommand, type CommandContext } from './commands.js';

const log = createLogger('bot');

/** Inactivity TTL for bot DM sessions — 30 minutes. */
const SESSION_TTL_MS = 30 * 60 * 1000;

interface BotSession {
  did: string;
  handle: string;
  lastActivity: number;
}

export interface BotService {
  handleOpen(ws: WebSocket, did: string, handle: string): void;
  handleMessage(ws: WebSocket, did: string, handle: string, text: string): Promise<void>;
  handleClose(ws: WebSocket): void;
  handleRoomCommand(
    ws: WebSocket,
    did: string,
    handle: string,
    text: string,
    roomId: string,
    channelId: string,
  ): Promise<void>;
  cleanup(): void;
}

export function createBotService(emailService: EmailService | null, sql: Sql): BotService {
  const sessions = new Map<WebSocket, BotSession>();
  const commandRateLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  const reportRateLimiter = new InMemoryRateLimiter({ windowMs: 3_600_000, maxRequests: 3 });
  const feedbackRateLimiter = new InMemoryRateLimiter({ windowMs: 3_600_000, maxRequests: 5 });

  function sendBotResponse(ws: WebSocket, text: string, i18nKey?: string): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'bot_dm_response',
        data: {
          text,
          ...(i18nKey ? { i18nKey } : {}),
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }

  function sendSystemMessage(ws: WebSocket, text: string, roomId: string, channelId: string): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'system_message',
        data: {
          text: `${BOT.displayName}: ${text}`,
          roomId,
          channelId,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }

  function makeContext(did: string, handle: string): CommandContext {
    return {
      did,
      handle,
      emailService,
      sql,
      commandRateLimiter,
      reportRateLimiter,
      feedbackRateLimiter,
    };
  }

  return {
    handleOpen(ws, did, handle) {
      sessions.set(ws, { did, handle, lastActivity: Date.now() });
      const greeting = getGreeting();
      sendBotResponse(ws, greeting.text, greeting.i18nKey);
      log.info({ did }, 'Bot DM opened');
    },

    async handleMessage(ws, did, handle, text) {
      const session = sessions.get(ws);
      if (session) {
        session.lastActivity = Date.now();
      }

      const ctx = makeContext(did, handle);
      const result = await handleCommand(text, ctx);
      sendBotResponse(ws, result.text, result.i18nKey);
    },

    handleClose(ws) {
      const session = sessions.get(ws);
      if (session) {
        log.info({ did: session.did }, 'Bot DM closed');
        sessions.delete(ws);
      }
    },

    async handleRoomCommand(ws, did, handle, text, roomId, channelId) {
      const ctx = makeContext(did, handle);
      const result = await handleRoomCommand(text, ctx, roomId);
      if (result) {
        sendSystemMessage(ws, result.text, roomId, channelId);
      }
    },

    cleanup() {
      const cutoff = Date.now() - SESSION_TTL_MS;
      for (const [ws, session] of sessions) {
        if (session.lastActivity < cutoff) {
          sessions.delete(ws);
          log.debug({ did: session.did }, 'Bot session pruned (inactivity)');
        }
      }
      void commandRateLimiter.prune();
      void reportRateLimiter.prune();
      void feedbackRateLimiter.prune();
    },
  };
}

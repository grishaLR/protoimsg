import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import { createWsServer } from './server.js';
import { InMemorySessionStore } from '../auth/session.js';
import type { SessionStore } from '../auth/session-store.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { BlockService } from '../moderation/block-service.js';
import { createPresenceService } from '../presence/service.js';
import { InMemoryPresenceTracker } from '../presence/tracker.js';
import type { DmService } from '../dms/service.js';

// Minimal mock for Sql — ws server only passes it through
const mockSql = {} as never;

// Minimal mock DmService — ws server only passes it through
const mockDmService = {
  openConversation: () => Promise.resolve({ conversation: {}, messages: [] }),
  sendMessage: () => Promise.resolve({ message: {}, recipientDid: '' }),
  togglePersist: () => Promise.resolve(),
  cleanupIfEmpty: () => Promise.resolve(true),
  pruneExpired: () => Promise.resolve(),
  isParticipant: () => Promise.resolve(false),
  getRecipientDid: () => Promise.resolve(null),
} as unknown as DmService;

function setup() {
  const httpServer = createServer();
  const sessions = new InMemorySessionStore();
  const rateLimiter = new InMemoryRateLimiter();
  const tracker = new InMemoryPresenceTracker();
  const service = createPresenceService(tracker);
  const blockService = new BlockService();
  const wss = createWsServer(
    httpServer,
    mockSql,
    service,
    sessions,
    rateLimiter,
    mockDmService,
    blockService,
  );

  return new Promise<{
    httpServer: ReturnType<typeof createServer>;
    sessions: SessionStore;
    wss: ReturnType<typeof createWsServer>;
    url: string;
    cleanup: () => Promise<void>;
  }>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        httpServer,
        sessions,
        wss,
        url: `ws://127.0.0.1:${String(port)}/ws`,
        cleanup: async () => {
          await wss.close();
          await new Promise<void>((done) => {
            httpServer.close(() => {
              done();
            });
          });
        },
      });
    });
  });
}

describe('WS token auth', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it('authenticates with valid token', async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;
    const token = await ctx.sessions.create('did:plc:test', 'test.bsky.social');

    const ws = new WebSocket(ctx.url);
    const messages: string[] = [];

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.on('message', (data: Buffer) => {
        messages.push(data.toString('utf-8'));
      });
      // After auth, send a ping to verify the connection is working
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'ping' }));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 100);
      }, 100);
    });

    const parsed = messages.map((m) => JSON.parse(m) as { type: string });
    expect(parsed.some((m) => m.type === 'pong')).toBe(true);
  });

  it('closes with 4001 for invalid token', async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const ws = new WebSocket(ctx.url);

    const code = await new Promise<number>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'bad-token' }));
      });
      ws.on('close', (c: number) => {
        resolve(c);
      });
    });

    expect(code).toBe(4001);
  });

  it('closes with 4001 for non-auth first message', async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    const ws = new WebSocket(ctx.url);

    const code = await new Promise<number>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join_room', roomId: 'test' }));
      });
      ws.on('close', (c: number) => {
        resolve(c);
      });
    });

    expect(code).toBe(4001);
  });
});

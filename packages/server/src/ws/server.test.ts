import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import { createWsServer, UserSockets } from './server.js';
import { InMemorySessionStore } from '../auth/session.js';
import type { SessionStore } from '../auth/session-store.js';
import { InMemoryRateLimiter } from '../moderation/rate-limiter.js';
import { BlockService } from '../moderation/block-service.js';
import { GlobalBanService } from '../moderation/global-ban-service.js';
import { GlobalAllowlistService } from '../moderation/global-allowlist-service.js';
import { LabelerService } from '../moderation/labeler-service.js';
import { createPresenceService } from '../presence/service.js';
import { InMemoryPresenceTracker } from '../presence/tracker.js';
import type { DmService } from '../dms/service.js';
import { createImRegistry } from '../dms/registry.js';
// Minimal mock for Sql — must be callable as a tagged template (stats queries use sql`...`)
const mockSql = (() => Promise.resolve([])) as never;

// Minimal mock DmService — ws server only passes it through (video calls still use it)
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
  const globalBans = new GlobalBanService();
  const globalAllowlist = new GlobalAllowlistService(false);
  const imRegistry = createImRegistry();
  const labelerService = new LabelerService();
  const wss = createWsServer(
    httpServer,
    mockSql,
    service,
    sessions,
    rateLimiter,
    mockDmService,
    imRegistry,
    blockService,
    globalBans,
    globalAllowlist,
    labelerService,
    null, // botService disabled by default
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

  it('evicts oldest socket when per-DID limit exceeded', async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;
    const did = 'did:plc:eviction-test';

    // Open 6 connections with the same DID (limit is 5)
    const sockets: WebSocket[] = [];
    const closeCodes: (number | undefined)[] = Array.from({ length: 6 }, () => undefined);

    for (let i = 0; i < 6; i++) {
      const token = await ctx.sessions.create(did, 'test.bsky.social');
      const ws = new WebSocket(ctx.url);
      sockets.push(ws);
      const idx = i;
      ws.on('close', (code: number) => {
        closeCodes[idx] = code;
      });
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token }));
        });
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString('utf-8')) as { type: string };
          if (msg.type === 'auth_success') resolve();
        });
      });
    }

    // Give eviction close events time to fire
    await new Promise((r) => setTimeout(r, 200));

    // The first socket should have been evicted with 4008
    expect(closeCodes[0]).toBe(4008);

    // Sockets 2–6 should still be open (indices 1-5)
    for (const ws of sockets.slice(1)) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    // Clean up remaining sockets
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
  });
});

describe('UserSockets', () => {
  it('count() returns number of sockets for a DID', () => {
    const us = new UserSockets();
    expect(us.count('did:plc:a')).toBe(0);

    const ws1 = {} as WebSocket;
    const ws2 = {} as WebSocket;
    us.add('did:plc:a', ws1);
    expect(us.count('did:plc:a')).toBe(1);

    us.add('did:plc:a', ws2);
    expect(us.count('did:plc:a')).toBe(2);

    us.remove('did:plc:a', ws1);
    expect(us.count('did:plc:a')).toBe(1);
  });

  it('oldest() returns the first-added socket', () => {
    const us = new UserSockets();
    expect(us.oldest('did:plc:a')).toBeUndefined();

    const ws1 = { id: 1 } as unknown as WebSocket;
    const ws2 = { id: 2 } as unknown as WebSocket;
    const ws3 = { id: 3 } as unknown as WebSocket;
    us.add('did:plc:a', ws1);
    us.add('did:plc:a', ws2);
    us.add('did:plc:a', ws3);

    expect(us.oldest('did:plc:a')).toBe(ws1);

    us.remove('did:plc:a', ws1);
    expect(us.oldest('did:plc:a')).toBe(ws2);
  });
});

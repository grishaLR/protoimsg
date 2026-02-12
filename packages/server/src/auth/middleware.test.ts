import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { InMemorySessionStore } from './session.js';
import { createRequireAuth } from './middleware.js';

function mockReqRes(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as unknown as Request;
  const statusFn = vi.fn().mockReturnThis();
  const res = {
    status: statusFn,
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, statusFn };
}

/** Wait for the middleware's async .then() chain to settle */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('createRequireAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next and sets req.did for valid token', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social');
    const requireAuth = createRequireAuth(store);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);

    requireAuth(req, res, next);
    await tick();

    expect(next).toHaveBeenCalled();
    expect(req.did).toBe('did:plc:abc');
    expect(req.handle).toBe('alice.bsky.social');
  });

  it('returns 401 for missing authorization header', () => {
    const store = new InMemorySessionStore();
    const requireAuth = createRequireAuth(store);
    const { req, res, next, statusFn } = mockReqRes(undefined);

    requireAuth(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', async () => {
    const store = new InMemorySessionStore();
    const requireAuth = createRequireAuth(store);
    const { req, res, next, statusFn } = mockReqRes('Bearer bad-token');

    requireAuth(req, res, next);
    await tick();

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for expired session', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social', 100);
    const requireAuth = createRequireAuth(store);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);
    const { req, res, next, statusFn } = mockReqRes(`Bearer ${token}`);

    requireAuth(req, res, next);
    await tick();

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for non-Bearer scheme', () => {
    const store = new InMemorySessionStore();
    const requireAuth = createRequireAuth(store);
    const { req, res, next, statusFn } = mockReqRes('Basic abc123');

    requireAuth(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

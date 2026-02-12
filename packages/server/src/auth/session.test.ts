import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemorySessionStore } from './session.js';

describe('InMemorySessionStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws if TTL is <= 0', () => {
    expect(() => new InMemorySessionStore(0)).toThrow('Session TTL must be greater than 0');
    expect(() => new InMemorySessionStore(-1)).toThrow('Session TTL must be greater than 0');
  });

  it('create returns a UUID token', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social');
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('get returns the correct session', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social');
    const session = await store.get(token);
    expect(session).toBeDefined();
    expect(session?.did).toBe('did:plc:abc');
    expect(session?.handle).toBe('alice.bsky.social');
  });

  it('get returns undefined for unknown token', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('get returns undefined for expired session', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social', 100);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);
    expect(await store.get(token)).toBeUndefined();
  });

  it('delete removes the session', async () => {
    const store = new InMemorySessionStore();
    const token = await store.create('did:plc:abc', 'alice.bsky.social');
    await store.delete(token);
    expect(await store.get(token)).toBeUndefined();
  });

  it('prune clears expired but keeps valid sessions', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const store = new InMemorySessionStore();
    const valid = await store.create('did:plc:valid', 'valid.bsky.social', 10_000);
    await store.create('did:plc:expired', 'expired.bsky.social', 100);

    vi.spyOn(Date, 'now').mockReturnValue(now + 200);
    const pruned = await store.prune();

    expect(pruned).toBe(1);
    expect(await store.get(valid)).toBeDefined();
  });

  it('uses custom TTL from constructor', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const store = new InMemorySessionStore(500);
    const token = await store.create('did:plc:abc', 'alice.bsky.social');

    vi.spyOn(Date, 'now').mockReturnValue(now + 400);
    expect(await store.get(token)).toBeDefined();

    vi.spyOn(Date, 'now').mockReturnValue(now + 600);
    expect(await store.get(token)).toBeUndefined();
  });
});

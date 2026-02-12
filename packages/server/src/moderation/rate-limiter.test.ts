import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows requests under the limit', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 10_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      expect(await limiter.check('user1')).toBe(true);
    }
  });

  it('blocks requests over the limit', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 10_000, maxRequests: 3 });
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user1')).toBe(false);
  });

  it('resets after window expires', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const limiter = new InMemoryRateLimiter({ windowMs: 1000, maxRequests: 2 });
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user1')).toBe(false);

    vi.spyOn(Date, 'now').mockReturnValue(now + 1100);
    expect(await limiter.check('user1')).toBe(true);
  });

  it('tracks different keys independently', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    expect(await limiter.check('user1')).toBe(true);
    expect(await limiter.check('user2')).toBe(true);
    expect(await limiter.check('user1')).toBe(false);
    expect(await limiter.check('user2')).toBe(false);
  });

  it('prune cleans up expired entries', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const limiter = new InMemoryRateLimiter({ windowMs: 1000, maxRequests: 10 });
    await limiter.check('user1');

    vi.spyOn(Date, 'now').mockReturnValue(now + 1100);
    const pruned = await limiter.prune();
    expect(pruned).toBe(1);
  });
});

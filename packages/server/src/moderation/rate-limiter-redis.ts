import type { Redis } from '../redis/client.js';
import type { RateLimiterStore } from './rate-limiter-store.js';

const KEY_PREFIX = 'ratelimit:';
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

/**
 * Lua script for atomic sliding-window rate limiting.
 * 1. ZREMRANGEBYSCORE to evict old entries
 * 2. ZCARD to check count
 * 3. If under limit: ZADD + PEXPIRE
 *
 * Returns 1 if allowed, 0 if rate limited.
 */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)

if count >= max then
  return 0
end

redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
redis.call('PEXPIRE', key, window)
return 1
`;

export class RedisRateLimiter implements RateLimiterStore {
  private redis: Redis;
  private windowMs: number;
  private maxRequests: number;

  constructor(redis: Redis, opts?: { windowMs?: number; maxRequests?: number }) {
    this.redis = redis;
    this.windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  }

  async check(key: string): Promise<boolean> {
    const now = Date.now();
    const result = await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `${KEY_PREFIX}${key}`,
      String(now),
      String(this.windowMs),
      String(this.maxRequests),
    );
    return result === 1;
  }

  prune(): Promise<number> {
    // Redis TTL handles expiration automatically — no-op
    return Promise.resolve(0);
  }
}

import { randomUUID } from 'crypto';
import type { Redis } from '../redis/client.js';
import type { Session, SessionStore } from './session-store.js';

const KEY_PREFIX = 'session:';
const DID_PREFIX = 'session:did:';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export class RedisSessionStore implements SessionStore {
  private redis: Redis;
  private ttlMs: number;

  constructor(redis: Redis, ttlMs = DEFAULT_TTL_MS) {
    if (ttlMs <= 0) {
      throw new Error('Session TTL must be greater than 0');
    }
    this.redis = redis;
    this.ttlMs = ttlMs;
  }

  async create(did: string, handle: string, ttlMs?: number): Promise<string> {
    const token = randomUUID();
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.ttlMs;
    const expiresAt = now + effectiveTtl;
    const ttlSeconds = Math.ceil(effectiveTtl / 1000);

    const pipeline = this.redis.pipeline();
    pipeline.hset(`${KEY_PREFIX}${token}`, {
      did,
      handle,
      createdAt: String(now),
      expiresAt: String(expiresAt),
    });
    pipeline.expire(`${KEY_PREFIX}${token}`, ttlSeconds);
    pipeline.sadd(`${DID_PREFIX}${did}`, token);
    pipeline.expire(`${DID_PREFIX}${did}`, ttlSeconds);
    await pipeline.exec();

    return token;
  }

  async get(token: string): Promise<Session | undefined> {
    const data = await this.redis.hgetall(`${KEY_PREFIX}${token}`);
    if (!data.did) return undefined;

    return {
      did: data.did,
      handle: data.handle ?? '',
      createdAt: Number(data.createdAt),
      expiresAt: Number(data.expiresAt),
    };
  }

  async delete(token: string): Promise<void> {
    const data = await this.redis.hgetall(`${KEY_PREFIX}${token}`);
    if (data.did) {
      const pipeline = this.redis.pipeline();
      pipeline.del(`${KEY_PREFIX}${token}`);
      pipeline.srem(`${DID_PREFIX}${data.did}`, token);
      await pipeline.exec();
    }
  }

  async hasDid(did: string): Promise<boolean> {
    // Check if any tokens in the DID's set are still valid
    const tokens = await this.redis.smembers(`${DID_PREFIX}${did}`);
    if (tokens.length === 0) return false;

    // Verify at least one token still exists (not expired by Redis TTL)
    for (const token of tokens) {
      const exists = await this.redis.exists(`${KEY_PREFIX}${token}`);
      if (exists) return true;
    }

    // All tokens expired — clean up the stale set
    await this.redis.del(`${DID_PREFIX}${did}`);
    return false;
  }

  async updateHandle(did: string, newHandle: string): Promise<void> {
    const tokens = await this.redis.smembers(`${DID_PREFIX}${did}`);
    if (tokens.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const token of tokens) {
      pipeline.hset(`${KEY_PREFIX}${token}`, 'handle', newHandle);
    }
    await pipeline.exec();
  }

  async revokeByDid(did: string): Promise<boolean> {
    const tokens = await this.redis.smembers(`${DID_PREFIX}${did}`);
    if (tokens.length === 0) return false;

    const pipeline = this.redis.pipeline();
    for (const token of tokens) {
      pipeline.del(`${KEY_PREFIX}${token}`);
    }
    pipeline.del(`${DID_PREFIX}${did}`);
    await pipeline.exec();

    return true;
  }

  prune(): Promise<number> {
    // Redis TTL handles expiration automatically — no-op
    return Promise.resolve(0);
  }
}

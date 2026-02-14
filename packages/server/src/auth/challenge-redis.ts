import { randomBytes } from 'crypto';
import type { Redis } from '../redis/client.js';
import type { ChallengeStoreInterface } from './challenge.js';

const KEY_PREFIX = 'challenge:';
const CHALLENGE_TTL_SECONDS = 60; // 60 seconds

export class RedisChallengeStore implements ChallengeStoreInterface {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async create(did: string): Promise<string> {
    const nonce = randomBytes(32).toString('hex');
    await this.redis.set(`${KEY_PREFIX}${did}`, nonce, 'EX', CHALLENGE_TTL_SECONDS);
    return nonce;
  }

  async consume(did: string, nonce: string): Promise<boolean> {
    const stored = await this.redis.get(`${KEY_PREFIX}${did}`);
    if (!stored) return false;
    await this.redis.del(`${KEY_PREFIX}${did}`);
    return stored === nonce;
  }

  prune(): Promise<number> {
    // Redis TTL handles expiration automatically
    return Promise.resolve(0);
  }
}

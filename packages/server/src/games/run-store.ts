import { randomInt, randomUUID } from 'node:crypto';
import type { Redis } from '../redis/client.js';

// A run ticket is short-lived: it only needs to outlive a single play
// session. 30 minutes is a generous ceiling on one game.
const TTL_SECONDS = 1800;
const KEY_PREFIX = 'game:run:';

export interface PendingRun {
  seed: number;
  did: string;
  system: string;
  startedAt: number;
}

export interface IssuedRun {
  runId: string;
  seed: number;
}

/**
 * Issues and tracks server-side run tickets. Each ticket pins a seed to a
 * specific player and is single-use — consuming it (on score submission)
 * atomically deletes it, so a recorded run can never be submitted twice.
 *
 * Redis-backed when available; falls back to an in-memory map for local dev.
 */
export class RunStore {
  private readonly mem = new Map<string, { run: PendingRun; expiresAt: number }>();

  constructor(private readonly redis: Redis | null) {}

  async create(did: string, system: string): Promise<IssuedRun> {
    const runId = randomUUID();
    // Cryptographically random uint32 seed — unpredictable, so a client can
    // never precompute a favourable game before calling /start.
    const seed = randomInt(0, 0x100000000);
    const run: PendingRun = { seed, did, system, startedAt: Date.now() };
    if (this.redis) {
      await this.redis.set(KEY_PREFIX + runId, JSON.stringify(run), 'EX', TTL_SECONDS);
    } else {
      this.pruneMem();
      this.mem.set(runId, { run, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    }
    return { runId, seed };
  }

  /** Single-use fetch — returns the run and removes it atomically. */
  async consume(runId: string): Promise<PendingRun | null> {
    if (this.redis) {
      const raw = await this.redis.getdel(KEY_PREFIX + runId);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PendingRun;
      } catch {
        return null;
      }
    }
    const entry = this.mem.get(runId);
    if (!entry) return null;
    this.mem.delete(runId);
    if (entry.expiresAt < Date.now()) return null;
    return entry.run;
  }

  private pruneMem(): void {
    const now = Date.now();
    for (const [id, entry] of this.mem) {
      if (entry.expiresAt < now) this.mem.delete(id);
    }
  }
}

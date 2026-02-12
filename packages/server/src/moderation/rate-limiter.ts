import type { RateLimiterStore } from './rate-limiter-store.js';

interface WindowEntry {
  timestamps: number[];
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

export class InMemoryRateLimiter implements RateLimiterStore {
  private windows = new Map<string, WindowEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor(opts?: { windowMs?: number; maxRequests?: number }) {
    this.windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  }

  check(key: string): Promise<boolean> {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      return Promise.resolve(false);
    }

    entry.timestamps.push(now);
    return Promise.resolve(true);
  }

  prune(): Promise<number> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let pruned = 0;
    for (const [key, entry] of this.windows) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
        pruned++;
      }
    }
    return Promise.resolve(pruned);
  }
}

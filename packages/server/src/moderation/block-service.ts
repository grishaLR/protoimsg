/** How long to keep block lists for disconnected users (10 minutes) */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/** How often to run the sweep (5 minutes) */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** In-memory block list store. Clients sync their atproto block lists here. */
export class BlockService {
  private blocks = new Map<string, Set<string>>();
  private lastSeen = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Replace a user's entire block list (called on sync_blocks) */
  sync(did: string, blockedDids: string[]): void {
    this.lastSeen.set(did, Date.now());
    if (blockedDids.length === 0) {
      this.blocks.delete(did);
    } else {
      this.blocks.set(did, new Set(blockedDids));
    }
  }

  /** Update last-seen timestamp (call on connect/message) */
  touch(did: string): void {
    this.lastSeen.set(did, Date.now());
  }

  /** Check if either user blocks the other (bidirectional) */
  isBlocked(did1: string, did2: string): boolean {
    const blocks1 = this.blocks.get(did1);
    if (blocks1?.has(did2)) return true;
    const blocks2 = this.blocks.get(did2);
    if (blocks2?.has(did1)) return true;
    return false;
  }

  /** Check if did1 specifically blocks did2 (unidirectional) */
  doesBlock(blocker: string, target: string): boolean {
    return this.blocks.get(blocker)?.has(target) ?? false;
  }

  /** Remove a user's block list */
  clear(did: string): void {
    this.blocks.delete(did);
    this.lastSeen.delete(did);
  }

  /** Start periodic sweep of stale entries */
  startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const cutoff = Date.now() - STALE_THRESHOLD_MS;
      for (const [did, ts] of this.lastSeen) {
        if (ts < cutoff) {
          this.blocks.delete(did);
          this.lastSeen.delete(did);
        }
      }
    }, SWEEP_INTERVAL_MS);
  }

  /** Stop the sweep timer (for graceful shutdown) */
  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

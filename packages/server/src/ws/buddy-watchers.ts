import type { WebSocket } from 'ws';

/**
 * Tracks which sockets are watching which DIDs for buddy presence.
 * When a watched DID's status changes, we notify the watchers.
 */
export class BuddyWatchers {
  /** did → set of sockets watching that did */
  private watchers = new Map<string, Set<WebSocket>>();

  /** Register a socket as watching a set of DIDs */
  watch(ws: WebSocket, dids: string[]): void {
    for (const did of dids) {
      let set = this.watchers.get(did);
      if (!set) {
        set = new Set();
        this.watchers.set(did, set);
      }
      set.add(ws);
    }
  }

  /** Remove a socket from all watch lists (on disconnect) */
  unwatchAll(ws: WebSocket): void {
    for (const [did, set] of this.watchers) {
      set.delete(ws);
      if (set.size === 0) {
        this.watchers.delete(did);
      }
    }
  }

  /** Notify all sockets watching a specific DID */
  notify(did: string, status: string, awayMessage?: string): void {
    const set = this.watchers.get(did);
    if (!set) return;

    const msg = JSON.stringify({
      type: 'buddy_presence',
      data: [{ did, status, awayMessage }],
    });

    for (const ws of set) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }
}

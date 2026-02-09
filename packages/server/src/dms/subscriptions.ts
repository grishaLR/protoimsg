import type { WebSocket } from 'ws';

/** Manages WebSocket connections per DM conversation for broadcasting */
export class DmSubscriptions {
  private conversations = new Map<string, Set<WebSocket>>();

  subscribe(conversationId: string, ws: WebSocket): void {
    let subs = this.conversations.get(conversationId);
    if (!subs) {
      subs = new Set();
      this.conversations.set(conversationId, subs);
    }
    subs.add(ws);
  }

  unsubscribe(conversationId: string, ws: WebSocket): void {
    const subs = this.conversations.get(conversationId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        this.conversations.delete(conversationId);
      }
    }
  }

  /** Unsubscribe a socket from all conversations, returns the set of abandoned conversation IDs */
  unsubscribeAll(ws: WebSocket): Set<string> {
    const abandoned = new Set<string>();
    for (const [conversationId, subs] of this.conversations) {
      if (subs.has(ws)) {
        subs.delete(ws);
        if (subs.size === 0) {
          this.conversations.delete(conversationId);
          abandoned.add(conversationId);
        }
      }
    }
    return abandoned;
  }

  hasSubscribers(conversationId: string): boolean {
    const subs = this.conversations.get(conversationId);
    return subs !== undefined && subs.size > 0;
  }

  getSubscribers(conversationId: string): Set<WebSocket> {
    return this.conversations.get(conversationId) ?? new Set();
  }

  broadcast(conversationId: string, data: unknown, exclude?: WebSocket): void {
    const subscribers = this.getSubscribers(conversationId);
    const message = JSON.stringify(data);
    for (const ws of subscribers) {
      if (ws !== exclude && ws.readyState === ws.OPEN) {
        try {
          ws.send(message);
        } catch {
          // Socket closed between readyState check and send — skip
        }
      }
    }
  }
}

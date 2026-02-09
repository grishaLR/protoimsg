import type { WebSocket } from 'ws';

/** Manages WebSocket connections per room for broadcasting */
export class RoomSubscriptions {
  private rooms = new Map<string, Set<WebSocket>>();

  subscribe(roomId: string, ws: WebSocket): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    room.add(ws);
  }

  unsubscribe(roomId: string, ws: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  unsubscribeAll(ws: WebSocket): void {
    for (const [roomId, room] of this.rooms) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  getSubscribers(roomId: string): Set<WebSocket> {
    return this.rooms.get(roomId) ?? new Set();
  }

  broadcast(roomId: string, data: unknown, exclude?: WebSocket): void {
    const subscribers = this.getSubscribers(roomId);
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

import type { PresenceStatus } from '@chatmosphere/shared';

interface UserPresence {
  did: string;
  status: PresenceStatus;
  lastSeen: Date;
  rooms: Set<string>;
}

/** In-memory presence tracker backed by WebSocket connections */
export class PresenceTracker {
  private users = new Map<string, UserPresence>();

  setOnline(did: string): void {
    const existing = this.users.get(did);
    if (existing) {
      existing.status = 'online';
      existing.lastSeen = new Date();
    } else {
      this.users.set(did, {
        did,
        status: 'online',
        lastSeen: new Date(),
        rooms: new Set(),
      });
    }
  }

  setOffline(did: string): void {
    this.users.delete(did);
  }

  setStatus(did: string, status: PresenceStatus): void {
    const user = this.users.get(did);
    if (user) {
      user.status = status;
      user.lastSeen = new Date();
    }
  }

  joinRoom(did: string, roomId: string): void {
    const user = this.users.get(did);
    if (user) {
      user.rooms.add(roomId);
    }
  }

  leaveRoom(did: string, roomId: string): void {
    const user = this.users.get(did);
    if (user) {
      user.rooms.delete(roomId);
    }
  }

  getStatus(did: string): PresenceStatus {
    return this.users.get(did)?.status ?? 'offline';
  }

  getRoomMembers(roomId: string): string[] {
    const members: string[] = [];
    for (const [did, presence] of this.users) {
      if (presence.rooms.has(roomId)) {
        members.push(did);
      }
    }
    return members;
  }

  getOnlineUsers(): string[] {
    return Array.from(this.users.keys());
  }
}

export const presenceTracker = new PresenceTracker();

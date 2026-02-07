import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';

export interface UserPresence {
  did: string;
  status: PresenceStatus;
  visibleTo: PresenceVisibility;
  awayMessage?: string;
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
        visibleTo: 'everyone',
        lastSeen: new Date(),
        rooms: new Set(),
      });
    }
  }

  setOffline(did: string): void {
    this.users.delete(did);
  }

  setStatus(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): void {
    const user = this.users.get(did);
    if (user) {
      user.status = status;
      user.awayMessage = status === 'away' ? awayMessage : undefined;
      if (visibleTo) user.visibleTo = visibleTo;
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

  getPresence(did: string): { status: PresenceStatus; awayMessage?: string } {
    const user = this.users.get(did);
    return { status: user?.status ?? 'offline', awayMessage: user?.awayMessage };
  }

  getVisibleTo(did: string): PresenceVisibility {
    return this.users.get(did)?.visibleTo ?? 'everyone';
  }

  getPresenceBulk(dids: string[]): Map<string, { status: PresenceStatus; awayMessage?: string }> {
    const result = new Map<string, { status: PresenceStatus; awayMessage?: string }>();
    for (const did of dids) {
      result.set(did, this.getPresence(did));
    }
    return result;
  }

  getUserRooms(did: string): Set<string> {
    return this.users.get(did)?.rooms ?? new Set();
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

import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';
import type { PresenceTrackerStore } from './tracker-store.js';

interface UserPresence {
  did: string;
  status: PresenceStatus;
  visibleTo: PresenceVisibility;
  awayMessage?: string;
  lastSeen: Date;
  rooms: Set<string>;
}

export class InMemoryPresenceTracker implements PresenceTrackerStore {
  private users = new Map<string, UserPresence>();
  /** Reverse index: roomId -> Set of DIDs currently in that room. O(1) lookups. */
  private roomMembers = new Map<string, Set<string>>();

  setOnline(did: string): Promise<void> {
    const existing = this.users.get(did);
    if (existing) {
      existing.status = 'online';
      existing.lastSeen = new Date();
    } else {
      this.users.set(did, {
        did,
        status: 'online',
        visibleTo: 'no-one',
        lastSeen: new Date(),
        rooms: new Set(),
      });
    }
    return Promise.resolve();
  }

  setOffline(did: string): Promise<void> {
    const user = this.users.get(did);
    if (user) {
      // Clean up reverse index for all rooms this user was in
      for (const roomId of user.rooms) {
        const members = this.roomMembers.get(roomId);
        if (members) {
          members.delete(did);
          if (members.size === 0) this.roomMembers.delete(roomId);
        }
      }
      this.users.delete(did);
    }
    return Promise.resolve();
  }

  setStatus(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): Promise<void> {
    const user = this.users.get(did);
    if (user) {
      user.status = status;
      user.awayMessage = status === 'away' ? awayMessage : undefined;
      if (visibleTo) user.visibleTo = visibleTo;
      user.lastSeen = new Date();
    }
    return Promise.resolve();
  }

  joinRoom(did: string, roomId: string): Promise<void> {
    const user = this.users.get(did);
    if (user) {
      user.rooms.add(roomId);
      // Update reverse index
      let members = this.roomMembers.get(roomId);
      if (!members) {
        members = new Set();
        this.roomMembers.set(roomId, members);
      }
      members.add(did);
    }
    return Promise.resolve();
  }

  leaveRoom(did: string, roomId: string): Promise<void> {
    const user = this.users.get(did);
    if (user) {
      user.rooms.delete(roomId);
      // Update reverse index
      const members = this.roomMembers.get(roomId);
      if (members) {
        members.delete(did);
        if (members.size === 0) this.roomMembers.delete(roomId);
      }
    }
    return Promise.resolve();
  }

  getStatus(did: string): Promise<PresenceStatus> {
    return Promise.resolve(this.users.get(did)?.status ?? 'offline');
  }

  getPresence(did: string): Promise<{ status: PresenceStatus; awayMessage?: string }> {
    const user = this.users.get(did);
    return Promise.resolve({ status: user?.status ?? 'offline', awayMessage: user?.awayMessage });
  }

  getVisibleTo(did: string): Promise<PresenceVisibility> {
    return Promise.resolve(this.users.get(did)?.visibleTo ?? 'no-one');
  }

  getPresenceBulk(
    dids: string[],
  ): Promise<Map<string, { status: PresenceStatus; awayMessage?: string }>> {
    const result = new Map<string, { status: PresenceStatus; awayMessage?: string }>();
    for (const did of dids) {
      const user = this.users.get(did);
      result.set(did, { status: user?.status ?? 'offline', awayMessage: user?.awayMessage });
    }
    return Promise.resolve(result);
  }

  getUserRooms(did: string): Promise<Set<string>> {
    return Promise.resolve(this.users.get(did)?.rooms ?? new Set());
  }

  /** O(1) via reverse index instead of O(N) scan over all users */
  getRoomMembers(roomId: string): Promise<string[]> {
    const members = this.roomMembers.get(roomId);
    return Promise.resolve(members ? [...members] : []);
  }

  getOnlineUsers(): Promise<string[]> {
    return Promise.resolve(Array.from(this.users.keys()));
  }
}

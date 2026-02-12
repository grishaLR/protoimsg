import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';
import type { PresenceTrackerStore } from './tracker-store.js';

export interface PresenceService {
  handleUserConnect(did: string): Promise<void>;
  handleUserDisconnect(did: string): Promise<void>;
  handleStatusChange(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): Promise<void>;
  handleJoinRoom(did: string, roomId: string): Promise<void>;
  handleLeaveRoom(did: string, roomId: string): Promise<void>;
  getUserStatus(did: string): Promise<PresenceStatus>;
  getPresence(did: string): Promise<{ status: PresenceStatus; awayMessage?: string }>;
  getVisibleTo(did: string): Promise<PresenceVisibility>;
  getRoomPresence(roomId: string): Promise<string[]>;
  getBulkPresence(
    dids: string[],
  ): Promise<Array<{ did: string; status: string; awayMessage?: string }>>;
  getUserRooms(did: string): Promise<Set<string>>;
}

export function createPresenceService(tracker: PresenceTrackerStore): PresenceService {
  return {
    async handleUserConnect(did: string): Promise<void> {
      await tracker.setOnline(did);
    },

    async handleUserDisconnect(did: string): Promise<void> {
      await tracker.setOffline(did);
    },

    async handleStatusChange(
      did: string,
      status: PresenceStatus,
      awayMessage?: string,
      visibleTo?: PresenceVisibility,
    ): Promise<void> {
      await tracker.setStatus(did, status, awayMessage, visibleTo);
    },

    async handleJoinRoom(did: string, roomId: string): Promise<void> {
      await tracker.joinRoom(did, roomId);
    },

    async handleLeaveRoom(did: string, roomId: string): Promise<void> {
      await tracker.leaveRoom(did, roomId);
    },

    async getUserStatus(did: string): Promise<PresenceStatus> {
      return tracker.getStatus(did);
    },

    async getPresence(did: string): Promise<{ status: PresenceStatus; awayMessage?: string }> {
      return tracker.getPresence(did);
    },

    async getVisibleTo(did: string): Promise<PresenceVisibility> {
      return tracker.getVisibleTo(did);
    },

    async getRoomPresence(roomId: string): Promise<string[]> {
      return tracker.getRoomMembers(roomId);
    },

    async getBulkPresence(
      dids: string[],
    ): Promise<Array<{ did: string; status: string; awayMessage?: string }>> {
      const presenceMap = await tracker.getPresenceBulk(dids);
      return dids.map((did) => {
        const p = presenceMap.get(did) ?? { status: 'offline' };
        return { did, status: p.status, awayMessage: p.awayMessage };
      });
    },

    async getUserRooms(did: string): Promise<Set<string>> {
      return tracker.getUserRooms(did);
    },
  };
}

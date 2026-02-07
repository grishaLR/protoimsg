import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';
import type { PresenceTracker } from './tracker.js';

export interface PresenceService {
  handleUserConnect(did: string): void;
  handleUserDisconnect(did: string): void;
  handleStatusChange(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): void;
  handleJoinRoom(did: string, roomId: string): void;
  handleLeaveRoom(did: string, roomId: string): void;
  getUserStatus(did: string): PresenceStatus;
  getPresence(did: string): { status: PresenceStatus; awayMessage?: string };
  getRoomPresence(roomId: string): string[];
  getBulkPresence(dids: string[]): Array<{ did: string; status: string; awayMessage?: string }>;
  getUserRooms(did: string): Set<string>;
}

export function createPresenceService(tracker: PresenceTracker): PresenceService {
  return {
    handleUserConnect(did: string): void {
      tracker.setOnline(did);
    },

    handleUserDisconnect(did: string): void {
      tracker.setOffline(did);
    },

    handleStatusChange(
      did: string,
      status: PresenceStatus,
      awayMessage?: string,
      visibleTo?: PresenceVisibility,
    ): void {
      tracker.setStatus(did, status, awayMessage, visibleTo);
    },

    handleJoinRoom(did: string, roomId: string): void {
      tracker.joinRoom(did, roomId);
    },

    handleLeaveRoom(did: string, roomId: string): void {
      tracker.leaveRoom(did, roomId);
    },

    getUserStatus(did: string): PresenceStatus {
      return tracker.getStatus(did);
    },

    getPresence(did: string): { status: PresenceStatus; awayMessage?: string } {
      return tracker.getPresence(did);
    },

    getRoomPresence(roomId: string): string[] {
      return tracker.getRoomMembers(roomId);
    },

    getBulkPresence(dids: string[]): Array<{ did: string; status: string; awayMessage?: string }> {
      const presenceMap = tracker.getPresenceBulk(dids);
      return dids.map((did) => {
        const p = presenceMap.get(did) ?? { status: 'offline' };
        return { did, status: p.status, awayMessage: p.awayMessage };
      });
    },

    getUserRooms(did: string): Set<string> {
      return tracker.getUserRooms(did);
    },
  };
}

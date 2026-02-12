import type { PresenceStatus, PresenceVisibility } from '@protoimsg/shared';

export interface PresenceTrackerStore {
  setOnline(did: string): Promise<void>;
  setOffline(did: string): Promise<void>;
  setStatus(
    did: string,
    status: PresenceStatus,
    awayMessage?: string,
    visibleTo?: PresenceVisibility,
  ): Promise<void>;
  joinRoom(did: string, roomId: string): Promise<void>;
  leaveRoom(did: string, roomId: string): Promise<void>;
  getStatus(did: string): Promise<PresenceStatus>;
  getPresence(did: string): Promise<{ status: PresenceStatus; awayMessage?: string }>;
  getVisibleTo(did: string): Promise<PresenceVisibility>;
  getPresenceBulk(
    dids: string[],
  ): Promise<Map<string, { status: PresenceStatus; awayMessage?: string }>>;
  getUserRooms(did: string): Promise<Set<string>>;
  getRoomMembers(roomId: string): Promise<string[]>;
  getOnlineUsers(): Promise<string[]>;
}

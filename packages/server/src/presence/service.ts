import type { PresenceStatus } from '@chatmosphere/shared';
import { presenceTracker } from './tracker.js';

export function handleUserConnect(did: string): void {
  presenceTracker.setOnline(did);
}

export function handleUserDisconnect(did: string): void {
  presenceTracker.setOffline(did);
}

export function handleStatusChange(did: string, status: PresenceStatus): void {
  presenceTracker.setStatus(did, status);
}

export function handleJoinRoom(did: string, roomId: string): void {
  presenceTracker.joinRoom(did, roomId);
}

export function handleLeaveRoom(did: string, roomId: string): void {
  presenceTracker.leaveRoom(did, roomId);
}

export function getUserStatus(did: string): PresenceStatus {
  return presenceTracker.getStatus(did);
}

export function getRoomPresence(roomId: string): string[] {
  return presenceTracker.getRoomMembers(roomId);
}

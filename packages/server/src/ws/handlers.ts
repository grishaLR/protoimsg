import type { WebSocket } from 'ws';
import type { ClientMessage } from './types.js';
import type { RoomSubscriptions } from './rooms.js';
import type { BuddyWatchers } from './buddy-watchers.js';
import {
  handleJoinRoom,
  handleLeaveRoom,
  handleStatusChange,
  getRoomPresence,
  getUserRooms,
  getBulkPresence,
} from '../presence/service.js';
import { presenceTracker } from '../presence/tracker.js';
import type { PresenceStatus } from '@chatmosphere/shared';

export function handleClientMessage(
  ws: WebSocket,
  did: string,
  data: ClientMessage,
  roomSubs: RoomSubscriptions,
  buddyWatchers: BuddyWatchers,
): void {
  switch (data.type) {
    case 'join_room': {
      roomSubs.subscribe(data.roomId, ws);
      handleJoinRoom(did, data.roomId);
      const members = getRoomPresence(data.roomId);
      ws.send(
        JSON.stringify({
          type: 'room_joined',
          roomId: data.roomId,
          members,
        }),
      );
      // Notify room of new member (include awayMessage if present)
      const presence = presenceTracker.getPresence(did);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: presence.status, awayMessage: presence.awayMessage },
      });
      break;
    }

    case 'leave_room': {
      roomSubs.unsubscribe(data.roomId, ws);
      handleLeaveRoom(did, data.roomId);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: 'offline' },
      });
      break;
    }

    case 'status_change': {
      handleStatusChange(did, data.status as PresenceStatus, data.awayMessage);
      // Broadcast presence update to all rooms the user is in
      const rooms = getUserRooms(did);
      for (const roomId of rooms) {
        roomSubs.broadcast(roomId, {
          type: 'presence',
          data: { did, status: data.status, awayMessage: data.awayMessage },
        });
      }
      // Notify buddy watchers
      buddyWatchers.notify(did, data.status, data.awayMessage);
      break;
    }

    case 'request_buddy_presence': {
      const capped = data.dids.slice(0, 100);
      const presenceList = getBulkPresence(capped);
      ws.send(
        JSON.stringify({
          type: 'buddy_presence',
          data: presenceList,
        }),
      );
      // Register this socket as watching these DIDs for live updates
      buddyWatchers.watch(ws, capped);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }
  }
}

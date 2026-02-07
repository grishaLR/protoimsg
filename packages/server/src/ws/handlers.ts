import type { WebSocket } from 'ws';
import type { ClientMessage } from './types.js';
import type { RoomSubscriptions } from './rooms.js';
import {
  handleJoinRoom,
  handleLeaveRoom,
  handleStatusChange,
  getRoomPresence,
} from '../presence/service.js';
import type { PresenceStatus } from '@chatmosphere/shared';

export function handleClientMessage(
  ws: WebSocket,
  did: string,
  data: ClientMessage,
  roomSubs: RoomSubscriptions,
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
      // Notify room of new member
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: 'online' },
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
      handleStatusChange(did, data.status as PresenceStatus);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }
  }
}

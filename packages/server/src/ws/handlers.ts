import type { WebSocket } from 'ws';
import { DM_LIMITS } from '@chatmosphere/shared';
import type { ClientMessage } from './types.js';
import type { RoomSubscriptions } from './rooms.js';
import type { DmSubscriptions } from '../dms/subscriptions.js';
import type { UserSockets } from './server.js';
import type { BuddyWatchers } from './buddy-watchers.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { PresenceStatus, PresenceVisibility } from '@chatmosphere/shared';
import type { Sql } from '../db/client.js';
import type { RateLimiter } from '../moderation/rate-limiter.js';
import { checkUserAccess } from '../moderation/service.js';

export async function handleClientMessage(
  ws: WebSocket,
  did: string,
  data: ClientMessage,
  roomSubs: RoomSubscriptions,
  buddyWatchers: BuddyWatchers,
  service: PresenceService,
  sql: Sql,
  rateLimiter: RateLimiter,
  dmSubs: DmSubscriptions,
  userSockets: UserSockets,
  dmService: DmService,
): Promise<void> {
  // Rate limit WS messages
  if (!rateLimiter.check(`ws:${did}`)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Rate limited' }));
    return;
  }

  switch (data.type) {
    case 'join_room': {
      const access = await checkUserAccess(sql, data.roomId, did);
      if (!access.allowed) {
        ws.send(JSON.stringify({ type: 'error', message: access.reason ?? 'Access denied' }));
        break;
      }

      roomSubs.subscribe(data.roomId, ws);
      service.handleJoinRoom(did, data.roomId);
      const members = service.getRoomPresence(data.roomId);
      ws.send(
        JSON.stringify({
          type: 'room_joined',
          roomId: data.roomId,
          members,
        }),
      );
      // Notify room of new member (include awayMessage if present)
      const presence = service.getPresence(did);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: presence.status, awayMessage: presence.awayMessage },
      });
      break;
    }

    case 'leave_room': {
      roomSubs.unsubscribe(data.roomId, ws);
      service.handleLeaveRoom(did, data.roomId);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: 'offline' },
      });
      break;
    }

    case 'status_change': {
      const visibleTo = data.visibleTo as PresenceVisibility | undefined;
      service.handleStatusChange(did, data.status as PresenceStatus, data.awayMessage, visibleTo);
      // Broadcast presence update to all rooms the user is in
      const rooms = service.getUserRooms(did);
      for (const roomId of rooms) {
        roomSubs.broadcast(roomId, {
          type: 'presence',
          data: { did, status: data.status, awayMessage: data.awayMessage },
        });
      }
      // Notify buddy watchers (visibility-aware)
      buddyWatchers.notify(did, data.status, data.awayMessage, visibleTo);
      break;
    }

    case 'request_buddy_presence': {
      const capped = data.dids.slice(0, 100);
      const presenceList = service.getBulkPresence(capped);
      ws.send(
        JSON.stringify({
          type: 'buddy_presence',
          data: presenceList,
        }),
      );
      // Register this socket as watching these DIDs for live updates
      buddyWatchers.watch(ws, did, capped);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    case 'dm_open': {
      // Validate recipientDid
      if (
        typeof data.recipientDid !== 'string' ||
        !data.recipientDid.startsWith('did:') ||
        data.recipientDid === did
      ) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              data.recipientDid === did ? 'Cannot open DM with yourself' : 'Invalid recipient DID',
          }),
        );
        break;
      }

      try {
        const { conversation, messages } = await dmService.openConversation(did, data.recipientDid);
        dmSubs.subscribe(conversation.id, ws);

        ws.send(
          JSON.stringify({
            type: 'dm_opened',
            data: {
              conversationId: conversation.id,
              recipientDid: data.recipientDid,
              persist: conversation.persist,
              messages: messages.map((m) => ({
                id: m.id,
                conversationId: m.conversation_id,
                senderDid: m.sender_did,
                text: m.text,
                createdAt: m.created_at.toISOString(),
              })),
            },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to open DM';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'dm_send': {
      // Validate text
      if (typeof data.text !== 'string' || data.text.trim().length === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message text is required' }));
        break;
      }
      if (data.text.length > DM_LIMITS.maxMessageLength) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Message exceeds ${String(DM_LIMITS.maxMessageLength)} characters`,
          }),
        );
        break;
      }

      try {
        const { message, recipientDid } = await dmService.sendMessage(
          data.conversationId,
          did,
          data.text,
        );

        const event = {
          type: 'dm_message' as const,
          data: {
            id: message.id,
            conversationId: message.conversation_id,
            senderDid: message.sender_did,
            text: message.text,
            createdAt: message.created_at.toISOString(),
          },
        };

        // Broadcast to all sockets subscribed to this conversation
        dmSubs.broadcast(data.conversationId, event);

        // Send dm_incoming to recipient's sockets that don't have this convo open
        const recipientSockets = userSockets.get(recipientDid);
        const convoSubscribers = dmSubs.getSubscribers(data.conversationId);
        const preview = data.text.slice(0, DM_LIMITS.maxPreviewLength);

        for (const recipientWs of recipientSockets) {
          if (!convoSubscribers.has(recipientWs) && recipientWs.readyState === recipientWs.OPEN) {
            recipientWs.send(
              JSON.stringify({
                type: 'dm_incoming',
                data: {
                  conversationId: data.conversationId,
                  senderDid: did,
                  preview,
                },
              }),
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send DM';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'dm_close': {
      dmSubs.unsubscribe(data.conversationId, ws);

      // If no subscribers remain, clean up ephemeral conversation
      if (!dmSubs.hasSubscribers(data.conversationId)) {
        void dmService.cleanupIfEmpty(data.conversationId);
      }
      break;
    }

    case 'dm_typing': {
      const isParticipant = await dmService.isParticipant(data.conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }

      dmSubs.broadcast(
        data.conversationId,
        {
          type: 'dm_typing',
          data: { conversationId: data.conversationId, senderDid: did },
        },
        ws, // exclude sender
      );
      break;
    }

    case 'dm_toggle_persist': {
      try {
        await dmService.togglePersist(data.conversationId, did, data.persist);

        dmSubs.broadcast(data.conversationId, {
          type: 'dm_persist_changed',
          data: {
            conversationId: data.conversationId,
            persist: data.persist,
            changedBy: did,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to toggle persist';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }
  }
}

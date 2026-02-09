import type { WebSocket } from 'ws';
import { DM_LIMITS } from '@chatmosphere/shared';
import type { ValidatedClientMessage } from './validation.js';
import type { RoomSubscriptions } from './rooms.js';
import type { DmSubscriptions } from '../dms/subscriptions.js';
import type { UserSockets } from './server.js';
import type { BuddyWatchers } from './buddy-watchers.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { PresenceVisibility } from '@chatmosphere/shared';
import type { Sql } from '../db/client.js';
import type { RateLimiter } from '../moderation/rate-limiter.js';
import { checkUserAccess } from '../moderation/service.js';
import type { BlockService } from '../moderation/block-service.js';

export async function handleClientMessage(
  ws: WebSocket,
  did: string,
  data: ValidatedClientMessage,
  roomSubs: RoomSubscriptions,
  buddyWatchers: BuddyWatchers,
  service: PresenceService,
  sql: Sql,
  rateLimiter: RateLimiter,
  dmSubs: DmSubscriptions,
  userSockets: UserSockets,
  dmService: DmService,
  blockService: BlockService,
): Promise<void> {
  // Rate limit per-socket so multi-tab users get separate quotas
  const socketId = (ws as WebSocket & { socketId?: string }).socketId ?? did;
  if (!rateLimiter.check(`ws:socket:${socketId}`)) {
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
      service.handleStatusChange(did, data.status, data.awayMessage, visibleTo);
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
      const presenceList = service
        .getBulkPresence(data.dids)
        .map((p) =>
          blockService.doesBlock(p.did, did) ? { did: p.did, status: 'offline' as const } : p,
        );
      ws.send(
        JSON.stringify({
          type: 'buddy_presence',
          data: presenceList,
        }),
      );
      // Register this socket as watching these DIDs for live updates
      buddyWatchers.watch(ws, did, data.dids);
      break;
    }

    case 'room_typing': {
      // Only broadcast if the user is actually in the room
      const roomMembers = roomSubs.getSubscribers(data.roomId);
      if (roomMembers.has(ws)) {
        roomSubs.broadcast(
          data.roomId,
          { type: 'room_typing', data: { roomId: data.roomId, did } },
          ws,
        );
      }
      break;
    }

    case 'sync_blocks': {
      blockService.sync(did, data.blockedDids);
      // Re-notify all watchers with block-filtered presence
      // (newly blocked get offline, newly unblocked get real status)
      const presence = service.getPresence(did);
      buddyWatchers.notify(did, presence.status, presence.awayMessage);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    case 'dm_open': {
      if (data.recipientDid === did) {
        ws.send(JSON.stringify({ type: 'error', message: 'Cannot open DM with yourself' }));
        break;
      }

      if (blockService.isBlocked(did, data.recipientDid)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Cannot message this user' }));
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
      if (data.text.length > DM_LIMITS.maxMessageLength) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Message exceeds ${String(DM_LIMITS.maxMessageLength)} characters`,
          }),
        );
        break;
      }

      // Check blocks before sending
      {
        const recipient = await dmService.getRecipientDid(data.conversationId, did);
        if (recipient && blockService.isBlocked(did, recipient)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Cannot message this user' }));
          break;
        }
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
      const isParticipant = await dmService.isParticipant(data.conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }

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

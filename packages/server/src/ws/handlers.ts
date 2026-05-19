import type { WebSocket } from 'ws';
import { ERROR_CODES } from '@protoimsg/shared';
import type { ValidatedClientMessage } from './validation.js';
import type { DmSubscriptions } from '../dms/subscriptions.js';
import type { UserSockets } from './server.js';
import type { CommunityWatchers } from './buddy-watchers.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { ImRegistry } from '../dms/registry.js';
import type { PresenceVisibility } from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';
import type { BlockService } from '../moderation/block-service.js';
import type { LabelerService } from '../moderation/labeler-service.js';
import type { BotService } from '../bot/service.js';
import type { NotificationService } from '../notifications/service.js';
import type { GroupCallService } from '../calls/service.js';
import type { TownRoom } from './town.js';
import { createLogger } from '../logger.js';
import { incDmsSent } from '../stats/queries.js';
import {
  syncCommunityMembers,
  upsertCommunityList,
  batchCheckMembership,
  batchCheckInnerCircle,
} from '../community/queries.js';
import { computeConversationId, sortDids } from '../dms/queries.js';
import { resolveVisibleStatus } from '../presence/visibility.js';

/**
 * Per-DID pending call tracker. Prevents a user from spamming make_call
 * before the previous call is accepted/rejected. Key: caller DID,
 * value: timestamp of the last make_call. Cleared on accept/reject.
 */
const log = createLogger('ws');
const CALL_COOLDOWN_MS = 30_000;
const pendingCallAttempts = new Map<string, number>();

/** Remove stale entries from the pending call attempts map (older than CALL_COOLDOWN_MS). */
export function pruneCallAttempts(): void {
  const cutoff = Date.now() - CALL_COOLDOWN_MS;
  for (const [key, ts] of pendingCallAttempts) {
    if (ts < cutoff) pendingCallAttempts.delete(key);
  }
}

export async function handleClientMessage(
  ws: WebSocket,
  did: string,
  handle: string,
  data: ValidatedClientMessage,
  communityWatchers: CommunityWatchers,
  service: PresenceService,
  sql: Sql,
  rateLimiter: RateLimiterStore,
  dmSubs: DmSubscriptions,
  userSockets: UserSockets,
  dmService: DmService,
  blockService: BlockService,
  imRegistry: ImRegistry,
  labelerService: LabelerService,
  callSubs: DmSubscriptions,
  botService: BotService | null,
  townRoom: TownRoom,
  notificationService?: NotificationService | null,
  groupCallService?: GroupCallService | null,
): Promise<void> {
  // Rate limit: per-socket for tab fairness, per-DID to cap total throughput.
  // town_move is exempt from this generic limiter — it is high-frequency by
  // design — but TownRoom.move applies its own per-socket token bucket so the
  // exemption can't be weaponised.
  if (data.type !== 'town_move') {
    const socketId = (ws as WebSocket & { socketId?: string }).socketId ?? did;
    if (
      !(await rateLimiter.check(`ws:socket:${socketId}`)) ||
      !(await rateLimiter.check(`ws:did:${did}`))
    ) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Rate limited',
          errorCode: ERROR_CODES.RATE_LIMITED,
        }),
      );
      return;
    }
  }

  switch (data.type) {
    case 'status_change': {
      const visibleTo = data.visibleTo as PresenceVisibility | undefined;
      await service.handleStatusChange(did, data.status, data.awayMessage, visibleTo);
      // Notify community watchers (visibility-aware)
      await communityWatchers.notify(did, data.status, data.awayMessage, visibleTo);
      break;
    }

    case 'request_community_presence': {
      const rawPresence = await service.getBulkPresence(data.dids);

      // Bulk-resolve all visibilities in one call (1 Redis pipeline instead of N)
      const visibilityMap = await service.getVisibleToBulk(data.dids);
      const communityCheckDids: string[] = [];
      const innerCircleCheckDids: string[] = [];

      for (const p of rawPresence) {
        // Skip blocked DIDs — they'll be mapped to offline in the result anyway
        if (blockService.isBlocked(p.did, did)) continue;
        const v = visibilityMap.get(p.did) ?? 'no-one';
        if (v === 'community' || v === 'inner-circle') {
          communityCheckDids.push(p.did);
        }
        if (v === 'inner-circle') {
          innerCircleCheckDids.push(p.did);
        }
      }

      // Two batch queries instead of N individual ones
      const [communityMembers, innerCircleSets] = await Promise.all([
        batchCheckMembership(sql, communityCheckDids, did),
        batchCheckInnerCircle(sql, innerCircleCheckDids, did),
      ]);

      const presenceList = rawPresence.map((p) => {
        if (blockService.isBlocked(p.did, did)) {
          return { did: p.did, status: 'offline' as const };
        }
        const visibility = visibilityMap.get(p.did) ?? 'no-one';
        if (visibility === 'everyone') return p;

        const member = communityMembers.has(p.did);
        const friend = innerCircleSets.has(p.did);

        const effectiveStatus = resolveVisibleStatus(
          visibility,
          p.status as 'online' | 'away' | 'idle' | 'offline',
          member,
          friend,
        );
        return {
          did: p.did,
          status: effectiveStatus,
          awayMessage: effectiveStatus === 'offline' ? undefined : p.awayMessage,
        };
      });
      ws.send(
        JSON.stringify({
          type: 'community_presence',
          data: presenceList,
        }),
      );
      // Register this socket as watching these DIDs for live updates
      communityWatchers.watch(ws, did, data.dids);
      break;
    }

    case 'sync_blocks': {
      log.info({ did, count: data.blockedDids.length }, 'sync_blocks');
      blockService.sync(did, data.blockedDids);
      // Re-notify all watchers with block-filtered presence
      // (newly blocked get offline, newly unblocked get real status)
      const blockPresence = await service.getPresence(did);
      const blockVisibleTo = await service.getVisibleTo(did);
      await communityWatchers.notify(
        did,
        blockPresence.status,
        blockPresence.awayMessage,
        blockVisibleTo,
      );
      break;
    }

    case 'sync_community': {
      const allMembers = data.groups.flatMap((g) => g.members);
      await syncCommunityMembers(sql, did, allMembers);
      await upsertCommunityList(sql, { did, groups: data.groups });
      // Re-notify watchers: inner circle changes affect who can see us
      const syncPresence = await service.getPresence(did);
      const syncVisibleTo = await service.getVisibleTo(did);
      await communityWatchers.notify(
        did,
        syncPresence.status,
        syncPresence.awayMessage,
        syncVisibleTo,
      );
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    case 'dm_open': {
      if (data.recipientDid === did) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Cannot open DM with yourself',
            errorCode: ERROR_CODES.SELF_DM,
          }),
        );
        break;
      }

      if (blockService.isBlocked(did, data.recipientDid)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Cannot message this user',
            errorCode: ERROR_CODES.BLOCKED_USER,
          }),
        );
        break;
      }

      {
        const recipientPresence = await service.getPresence(data.recipientDid);
        if (recipientPresence.status === 'offline') {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'User is offline',
              errorCode: ERROR_CODES.RECIPIENT_OFFLINE,
            }),
          );
          break;
        }
      }

      {
        const [did1, did2] = sortDids(did, data.recipientDid);
        const conversationId = computeConversationId(did, data.recipientDid);
        imRegistry.register(conversationId, did1, did2);
        dmSubs.subscribe(conversationId, ws);

        ws.send(
          JSON.stringify({
            type: 'dm_opened',
            data: {
              conversationId,
              recipientDid: data.recipientDid,
            },
          }),
        );
        void incDmsSent(sql);
      }
      break;
    }

    case 'dm_close': {
      // Check both ImRegistry (IM conversations) and DmService (video call conversations)
      const isImParticipant = imRegistry.isParticipant(data.conversationId, did);
      const isDmParticipant = !isImParticipant
        ? await dmService.isParticipant(data.conversationId, did)
        : false;

      if (!isImParticipant && !isDmParticipant) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Not a participant',
            errorCode: ERROR_CODES.NOT_PARTICIPANT,
          }),
        );
        break;
      }

      // Notify remaining subscribers before unsubscribing
      dmSubs.broadcast(
        data.conversationId,
        { type: 'dm_partner_left', data: { conversationId: data.conversationId } },
        ws,
      );

      dmSubs.unsubscribe(data.conversationId, ws);

      if (!dmSubs.hasSubscribers(data.conversationId)) {
        if (isImParticipant) {
          imRegistry.unregister(data.conversationId);
        } else {
          void dmService.cleanupIfEmpty(data.conversationId);
        }
      }
      break;
    }

    case 'dm_reject': {
      const isImParticipantReject = imRegistry.isParticipant(data.conversationId, did);
      if (!isImParticipantReject) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Not a participant',
            errorCode: ERROR_CODES.NOT_PARTICIPANT,
          }),
        );
        break;
      }

      // Notify the initiator that the IM was rejected
      dmSubs.broadcast(
        data.conversationId,
        { type: 'dm_rejected', data: { conversationId: data.conversationId } },
        ws,
      );

      dmSubs.unsubscribe(data.conversationId, ws);

      if (!dmSubs.hasSubscribers(data.conversationId)) {
        imRegistry.unregister(data.conversationId);
      }
      break;
    }

    case 'im_offer': {
      if (!imRegistry.isParticipant(data.conversationId, did)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Not a participant',
            errorCode: ERROR_CODES.NOT_PARTICIPANT,
          }),
        );
        break;
      }

      // Subscribe unsubscribed recipient sockets (same race condition fix as make_call)
      const recipientDid = imRegistry.getRecipientDid(data.conversationId, did);
      if (recipientDid) {
        const recipientSockets = userSockets.get(recipientDid);
        const convoSubscribers = dmSubs.getSubscribers(data.conversationId);
        for (const recipientWs of recipientSockets) {
          if (!convoSubscribers.has(recipientWs) && recipientWs.readyState === recipientWs.OPEN) {
            dmSubs.subscribe(data.conversationId, recipientWs);
          }
        }
      }

      dmSubs.broadcast(
        data.conversationId,
        {
          type: 'im_offer',
          data: {
            conversationId: data.conversationId,
            senderDid: did,
            offer: data.offer,
          },
        },
        ws,
      );

      // Push notification when recipient has no active WS connections
      if (notificationService && recipientDid) {
        const recipientSockets = userSockets.get(recipientDid);
        const hasActiveWs = [...recipientSockets].some((s) => s.readyState === s.OPEN);
        if (!hasActiveWs) {
          void notificationService.sendNotification(
            recipientDid,
            'New message',
            `@${handle} sent you a message`,
            {
              type: 'dm',
              senderDid: did,
            },
          );
        }
      }
      break;
    }

    case 'im_answer': {
      if (!imRegistry.isParticipant(data.conversationId, did)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Not a participant',
            errorCode: ERROR_CODES.NOT_PARTICIPANT,
          }),
        );
        break;
      }

      dmSubs.broadcast(
        data.conversationId,
        {
          type: 'im_answer',
          data: {
            conversationId: data.conversationId,
            answer: data.answer,
          },
        },
        ws,
      );
      break;
    }

    case 'im_ice_candidate': {
      if (!imRegistry.isParticipant(data.conversationId, did)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Not a participant',
            errorCode: ERROR_CODES.NOT_PARTICIPANT,
          }),
        );
        break;
      }

      dmSubs.broadcast(
        data.conversationId,
        {
          type: 'im_ice_candidate',
          data: {
            conversationId: data.conversationId,
            candidate: data.candidate,
          },
        },
        ws,
      );
      break;
    }

    case 'call_init': {
      if (data.recipientDid === did) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Cannot call yourself',
            errorCode: ERROR_CODES.SELF_DM,
          }),
        );
        break;
      }

      if (blockService.isBlocked(did, data.recipientDid)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Cannot call this user',
            errorCode: ERROR_CODES.BLOCKED_USER,
          }),
        );
        break;
      }

      {
        const recipientPresence = await service.getPresence(data.recipientDid);
        if (recipientPresence.status === 'offline') {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'User is offline',
              errorCode: ERROR_CODES.RECIPIENT_OFFLINE,
            }),
          );
          break;
        }
      }

      try {
        const { conversation } = await dmService.openConversation(did, data.recipientDid);
        callSubs.subscribe(conversation.id, ws);

        ws.send(
          JSON.stringify({
            type: 'call_ready',
            data: {
              conversationId: conversation.id,
              recipientDid: data.recipientDid,
            },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to init call';
        ws.send(
          JSON.stringify({ type: 'error', message: msg, errorCode: ERROR_CODES.SERVER_ERROR }),
        );
      }
      break;
    }

    case 'make_call': {
      const { conversationId, offer } = data;
      const isParticipant = await dmService.isParticipant(conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }

      // Rate limit: one pending call attempt per 30s per DID
      {
        const lastAttempt = pendingCallAttempts.get(did);
        if (lastAttempt && Date.now() - lastAttempt < CALL_COOLDOWN_MS) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Call already pending — wait before trying again',
              errorCode: ERROR_CODES.RATE_LIMITED,
            }),
          );
          break;
        }
        pendingCallAttempts.set(did, Date.now());
      }

      try {
        // Broadcast to sockets subscribed to this conversation
        callSubs.broadcast(
          data.conversationId,
          {
            type: 'incoming_call',
            data: { conversationId: conversationId, senderDid: did, offer: offer },
          },
          ws, // exclude sender
        );

        // Also notify recipient's sockets that don't have this convo open
        const recipientDid = await dmService.getRecipientDid(conversationId, did);
        if (recipientDid) {
          const recipientSockets = userSockets.get(recipientDid);
          const convoSubscribers = callSubs.getSubscribers(data.conversationId);

          for (const recipientWs of recipientSockets) {
            if (!convoSubscribers.has(recipientWs) && recipientWs.readyState === recipientWs.OPEN) {
              callSubs.subscribe(data.conversationId, recipientWs);
              recipientWs.send(
                JSON.stringify({
                  type: 'incoming_call',
                  data: { conversationId: conversationId, senderDid: did, offer: offer },
                }),
              );
            }
          }
          // Push notification when recipient has no active WS connections
          if (notificationService) {
            const hasActiveWs = [...recipientSockets].some((s) => s.readyState === s.OPEN);
            if (!hasActiveWs) {
              void notificationService.sendNotification(
                recipientDid,
                'Incoming call',
                `@${handle} is calling you`,
                {
                  type: 'call',
                  senderDid: did,
                },
              );
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to notify user of incoming call';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'reject_call': {
      const { conversationId } = data;
      const isParticipant = await dmService.isParticipant(conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }
      // Clear pending call state for both participants so they can call again later
      {
        const callerDid = await dmService.getRecipientDid(conversationId, did);
        if (callerDid) pendingCallAttempts.delete(callerDid);
        pendingCallAttempts.delete(did);
      }
      try {
        callSubs.broadcast(
          conversationId,
          {
            type: 'reject_call',
            data: { conversationId: conversationId },
          },
          ws, // exclude sender
        );
        callSubs.unsubscribe(conversationId, ws);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to notify user of rejected call';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'accept_call': {
      const { conversationId, answer } = data;
      const isParticipant = await dmService.isParticipant(conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }
      // Clear pending call state for both participants so they can call again later
      {
        const callerDid = await dmService.getRecipientDid(conversationId, did);
        if (callerDid) pendingCallAttempts.delete(callerDid);
        pendingCallAttempts.delete(did);
      }
      try {
        callSubs.broadcast(
          conversationId,
          {
            type: 'accept_call',
            data: { conversationId: conversationId, answer: answer },
          },
          ws, // exclude sender
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to notify user of accepted call';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'new_ice_candidate': {
      const { conversationId, candidate } = data;
      const isParticipant = await dmService.isParticipant(conversationId, did);
      if (!isParticipant) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not a participant' }));
        break;
      }

      log.debug({ conversationId }, 'Relaying ICE candidate');
      try {
        callSubs.broadcast(
          conversationId,
          {
            type: 'new_ice_candidate',
            data: { conversationId: conversationId, candidate: candidate },
          },
          ws, // exclude sender
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to relay ICE candidate';
        ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
      break;
    }

    case 'bot_dm_open': {
      botService?.handleOpen(ws, did, handle);
      break;
    }

    case 'bot_dm_send': {
      await botService?.handleMessage(ws, did, handle, data.text);
      break;
    }

    case 'bot_dm_close': {
      botService?.handleClose(ws);
      break;
    }

    case 'group_call_create_standalone': {
      if (!groupCallService) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Group calls are not enabled',
            errorCode: ERROR_CODES.SERVER_ERROR,
          }),
        );
        break;
      }

      try {
        const { call, token } = await groupCallService.createStandaloneCall(
          did,
          data.access ?? 'anyone',
          data.allowedDids,
        );

        ws.send(
          JSON.stringify({
            type: 'group_call_token',
            data: {
              callId: call.callId,
              token,
              url: groupCallService.livekitUrl,
              meetCode: call.meetCode,
            },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create meeting';
        log.error({ err }, 'group_call_create_standalone failed');
        ws.send(
          JSON.stringify({ type: 'error', message: msg, errorCode: ERROR_CODES.SERVER_ERROR }),
        );
      }
      break;
    }

    case 'group_call_join': {
      if (!groupCallService) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Group calls are not enabled',
            errorCode: ERROR_CODES.SERVER_ERROR,
          }),
        );
        break;
      }

      try {
        const call = groupCallService.getCall(data.callId);
        if (!call) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Call not found or already ended',
              errorCode: ERROR_CODES.INVALID_INPUT,
            }),
          );
          break;
        }

        const { call: joinedCall, token } = await groupCallService.joinCall(data.callId, did);

        // Send token to the joiner
        ws.send(
          JSON.stringify({
            type: 'group_call_token',
            data: {
              callId: data.callId,
              token,
              url: groupCallService.livekitUrl,
              meetCode: joinedCall.meetCode,
            },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to join group call';
        log.error({ err, callId: data.callId }, 'group_call_join failed');
        ws.send(
          JSON.stringify({ type: 'error', message: msg, errorCode: ERROR_CODES.SERVER_ERROR }),
        );
      }
      break;
    }

    case 'group_call_join_by_code': {
      if (!groupCallService) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Group calls are not enabled',
            errorCode: ERROR_CODES.SERVER_ERROR,
          }),
        );
        break;
      }

      try {
        const { call, token } = await groupCallService.joinByCode(data.meetCode, did);

        ws.send(
          JSON.stringify({
            type: 'group_call_token',
            data: {
              callId: call.callId,
              token,
              url: groupCallService.livekitUrl,
              meetCode: call.meetCode,
            },
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Meeting not found';
        ws.send(
          JSON.stringify({ type: 'error', message: msg, errorCode: ERROR_CODES.INVALID_INPUT }),
        );
      }
      break;
    }

    case 'group_call_leave': {
      if (!groupCallService) break;

      try {
        const callBefore = groupCallService.getCall(data.callId);
        if (!callBefore) break;
        await groupCallService.leaveCall(data.callId, did);
      } catch (err) {
        log.error({ err, callId: data.callId }, 'group_call_leave failed');
      }
      break;
    }

    case 'town_join': {
      townRoom.join(ws, did, data.x, data.y, data.dir);
      break;
    }

    case 'town_move': {
      townRoom.move(ws, data.x, data.y, data.dir);
      break;
    }

    case 'town_chat': {
      townRoom.chat(ws, data.text);
      break;
    }

    case 'town_leave': {
      townRoom.leave(ws);
      break;
    }
  }
}

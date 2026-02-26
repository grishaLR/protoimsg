import type { WebSocket } from 'ws';
import { ERROR_CODES, NSID } from '@protoimsg/shared';
import type { ValidatedClientMessage } from './validation.js';
import type { RoomSubscriptions } from './rooms.js';
import type { DmSubscriptions } from '../dms/subscriptions.js';
import type { UserSockets } from './server.js';
import type { CommunityWatchers } from './buddy-watchers.js';
import type { PresenceService } from '../presence/service.js';
import type { DmService } from '../dms/service.js';
import type { ImRegistry } from '../dms/registry.js';
import type { PresenceVisibility } from '@protoimsg/shared';
import type { Sql, JsonValue } from '../db/client.js';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';
import { checkUserAccess, checkMessageContent } from '../moderation/service.js';
import type { BlockService } from '../moderation/block-service.js';
import type { LabelerService } from '../moderation/labeler-service.js';
import { createLogger } from '../logger.js';
import { incDmsSent, incMessagesSent } from '../stats/queries.js';
import {
  getChannelsByRoom,
  ensureDefaultChannel,
  getChannelByUri,
  getChannelById,
} from '../channels/queries.js';
import { getRoomById } from '../rooms/queries.js';
import { insertMessage } from '../messages/queries.js';
import { isUserModerator, getRoomRoles } from '../moderation/queries.js';
import { syncCommunityMembers, upsertCommunityList } from '../community/queries.js';
import { computeConversationId, sortDids } from '../dms/queries.js';
import { resolveVisibleStatus } from '../presence/visibility.js';
import { resolvePdsEndpoint } from '../auth/verify.js';
import { messageRecordSchema } from '../firehose/record-schemas.js';
import { extractMentionedDids, extractRkey, isSlowModeViolation } from '../firehose/handlers.js';

/**
 * Per-user-per-room typing throttle. Prevents a single client from flooding
 * a room with typing indicators. Key: "roomId:did", value: last broadcast timestamp.
 */
const log = createLogger('ws');
const TYPING_THROTTLE_MS = 3000;
const typingThrottle = new Map<string, number>();

/**
 * Per-DID pending call tracker. Prevents a user from spamming make_call
 * before the previous call is accepted/rejected. Key: caller DID,
 * value: timestamp of the last make_call. Cleared on accept/reject.
 */
const CALL_COOLDOWN_MS = 30_000;
const pendingCallAttempts = new Map<string, number>();

/** Remove stale entries from the typing throttle map (older than 60s). */
export function pruneTypingThrottle(): void {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of typingThrottle) {
    if (ts < cutoff) typingThrottle.delete(key);
  }
}

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
  data: ValidatedClientMessage,
  roomSubs: RoomSubscriptions,
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
): Promise<void> {
  // Rate limit: per-socket for tab fairness, per-DID to cap total throughput
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

  switch (data.type) {
    case 'join_room': {
      const access = await checkUserAccess(sql, data.roomId, did, labelerService);
      if (!access.allowed) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: access.reason ?? 'Access denied',
            errorCode: ERROR_CODES.ACCESS_DENIED,
          }),
        );
        break;
      }

      roomSubs.subscribe(data.roomId, ws);
      await service.handleJoinRoom(did, data.roomId);
      const [members, initialChannelRows, roleRows] = await Promise.all([
        service.getRoomPresence(data.roomId),
        getChannelsByRoom(sql, data.roomId),
        getRoomRoles(sql, data.roomId),
      ]);

      // Self-healing: create default channel for rooms that predate the channels feature
      let channelRows = initialChannelRows;
      if (channelRows.length === 0) {
        const roomRow = await getRoomById(sql, data.roomId);
        if (roomRow) {
          const created = await ensureDefaultChannel(
            sql,
            data.roomId,
            roomRow.uri,
            roomRow.did,
            roomRow.created_at.toISOString(),
          );
          channelRows = [created];
        }
      }

      const channels = channelRows.map((ch) => ({
        id: ch.id,
        uri: ch.uri,
        did: ch.did,
        roomId: ch.room_id,
        name: ch.name,
        description: ch.description,
        position: ch.position,
        postPolicy: ch.post_policy,
        isDefault: ch.is_default,
        createdAt: ch.created_at.toISOString(),
      }));
      const roles = roleRows.map((r) => ({ did: r.subject_did, role: r.role }));
      ws.send(
        JSON.stringify({
          type: 'room_joined',
          roomId: data.roomId,
          members,
          channels,
          roles,
        }),
      );
      // Notify room of new member (include awayMessage if present).
      // Visibility is NOT applied here — rooms are public spaces. If you join,
      // you're visible. The visibleTo setting only governs buddy-list presence.
      const presence = await service.getPresence(did);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: presence.status, awayMessage: presence.awayMessage },
      });
      break;
    }

    case 'leave_room': {
      roomSubs.unsubscribe(data.roomId, ws);
      await service.handleLeaveRoom(did, data.roomId);
      roomSubs.broadcast(data.roomId, {
        type: 'presence',
        data: { did, status: 'offline' },
      });
      break;
    }

    case 'status_change': {
      const visibleTo = data.visibleTo as PresenceVisibility | undefined;
      await service.handleStatusChange(did, data.status, data.awayMessage, visibleTo);
      // Broadcast real status to all rooms — rooms are public spaces (like going
      // outside). Visibility only controls buddy-list presence, not room presence.
      const rooms = await service.getUserRooms(did);
      for (const roomId of rooms) {
        roomSubs.broadcast(roomId, {
          type: 'presence',
          data: { did, status: data.status, awayMessage: data.awayMessage },
        });
      }
      // Notify community watchers (visibility-aware)
      await communityWatchers.notify(did, data.status, data.awayMessage, visibleTo);
      break;
    }

    case 'request_community_presence': {
      const rawPresence = await service.getBulkPresence(data.dids);

      // Resolve visibility for all DIDs, then batch-query community/inner-circle
      const visibilityMap = new Map<string, PresenceVisibility>();
      const communityCheckDids: string[] = [];
      const innerCircleCheckDids: string[] = [];

      for (const p of rawPresence) {
        const v = await service.getVisibleTo(p.did);
        visibilityMap.set(p.did, v);
        if (v === 'community' || v === 'inner-circle') {
          communityCheckDids.push(p.did);
        }
        if (v === 'inner-circle') {
          innerCircleCheckDids.push(p.did);
        }
      }

      // Two batch queries instead of N individual ones
      const [communityMembers, innerCircleSets] = await Promise.all([
        communityCheckDids.length > 0
          ? batchCommunityCheck(sql, communityCheckDids, did)
          : new Set<string>(),
        innerCircleCheckDids.length > 0
          ? batchInnerCircleCheck(sql, innerCircleCheckDids, did)
          : new Set<string>(),
      ]);

      const presenceList = rawPresence.map((p) => {
        if (blockService.doesBlock(p.did, did)) {
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

    case 'channel_typing': {
      // Only broadcast if the user is actually in the room
      const roomMembers = roomSubs.getSubscribers(data.roomId);
      if (roomMembers.has(ws)) {
        // Per-user-per-channel throttle: one typing broadcast per TYPING_THROTTLE_MS
        const throttleKey = `${data.channelId}:${did}`;
        const now = Date.now();
        const lastTyping = typingThrottle.get(throttleKey);
        if (lastTyping && now - lastTyping < TYPING_THROTTLE_MS) break;
        typingThrottle.set(throttleKey, now);

        roomSubs.broadcast(
          data.roomId,
          {
            type: 'channel_typing',
            data: { roomId: data.roomId, channelId: data.channelId, did },
          },
          ws,
        );
      }
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
      // Same as dm_open but responds with call_ready instead of dm_opened.
      // VideoCallContext uses this to get a conversationId for signaling
      // without triggering a DM popover on the client.
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
              // Subscribe so subsequent signaling (ICE candidates, accept/reject)
              // reaches this socket without waiting for the client's call_init round-trip
              callSubs.subscribe(data.conversationId, recipientWs);
              recipientWs.send(
                JSON.stringify({
                  type: 'incoming_call',
                  data: { conversationId: conversationId, senderDid: did, offer: offer },
                }),
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

    case 'notify_record': {
      // Client notifies us after writing a record to their PDS.
      // We fetch + verify the record, then index and broadcast it.
      // This bypasses Jetstream for real-time delivery while Jetstream
      // stays as a backup for federation/catch-up.
      const { uri, cid } = data;

      // Parse AT-URI: at://did/collection/rkey
      const uriParts = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
      if (!uriParts) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid AT-URI',
            errorCode: ERROR_CODES.INVALID_MESSAGE_FORMAT,
          }),
        );
        break;
      }
      // Guaranteed by regex match above — 3 capture groups always present
      const uriDid = uriParts[1] as string;
      const collection = uriParts[2] as string;
      const rkey = uriParts[3] as string;

      // Security: URI DID must match authenticated DID
      if (uriDid !== did) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'DID mismatch',
            errorCode: ERROR_CODES.ACCESS_DENIED,
          }),
        );
        break;
      }

      // Only handle messages for now
      if (collection !== NSID.Message) {
        log.debug({ collection }, 'notify_record: unsupported collection — ignoring');
        break;
      }

      try {
        // Resolve PDS endpoint (SSRF-safe)
        const pdsUrl = await resolvePdsEndpoint(did);
        if (!pdsUrl) {
          log.warn({ did }, 'notify_record: could not resolve PDS');
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Could not resolve PDS',
              errorCode: ERROR_CODES.SERVER_ERROR,
            }),
          );
          break;
        }

        // Fetch record from PDS
        const getRecordUrl = `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
        const pdsRes = await fetch(getRecordUrl);
        if (!pdsRes.ok) {
          log.warn({ did, rkey, status: pdsRes.status }, 'notify_record: PDS fetch failed');
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Record not found on PDS',
              errorCode: ERROR_CODES.SERVER_ERROR,
            }),
          );
          break;
        }

        const pdsData = (await pdsRes.json()) as { uri: string; cid: string; value: unknown };

        // Verify CID matches (tamper protection)
        if (pdsData.cid !== cid) {
          log.warn(
            { did, rkey, expected: cid, actual: pdsData.cid },
            'notify_record: CID mismatch',
          );
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'CID mismatch',
              errorCode: ERROR_CODES.ACCESS_DENIED,
            }),
          );
          break;
        }

        // Validate record shape
        const parsed = messageRecordSchema.safeParse(pdsData.value);
        if (!parsed.success) {
          log.warn({ did, rkey, error: parsed.error.message }, 'notify_record: invalid record');
          break;
        }
        const record = parsed.data;

        // Content filter
        const filterResult = checkMessageContent(record.text);
        if (!filterResult.passed) {
          log.info({ did, reason: filterResult.reason ?? 'blocked' }, 'notify_record: filtered');
          break;
        }

        // Channel lookup (handles both AT-URIs and synthetic URIs)
        const channelUri = record.channel;
        const channel =
          (await getChannelByUri(sql, channelUri)) ??
          (await getChannelById(sql, extractRkey(channelUri)));
        if (!channel) {
          log.warn({ channelUri, did, rkey }, 'notify_record: unknown channel');
          break;
        }

        const roomId = channel.room_id;
        const channelId = channel.id;

        // Room must exist
        const room = await getRoomById(sql, roomId);
        if (!room) {
          log.warn({ roomId, did, rkey }, 'notify_record: unknown room');
          break;
        }

        // Access check — must pass the same gate as join_room
        const access = await checkUserAccess(sql, roomId, did, labelerService);
        if (!access.allowed) {
          log.info({ did, roomId, reason: access.reason }, 'notify_record: access denied');
          break;
        }

        // Post policy enforcement
        if (channel.post_policy !== 'everyone') {
          const isOwner = room.did === did;
          const isMod = !isOwner && (await isUserModerator(sql, roomId, did));
          if (channel.post_policy === 'owner' && !isOwner) {
            log.info({ did, channelId }, 'notify_record: blocked by post_policy=owner');
            break;
          }
          if (channel.post_policy === 'moderators' && !isOwner && !isMod) {
            log.info({ did, channelId }, 'notify_record: blocked by post_policy=moderators');
            break;
          }
        }

        // Slow mode enforcement (shared tracker with firehose handler)
        const slowModeViolation = isSlowModeViolation(roomId, did, room.slow_mode_seconds);

        // Index message (ON CONFLICT = idempotent)
        await insertMessage(sql, {
          id: rkey,
          uri,
          did,
          cid,
          roomId,
          channelId,
          text: record.text,
          replyRoot: record.reply?.root,
          replyParent: record.reply?.parent,
          facets: record.facets,
          embed: record.embed,
          createdAt: record.createdAt,
        });
        void incMessagesSent(sql);

        // Upsert into generic records table (ON CONFLICT = idempotent)
        await sql`
          INSERT INTO records (uri, cid, did, collection, json, indexed_at)
          VALUES (${uri}, ${cid}, ${did}, ${collection}, ${sql.json(pdsData.value as JsonValue)}, NOW())
          ON CONFLICT (uri) DO UPDATE SET
            cid = EXCLUDED.cid,
            json = EXCLUDED.json,
            indexed_at = NOW()
        `;

        if (slowModeViolation) {
          log.info({ did, roomId }, 'notify_record: slow mode violation — skipping broadcast');
          break;
        }

        // Broadcast to room subscribers
        roomSubs.broadcast(roomId, {
          type: 'message',
          data: {
            id: rkey,
            uri,
            did,
            roomId,
            channelId,
            text: record.text,
            reply: record.reply,
            facets: record.facets,
            embed: record.embed,
            createdAt: record.createdAt,
          },
        });

        // Mention notifications for users NOT in this room
        if (record.facets) {
          const mentionedDids = extractMentionedDids(record.facets);
          const preview = record.text.slice(0, 100);
          for (const mentionedDid of mentionedDids) {
            if (mentionedDid === did) continue;
            // Check if user is subscribed to this room
            const mentionedSockets = userSockets.get(mentionedDid);
            const roomSubscribers = roomSubs.getSubscribers(roomId);
            let inRoom = false;
            for (const mws of mentionedSockets) {
              if (roomSubscribers.has(mws)) {
                inRoom = true;
                break;
              }
            }
            if (inRoom) continue;

            const payload = JSON.stringify({
              type: 'mention_notification',
              data: {
                roomId,
                roomName: room.name,
                channelId,
                channelName: channel.name,
                senderDid: did,
                messageText: preview,
                messageUri: uri,
                createdAt: record.createdAt,
              },
            });
            for (const mws of userSockets.get(mentionedDid)) {
              if (mws.readyState === mws.OPEN) mws.send(payload);
            }
          }
        }

        log.info({ did, rkey, roomId }, 'notify_record: message indexed and broadcast');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to process record notification';
        log.error({ err, did, uri }, 'notify_record: error');
        ws.send(
          JSON.stringify({ type: 'error', message: msg, errorCode: ERROR_CODES.SERVER_ERROR }),
        );
      }
      break;
    }
  }
}

/**
 * Batch check which of `ownerDids` consider `queryDid` a community member.
 * Returns a Set of owner DIDs that include queryDid in their community.
 */
async function batchCommunityCheck(
  sql: Sql,
  ownerDids: string[],
  queryDid: string,
): Promise<Set<string>> {
  if (ownerDids.length === 0) return new Set();
  const rows = await sql<Array<{ owner_did: string }>>`
    SELECT owner_did FROM community_members
    WHERE owner_did = ANY(${ownerDids}) AND member_did = ${queryDid}
  `;
  return new Set(rows.map((r) => r.owner_did));
}

/**
 * Batch check which of `ownerDids` consider `queryDid` in their inner circle.
 * Scans the JSONB `groups` column for inner-circle groups containing queryDid.
 * Returns a Set of owner DIDs whose inner circle includes queryDid.
 */
async function batchInnerCircleCheck(
  sql: Sql,
  ownerDids: string[],
  queryDid: string,
): Promise<Set<string>> {
  if (ownerDids.length === 0) return new Set();
  const rows = await sql<Array<{ did: string }>>`
    SELECT DISTINCT community_lists.did
    FROM community_lists,
         jsonb_array_elements(groups) AS g
    WHERE community_lists.did = ANY(${ownerDids})
      AND jsonb_typeof(groups) = 'array'
      AND (g->>'isInnerCircle')::boolean = true
      AND jsonb_typeof(g->'members') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(g->'members') AS m
        WHERE m->>'did' = ${queryDid}
      )
  `;
  return new Set(rows.map((r) => r.did));
}

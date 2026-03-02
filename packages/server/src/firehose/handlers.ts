import { NSID } from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import { createRoom, deleteRoom } from '../rooms/queries.js';
import {
  createChannel,
  deleteChannel,
  getChannelById,
  getChannelByUri,
  ensureDefaultChannel,
} from '../channels/queries.js';
import { insertMessage, deleteMessage } from '../messages/queries.js';
import {
  insertPoll,
  deletePoll,
  getPollById,
  insertVote,
  deleteVote,
  getVoteTallies,
  getTotalVoters,
} from '../polls/queries.js';
import {
  recordModAction,
  deleteModActionByUri,
  isUserBanned,
  isUserModerator,
  upsertRoomRole,
  deleteRoomRoleByUri,
} from '../moderation/queries.js';
import { upsertCommunityList, syncCommunityMembers } from '../community/queries.js';
import { getRoomById } from '../rooms/queries.js';
import { checkMessageContent } from '../moderation/service.js';
import type { WsServer } from '../ws/server.js';
import {
  roomRecordSchema,
  channelRecordSchema,
  messageRecordSchema,
  banRecordSchema,
  roleRecordSchema,
  communityRecordSchema,
  allowlistRecordSchema,
  pollRecordSchema,
  voteRecordSchema,
} from './record-schemas.js';
import type { LabelerService } from '../moderation/labeler-service.js';
import { createLogger } from '../logger.js';
import { incMessagesSent, incRoomsCreated } from '../stats/queries.js';

const log = createLogger('firehose');

/** Extract mentioned DIDs from rich text facets. */
export function extractMentionedDids(facets: unknown[]): string[] {
  const dids = new Set<string>();
  for (const facet of facets) {
    const f = facet as { features?: Array<{ $type?: string; did?: string }> };
    if (!f.features) continue;
    for (const feat of f.features) {
      if (
        (feat.$type === 'app.protoimsg.chat.message#mention' ||
          feat.$type === 'app.bsky.richtext.facet#mention') &&
        feat.did
      ) {
        dids.add(feat.did);
      }
    }
  }
  return [...dids];
}

export interface FirehoseEvent {
  did: string;
  collection: string;
  rkey: string;
  record: unknown; // null for deletes
  uri: string;
  cid: string | null;
  operation: 'create' | 'update' | 'delete';
}

/** Tracks last message timestamp per user per room for slow mode enforcement. */
const slowModeTracker = new Map<string, number>();

/** Remove stale entries from the slow mode tracker (older than 10 minutes). */
export function pruneSlowModeTracker(): void {
  const cutoff = Date.now() - 600_000;
  for (const [key, ts] of slowModeTracker) {
    if (ts < cutoff) slowModeTracker.delete(key);
  }
}

export function isSlowModeViolation(roomId: string, did: string, slowModeSeconds: number): boolean {
  if (slowModeSeconds <= 0) return false;
  const key = `${roomId}:${did}`;
  const last = slowModeTracker.get(key);
  const now = Date.now();
  if (last && now - last < slowModeSeconds * 1000) return true;
  slowModeTracker.set(key, now);
  return false;
}

export function createHandlers(db: Sql, wss: WsServer, labelerService: LabelerService) {
  const handlers: Record<string, (event: FirehoseEvent) => Promise<void>> = {
    [NSID.Room]: async (event) => {
      if (event.operation === 'delete') {
        await deleteRoom(db, event.uri);
        log.info({ rkey: event.rkey }, 'Room deleted');
        return;
      }

      const parsed = roomRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid room record',
        );
        return;
      }
      const record = parsed.data;
      await createRoom(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        name: record.name,
        topic: record.topic,
        description: record.description,
        purpose: record.purpose,
        category: record.category?.toLowerCase().trim() || undefined,
        visibility: record.settings?.visibility ?? 'public',
        minAccountAgeDays: record.settings?.minAccountAgeDays ?? 0,
        slowModeSeconds: record.settings?.slowModeSeconds ?? 0,
        allowlistEnabled: record.settings?.allowlistEnabled ?? false,
        createdAt: record.createdAt,
      });

      // Auto-create "general" default channel for new rooms
      await ensureDefaultChannel(db, event.rkey, event.uri, event.did, record.createdAt);
      void incRoomsCreated(db);

      log.info({ rkey: event.rkey, name: record.name }, 'Room indexed');
    },

    [NSID.Channel]: async (event) => {
      if (event.operation === 'delete') {
        // Look up the channel to get roomId for broadcast before deleting
        const channel = await getChannelById(db, event.rkey);
        if (channel) {
          await deleteChannel(db, event.uri);
          wss.broadcastToRoom(channel.room_id, {
            type: 'channel_deleted',
            data: { channelId: channel.id, roomId: channel.room_id },
          });
        }
        log.info({ rkey: event.rkey }, 'Channel deleted');
        return;
      }

      const parsed = channelRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid channel record',
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Room must exist
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn({ roomId, did: event.did }, 'Channel for unknown room — skipping');
        return;
      }

      // Auth: only room creator can create channels
      if (room.did !== event.did) {
        log.warn({ did: event.did, roomId }, 'Unauthorized channel creation — skipping');
        return;
      }

      await createChannel(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        roomId,
        name: record.name,
        description: record.description,
        position: record.position,
        postPolicy: record.postPolicy,
        createdAt: record.createdAt,
      });

      wss.broadcastToRoom(roomId, {
        type: 'channel_created',
        data: {
          id: event.rkey,
          uri: event.uri,
          did: event.did,
          roomId,
          name: record.name,
          description: record.description ?? null,
          position: record.position ?? 0,
          postPolicy: record.postPolicy ?? 'everyone',
          isDefault: false,
          createdAt: record.createdAt,
        },
      });

      log.info({ rkey: event.rkey, roomId, name: record.name }, 'Channel indexed');
    },

    [NSID.Message]: async (event) => {
      if (event.operation === 'delete') {
        await deleteMessage(db, event.uri);
        log.info({ rkey: event.rkey }, 'Message deleted');
        return;
      }

      const parsed = messageRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid message record',
        );
        return;
      }
      const record = parsed.data;
      const channelUri = record.channel;

      // Content filter — skip indexing if blocked
      const filterResult = checkMessageContent(record.text);
      if (!filterResult.passed) {
        log.info({ did: event.did, reason: filterResult.reason ?? 'blocked' }, 'Message filtered');
        return;
      }

      // Channel must exist (FK constraint) — look up by URI since synthetic
      // channels use non-AT-URI formats (e.g. "synthetic://default-channel/{roomId}")
      const channel =
        (await getChannelByUri(db, channelUri)) ??
        (await getChannelById(db, extractRkey(channelUri)));
      if (!channel) {
        log.warn(
          { channelUri, did: event.did, rkey: event.rkey },
          'Message for unknown channel — skipping',
        );
        return;
      }

      const roomId = channel.room_id;
      const channelId = channel.id;

      // Room must exist
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn(
          { roomId, did: event.did, rkey: event.rkey },
          'Message for unknown room — skipping',
        );
        return;
      }

      // Post policy enforcement
      if (channel.post_policy !== 'everyone') {
        const isOwner = room.did === event.did;
        const isMod = !isOwner && (await isUserModerator(db, roomId, event.did));
        if (channel.post_policy === 'owner' && !isOwner) {
          log.info({ did: event.did, channelId }, 'Message blocked by post_policy=owner');
          return;
        }
        if (channel.post_policy === 'moderators' && !isOwner && !isMod) {
          log.info({ did: event.did, channelId }, 'Message blocked by post_policy=moderators');
          return;
        }
      }

      // Slow mode — skip broadcast if posting too fast (still index)
      const slowModeViolation = isSlowModeViolation(roomId, event.did, room.slow_mode_seconds);

      await insertMessage(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        roomId,
        channelId,
        text: record.text,
        replyRoot: record.reply?.root,
        replyParent: record.reply?.parent,
        facets: record.facets,
        embed: record.embed,
        createdAt: record.createdAt,
      });
      void incMessagesSent(db);

      // Ban check AFTER insert — if a ban and message arrive in the same
      // Jetstream batch, the ban handler may still be mid-index when the
      // pre-insert check runs. Re-checking here gives the ban time to land.
      const banned = await isUserBanned(db, roomId, event.did);
      const restricted = await labelerService.shouldRestrict(event.did);

      if (!banned && !restricted && !slowModeViolation) {
        wss.broadcastToRoom(roomId, {
          type: 'message',
          data: {
            id: event.rkey,
            uri: event.uri,
            did: event.did,
            roomId,
            channelId,
            text: record.text,
            reply: record.reply,
            facets: record.facets,
            embed: record.embed,
            createdAt: record.createdAt,
          },
        });

        // Send mention notifications to users NOT currently in this room
        if (record.facets) {
          const mentionedDids = extractMentionedDids(record.facets);
          const preview = record.text.slice(0, 100);
          for (const mentionedDid of mentionedDids) {
            if (mentionedDid === event.did) continue;
            if (wss.isSubscribedToRoom(mentionedDid, roomId)) continue;
            wss.sendToUser(mentionedDid, {
              type: 'mention_notification',
              data: {
                roomId,
                roomName: room.name,
                channelId,
                channelName: channel.name,
                senderDid: event.did,
                messageText: preview,
                messageUri: event.uri,
                createdAt: record.createdAt,
              },
            });
          }
        }
      }
    },

    [NSID.Ban]: async (event) => {
      if (event.operation === 'delete') {
        // Look up ban before deleting so we can broadcast the unban
        const [existing] = await db<{ room_id: string; subject_did: string }[]>`
          SELECT room_id, subject_did FROM mod_actions WHERE uri = ${event.uri} AND action = 'ban'
        `;
        await deleteModActionByUri(db, event.uri);
        if (existing) {
          wss.broadcastToRoom(existing.room_id, {
            type: 'room_ban',
            data: {
              roomId: existing.room_id,
              subjectDid: existing.subject_did,
              actorDid: event.did,
              action: 'unban',
            },
          });
        }
        log.info({ rkey: event.rkey }, 'Ban deleted');
        return;
      }

      const parsed = banRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid ban record',
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Auth: only room creator or moderator can issue bans
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn({ roomId, did: event.did }, 'Ban for unknown room');
        return;
      }
      if (room.did !== event.did && !(await isUserModerator(db, roomId, event.did))) {
        log.warn({ did: event.did, roomId }, 'Unauthorized ban — skipping');
        return;
      }

      // Cannot ban the room owner
      if (record.subject === room.did) {
        log.warn({ did: event.did, roomId }, 'Cannot ban room owner — skipping');
        return;
      }

      await recordModAction(db, {
        uri: event.uri,
        roomId,
        actorDid: event.did,
        subjectDid: record.subject,
        action: 'ban',
        reason: record.reason,
      });

      wss.broadcastToRoom(roomId, {
        type: 'room_ban',
        data: {
          roomId,
          subjectDid: record.subject,
          actorDid: event.did,
          action: 'ban',
        },
      });

      log.info({ subject: record.subject, roomId }, 'Ban indexed');
    },

    [NSID.Role]: async (event) => {
      if (event.operation === 'delete') {
        // Look up role before deleting so we can broadcast the removal
        const [existing] = await db<{ room_id: string; subject_did: string; role: string }[]>`
          SELECT room_id, subject_did, role FROM room_roles WHERE uri = ${event.uri}
        `;
        await deleteRoomRoleByUri(db, event.uri);
        if (existing) {
          wss.broadcastToRoom(existing.room_id, {
            type: 'room_role_update',
            data: {
              roomId: existing.room_id,
              subjectDid: existing.subject_did,
              role: existing.role as 'owner' | 'moderator',
              action: 'remove',
            },
          });
        }
        log.info({ rkey: event.rkey }, 'Role deleted');
        return;
      }

      const parsed = roleRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid role record',
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Validate role is a known value
      if (record.role !== 'moderator' && record.role !== 'owner') {
        log.warn({ did: event.did, roomId, role: record.role }, 'Unknown role value — skipping');
        return;
      }

      // Auth: only room creator can assign roles
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn({ roomId, did: event.did }, 'Role for unknown room');
        return;
      }
      if (room.did !== event.did) {
        log.warn({ did: event.did, roomId }, 'Unauthorized role assignment — skipping');
        return;
      }

      await upsertRoomRole(db, {
        roomId,
        subjectDid: record.subject,
        role: record.role,
        grantedBy: event.did,
        uri: event.uri,
        cid: event.cid,
        createdAt: record.createdAt,
      });

      wss.broadcastToRoom(roomId, {
        type: 'room_role_update',
        data: {
          roomId,
          subjectDid: record.subject,
          role: record.role,
          action: 'add',
        },
      });

      log.info({ subject: record.subject, role: record.role, roomId }, 'Role indexed');
    },

    [NSID.Community]: async (event) => {
      if (event.operation === 'delete') {
        // Community record deleted — clear the member list for this DID
        await syncCommunityMembers(db, event.did, []);
        log.info({ did: event.did }, 'Community list cleared');
        return;
      }

      const parsed = communityRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn({ did: event.did, error: parsed.error.message }, 'Invalid community record');
        return;
      }
      const record = parsed.data;
      await upsertCommunityList(db, { did: event.did, groups: record.groups });

      // Flatten all members across groups for denormalized lookup table
      const allMembers: Array<{ did: string; addedAt: string }> = [];
      for (const group of record.groups) {
        for (const member of group.members) {
          allMembers.push({ did: member.did, addedAt: member.addedAt });
        }
      }
      await syncCommunityMembers(db, event.did, allMembers);
      log.info({ did: event.did, memberCount: allMembers.length }, 'Community list indexed');
    },

    [NSID.Allowlist]: async (event) => {
      if (event.operation === 'delete') {
        await db`DELETE FROM room_allowlist WHERE uri = ${event.uri}`;
        log.info({ rkey: event.rkey }, 'Allowlist entry deleted');
        return;
      }

      const parsed = allowlistRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid allowlist record',
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Auth: only room creator or moderator can manage allowlist
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn({ roomId, did: event.did }, 'Allowlist for unknown room');
        return;
      }
      if (room.did !== event.did && !(await isUserModerator(db, roomId, event.did))) {
        log.warn({ did: event.did, roomId }, 'Unauthorized allowlist entry — skipping');
        return;
      }

      await db`
        INSERT INTO room_allowlist (id, room_id, subject_did, uri, cid, created_at)
        VALUES (${event.rkey}, ${roomId}, ${record.subject}, ${event.uri}, ${event.cid}, ${record.createdAt})
        ON CONFLICT (id) DO UPDATE SET
          cid = EXCLUDED.cid,
          indexed_at = NOW()
      `;
      log.info({ subject: record.subject, roomId }, 'Allowlist entry indexed');
    },

    [NSID.Poll]: async (event) => {
      if (event.operation === 'delete') {
        await deletePoll(db, event.uri);
        log.info({ rkey: event.rkey }, 'Poll deleted');
        return;
      }

      const parsed = pollRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid poll record',
        );
        return;
      }
      const record = parsed.data;
      const channelUri = record.channel;

      const channel =
        (await getChannelByUri(db, channelUri)) ??
        (await getChannelById(db, extractRkey(channelUri)));
      if (!channel) {
        log.warn(
          { channelUri, did: event.did, rkey: event.rkey },
          'Poll for unknown channel — skipping',
        );
        return;
      }

      const roomId = channel.room_id;
      const channelId = channel.id;

      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn({ roomId, did: event.did, rkey: event.rkey }, 'Poll for unknown room — skipping');
        return;
      }

      const banned = await isUserBanned(db, roomId, event.did);
      if (banned) {
        log.info({ did: event.did, roomId }, 'Poll from banned user — skipping broadcast');
        return;
      }

      await insertPoll(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        roomId,
        channelId,
        question: record.question,
        options: record.options,
        allowMultiple: record.allowMultiple ?? false,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      });

      wss.broadcastToRoom(roomId, {
        type: 'poll_created',
        data: {
          id: event.rkey,
          uri: event.uri,
          did: event.did,
          roomId,
          channelId,
          question: record.question,
          options: record.options,
          allowMultiple: record.allowMultiple ?? false,
          expiresAt: record.expiresAt,
          createdAt: record.createdAt,
        },
      });

      log.info({ rkey: event.rkey, roomId, question: record.question }, 'Poll indexed');
    },

    [NSID.Vote]: async (event) => {
      if (event.operation === 'delete') {
        await deleteVote(db, event.uri);
        log.info({ rkey: event.rkey }, 'Vote deleted');
        return;
      }

      const parsed = voteRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn(
          { did: event.did, rkey: event.rkey, error: parsed.error.message },
          'Invalid vote record',
        );
        return;
      }
      const record = parsed.data;
      const pollId = extractRkey(record.poll);

      const poll = await getPollById(db, pollId);
      if (!poll) {
        log.warn({ pollId, did: event.did }, 'Vote for unknown poll — skipping');
        return;
      }

      // Validate selected options are in range
      const maxIdx = poll.options.length - 1;
      if (record.selectedOptions.some((i) => i > maxIdx)) {
        log.warn({ did: event.did, pollId }, 'Vote option index out of range — skipping');
        return;
      }

      // Validate single-select polls only get one option
      if (!poll.allow_multiple && record.selectedOptions.length > 1) {
        log.warn({ did: event.did, pollId }, 'Multiple options on single-select poll — skipping');
        return;
      }

      await insertVote(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        pollId,
        selectedOptions: record.selectedOptions,
        createdAt: record.createdAt,
      });

      // Fetch updated tallies for broadcast
      const [tallies, totalVoters] = await Promise.all([
        getVoteTallies(db, pollId),
        getTotalVoters(db, pollId),
      ]);

      wss.broadcastToRoom(poll.room_id, {
        type: 'poll_vote',
        data: {
          pollId,
          roomId: poll.room_id,
          channelId: poll.channel_id,
          tallies,
          totalVoters,
          voterDid: event.did,
          selectedOptions: record.selectedOptions,
        },
      });

      log.info({ pollId, did: event.did }, 'Vote indexed');
    },
  };

  return handlers;
}

/** Extract the rkey (last path segment) from an AT-URI or synthetic URI. */
export function extractRkey(uri: string): string {
  const segments = uri.split('/');
  return segments[segments.length - 1] ?? uri;
}

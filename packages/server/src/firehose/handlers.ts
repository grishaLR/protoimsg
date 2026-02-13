import { NSID } from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import { createRoom, deleteRoom } from '../rooms/queries.js';
import { insertMessage, deleteMessage } from '../messages/queries.js';
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
  messageRecordSchema,
  banRecordSchema,
  roleRecordSchema,
  communityRecordSchema,
  allowlistRecordSchema,
  presenceRecordSchema,
} from './record-schemas.js';
import type { PresenceService } from '../presence/service.js';
import { createLogger } from '../logger.js';

const log = createLogger('firehose');

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

function isSlowModeViolation(roomId: string, did: string, slowModeSeconds: number): boolean {
  if (slowModeSeconds <= 0) return false;
  const key = `${roomId}:${did}`;
  const last = slowModeTracker.get(key);
  const now = Date.now();
  if (last && now - last < slowModeSeconds * 1000) return true;
  slowModeTracker.set(key, now);
  return false;
}

export function createHandlers(db: Sql, wss: WsServer, presenceService: PresenceService) {
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
        visibility: record.settings?.visibility ?? 'public',
        minAccountAgeDays: record.settings?.minAccountAgeDays ?? 0,
        slowModeSeconds: record.settings?.slowModeSeconds ?? 0,
        allowlistEnabled: record.settings?.allowlistEnabled ?? false,
        createdAt: record.createdAt,
      });
      log.info({ rkey: event.rkey, name: record.name }, 'Room indexed');
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
      const roomId = extractRkey(record.room);

      // Content filter — skip indexing if blocked
      const filterResult = checkMessageContent(record.text);
      if (!filterResult.passed) {
        log.info({ did: event.did, reason: filterResult.reason ?? 'blocked' }, 'Message filtered');
        return;
      }

      // Room must exist before we can index a message (FK constraint).
      // Jetstream doesn't guarantee ordering across collections, so a message
      // can arrive before its room is indexed. Skip it — the PDS still has it.
      const room = await getRoomById(db, roomId);
      if (!room) {
        log.warn(
          { roomId, did: event.did, rkey: event.rkey },
          'Message for unknown room — skipping',
        );
        return;
      }

      // Slow mode — skip broadcast if posting too fast (still index)
      const slowModeViolation = isSlowModeViolation(roomId, event.did, room.slow_mode_seconds);

      await insertMessage(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        cid: event.cid,
        roomId,
        text: record.text,
        replyRoot: record.reply?.root,
        replyParent: record.reply?.parent,
        facets: record.facets,
        embed: record.embed,
        createdAt: record.createdAt,
      });

      // Ban check AFTER insert — if a ban and message arrive in the same
      // Jetstream batch, the ban handler may still be mid-index when the
      // pre-insert check runs. Re-checking here gives the ban time to land.
      const banned = await isUserBanned(db, roomId, event.did);

      if (!banned && !slowModeViolation) {
        wss.broadcastToRoom(roomId, {
          type: 'message',
          data: {
            id: event.rkey,
            uri: event.uri,
            did: event.did,
            roomId,
            text: record.text,
            reply: record.reply,
            facets: record.facets,
            embed: record.embed,
            createdAt: record.createdAt,
          },
        });
      }
    },

    [NSID.Ban]: async (event) => {
      if (event.operation === 'delete') {
        await deleteModActionByUri(db, event.uri);
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

      await recordModAction(db, {
        uri: event.uri,
        roomId,
        actorDid: event.did,
        subjectDid: record.subject,
        action: 'ban',
        reason: record.reason,
      });
      log.info({ subject: record.subject, roomId }, 'Ban indexed');
    },

    [NSID.Role]: async (event) => {
      if (event.operation === 'delete') {
        await deleteRoomRoleByUri(db, event.uri);
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

    [NSID.Presence]: async (event) => {
      if (event.operation === 'delete') {
        // Presence record deleted — clear persisted prefs
        await db`DELETE FROM user_presence WHERE did = ${event.did}`;
        log.info({ did: event.did }, 'Presence record deleted');
        return;
      }

      const parsed = presenceRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        log.warn({ did: event.did, error: parsed.error.message }, 'Invalid presence record');
        return;
      }
      const record = parsed.data;

      // Persist to DB so visibility prefs survive server restarts
      await db`
        INSERT INTO user_presence (did, status, visible_to, away_message, updated_at, indexed_at)
        VALUES (${event.did}, ${record.status}, ${record.visibleTo}, ${record.awayMessage ?? null}, ${record.updatedAt}, NOW())
        ON CONFLICT (did) DO UPDATE SET
          status = EXCLUDED.status,
          visible_to = EXCLUDED.visible_to,
          away_message = EXCLUDED.away_message,
          updated_at = EXCLUDED.updated_at,
          indexed_at = NOW()
      `;

      // Hydrate tracker if user is currently connected
      await presenceService.handleStatusChange(
        event.did,
        record.status as 'online' | 'away' | 'idle' | 'offline' | 'invisible',
        record.awayMessage,
        record.visibleTo as 'everyone' | 'community' | 'inner-circle' | 'no-one',
      );

      log.info(
        { did: event.did, status: record.status, visibleTo: record.visibleTo },
        'Presence indexed',
      );
    },
  };

  return handlers;
}

/** Extract the rkey from an AT-URI: at://did/collection/rkey → rkey */
function extractRkey(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

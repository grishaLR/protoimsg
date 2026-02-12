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
} from './record-schemas.js';

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

export function createHandlers(db: Sql, wss: WsServer) {
  const handlers: Record<string, (event: FirehoseEvent) => Promise<void>> = {
    [NSID.Room]: async (event) => {
      if (event.operation === 'delete') {
        await deleteRoom(db, event.uri);
        console.info(`Room deleted: ${event.rkey}`);
        return;
      }

      const parsed = roomRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(
          `Invalid room record from ${event.did} (${event.rkey}):`,
          parsed.error.message,
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
      console.info(`Indexed room: ${record.name} (${event.rkey})`);
    },

    [NSID.Message]: async (event) => {
      if (event.operation === 'delete') {
        await deleteMessage(db, event.uri);
        console.info(`Message deleted: ${event.rkey}`);
        return;
      }

      const parsed = messageRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(
          `Invalid message record from ${event.did} (${event.rkey}):`,
          parsed.error.message,
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Content filter — skip indexing if blocked
      const filterResult = checkMessageContent(record.text);
      if (!filterResult.passed) {
        console.info(`Message filtered from ${event.did}: ${filterResult.reason ?? 'blocked'}`);
        return;
      }

      // Ban check — skip broadcast if banned (still index, record exists on atproto)
      const banned = await isUserBanned(db, roomId, event.did);

      // Slow mode — skip broadcast if posting too fast (still index)
      const room = await getRoomById(db, roomId);
      const slowModeViolation = room
        ? isSlowModeViolation(roomId, event.did, room.slow_mode_seconds)
        : false;

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
        console.info(`Ban deleted: ${event.rkey}`);
        return;
      }

      const parsed = banRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(`Invalid ban record from ${event.did} (${event.rkey}):`, parsed.error.message);
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Auth: only room creator or moderator can issue bans
      const room = await getRoomById(db, roomId);
      if (!room) {
        console.warn(`Ban for unknown room ${roomId} from ${event.did}`);
        return;
      }
      if (room.did !== event.did && !(await isUserModerator(db, roomId, event.did))) {
        console.warn(`Unauthorized ban from ${event.did} in room ${roomId} — skipping`);
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
      console.info(`Ban indexed: ${record.subject} from room ${roomId}`);
    },

    [NSID.Role]: async (event) => {
      if (event.operation === 'delete') {
        await deleteRoomRoleByUri(db, event.uri);
        console.info(`Role deleted: ${event.rkey}`);
        return;
      }

      const parsed = roleRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(
          `Invalid role record from ${event.did} (${event.rkey}):`,
          parsed.error.message,
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Auth: only room creator can assign roles
      const room = await getRoomById(db, roomId);
      if (!room) {
        console.warn(`Role for unknown room ${roomId} from ${event.did}`);
        return;
      }
      if (room.did !== event.did) {
        console.warn(`Unauthorized role assignment from ${event.did} in room ${roomId} — skipping`);
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
      console.info(`Role indexed: ${record.subject} as ${record.role} in ${roomId}`);
    },

    [NSID.Community]: async (event) => {
      if (event.operation === 'delete') {
        // Community record deleted — clear the member list for this DID
        await syncCommunityMembers(db, event.did, []);
        console.info(`Community list cleared for ${event.did}`);
        return;
      }

      const parsed = communityRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(`Invalid community record from ${event.did}:`, parsed.error.message);
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
      console.info(`Community list indexed for ${event.did}: ${allMembers.length} members`);
    },

    [NSID.Allowlist]: async (event) => {
      if (event.operation === 'delete') {
        await db`DELETE FROM room_allowlist WHERE uri = ${event.uri}`;
        console.info(`Allowlist entry deleted: ${event.rkey}`);
        return;
      }

      const parsed = allowlistRecordSchema.safeParse(event.record);
      if (!parsed.success) {
        console.warn(
          `Invalid allowlist record from ${event.did} (${event.rkey}):`,
          parsed.error.message,
        );
        return;
      }
      const record = parsed.data;
      const roomId = extractRkey(record.room);

      // Auth: only room creator or moderator can manage allowlist
      const room = await getRoomById(db, roomId);
      if (!room) {
        console.warn(`Allowlist for unknown room ${roomId} from ${event.did}`);
        return;
      }
      if (room.did !== event.did && !(await isUserModerator(db, roomId, event.did))) {
        console.warn(`Unauthorized allowlist entry from ${event.did} in room ${roomId} — skipping`);
        return;
      }

      await db`
        INSERT INTO room_allowlist (id, room_id, subject_did, uri, cid, created_at)
        VALUES (${event.rkey}, ${roomId}, ${record.subject}, ${event.uri}, ${event.cid}, ${record.createdAt})
        ON CONFLICT (id) DO UPDATE SET
          cid = EXCLUDED.cid,
          indexed_at = NOW()
      `;
      console.info(`Allowlist entry indexed: ${record.subject} in room ${roomId}`);
    },

    [NSID.Presence]: (event) => {
      // Log-only for MVP — in-memory tracker handles ephemeral presence state
      console.info(`Presence record from ${event.did} (rkey: ${event.rkey})`);
      return Promise.resolve();
    },
  };

  return handlers;
}

/** Extract the rkey from an AT-URI: at://did/collection/rkey → rkey */
function extractRkey(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

import { NSID } from '@chatmosphere/shared';
import type {
  RoomRecord,
  MessageRecord,
  BanRecord,
  BuddyListRecord,
  RoleRecord,
} from '@chatmosphere/lexicon';
import type { Sql } from '../db/client.js';
import { createRoom } from '../rooms/queries.js';
import { insertMessage } from '../messages/queries.js';
import { recordModAction, isUserBanned, upsertRoomRole } from '../moderation/queries.js';
import { upsertBuddyList, syncBuddyMembers } from '../buddylist/queries.js';
import { checkMessageContent } from '../moderation/service.js';
import type { WsServer } from '../ws/server.js';

export interface FirehoseEvent {
  did: string;
  collection: string;
  rkey: string;
  record: unknown;
  uri: string;
}

export function createHandlers(db: Sql, wss: WsServer) {
  const handlers: Record<string, (event: FirehoseEvent) => Promise<void>> = {
    [NSID.Room]: async (event) => {
      const record = event.record as RoomRecord;
      await createRoom(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        name: record.name,
        description: record.description,
        purpose: record.purpose,
        visibility: record.settings?.visibility ?? 'public',
        minAccountAgeDays: record.settings?.minAccountAgeDays ?? 0,
        slowModeSeconds: record.settings?.slowModeSeconds ?? 0,
        createdAt: record.createdAt,
      });
      console.log(`Indexed room: ${record.name} (${event.rkey})`);
    },

    [NSID.Message]: async (event) => {
      const record = event.record as MessageRecord;
      const roomId = extractRkey(record.room);

      // Content filter — skip indexing if blocked
      const filterResult = checkMessageContent(record.text);
      if (!filterResult.passed) {
        console.log(`Message filtered from ${event.did}: ${filterResult.reason ?? 'blocked'}`);
        return;
      }

      // Ban check — skip broadcast if banned (still index, record exists on atproto)
      const banned = await isUserBanned(db, roomId, event.did);

      await insertMessage(db, {
        id: event.rkey,
        uri: event.uri,
        did: event.did,
        roomId,
        text: record.text,
        replyTo: record.replyTo,
        createdAt: record.createdAt,
      });

      if (!banned) {
        wss.broadcastToRoom(roomId, {
          type: 'message',
          data: {
            id: event.rkey,
            uri: event.uri,
            did: event.did,
            roomId,
            text: record.text,
            replyTo: record.replyTo,
            createdAt: record.createdAt,
          },
        });
      }
    },

    [NSID.Ban]: async (event) => {
      const record = event.record as BanRecord;
      await recordModAction(db, {
        roomId: extractRkey(record.room),
        actorDid: event.did,
        subjectDid: record.subject,
        action: 'ban',
        reason: record.reason,
      });
      console.log(`Ban indexed: ${record.subject} from room ${extractRkey(record.room)}`);
    },

    [NSID.Role]: async (event) => {
      const record = event.record as RoleRecord;
      await upsertRoomRole(db, {
        roomId: extractRkey(record.room),
        subjectDid: record.subject,
        role: record.role,
        grantedBy: event.did,
        uri: event.uri,
        createdAt: record.createdAt,
      });
      console.log(
        `Role indexed: ${record.subject} as ${record.role} in ${extractRkey(record.room)}`,
      );
    },

    [NSID.BuddyList]: async (event) => {
      const record = event.record as BuddyListRecord;
      await upsertBuddyList(db, { did: event.did, groups: record.groups });

      // Flatten all members across groups for denormalized lookup table
      const allMembers: Array<{ did: string; addedAt: string }> = [];
      for (const group of record.groups) {
        for (const member of group.members) {
          allMembers.push({ did: member.did, addedAt: member.addedAt });
        }
      }
      await syncBuddyMembers(db, event.did, allMembers);
      console.log(`Buddy list indexed for ${event.did}: ${allMembers.length} members`);
    },

    [NSID.Presence]: (event) => {
      // Log-only for MVP — in-memory tracker handles ephemeral presence state
      console.log(`Presence record from ${event.did} (rkey: ${event.rkey})`);
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

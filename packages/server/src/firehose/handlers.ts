import { NSID, TOWN_LAYOUT_COLLECTION } from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import { upsertCommunityList, syncCommunityMembers } from '../community/queries.js';
import type { WsServer } from '../ws/server.js';
import { communityRecordSchema } from './record-schemas.js';
import type { LabelerService } from '../moderation/labeler-service.js';
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

export function createHandlers(db: Sql, wss: WsServer, _labelerService: LabelerService) {
  const handlers: Record<string, (event: FirehoseEvent) => Promise<void>> = {
    // A designed space: rkey is the space. Validation happens on the way in.
    [TOWN_LAYOUT_COLLECTION]: async (event) => {
      if (event.rkey !== 'home' && event.rkey !== 'yard') return;
      await wss.townLayoutChanged(
        event.did,
        event.rkey,
        event.operation === 'delete' ? null : event.record,
        event.cid,
      );
    },
    [NSID.Community]: async (event) => {
      if (event.operation === 'delete') {
        // Community record deleted — clear the member list for this DID
        await syncCommunityMembers(db, event.did, []);
        wss.communityChanged(event.did, [], []);
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
      // Town access follows at once (removing someone walks them out).
      wss.communityChanged(
        event.did,
        allMembers.map((m) => m.did),
        record.groups.filter((g) => g.isInnerCircle).flatMap((g) => g.members.map((m) => m.did)),
      );
      log.info({ did: event.did, memberCount: allMembers.length }, 'Community list indexed');
    },
  };

  return handlers;
}

/** Extract the rkey (last path segment) from an AT-URI or synthetic URI. */
export function extractRkey(uri: string): string {
  const segments = uri.split('/');
  return segments[segments.length - 1] ?? uri;
}

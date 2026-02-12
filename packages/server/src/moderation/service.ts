import type { Sql } from '../db/client.js';
import { filterText, type FilterResult } from './filter.js';
import { isUserBanned } from './queries.js';
import { getRoomById } from '../rooms/queries.js';
import { getDidCreationDate, getAccountAgeDays } from './account-age.js';

export function checkMessageContent(text: string): FilterResult {
  return filterText(text);
}

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

/** Check if a DID is on the room's allowlist. */
async function isUserAllowlisted(sql: Sql, roomId: string, did: string): Promise<boolean> {
  const rows = await sql<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM room_allowlist
      WHERE room_id = ${roomId} AND subject_did = ${did}
    ) AS found
  `;
  return rows[0]?.found ?? false;
}

export async function checkUserAccess(
  sql: Sql,
  roomId: string,
  did: string,
): Promise<AccessResult> {
  const banned = await isUserBanned(sql, roomId, did);
  if (banned) {
    return { allowed: false, reason: 'User is banned from this room' };
  }

  const room = await getRoomById(sql, roomId);
  if (!room) {
    return { allowed: false, reason: 'Room not found' };
  }

  // Allowlist gate — room creator is always allowed
  if (room.allowlist_enabled && room.did !== did) {
    const allowed = await isUserAllowlisted(sql, roomId, did);
    if (!allowed) {
      return { allowed: false, reason: 'This room requires an invite to join' };
    }
  }

  // Account age gate — fail closed if we can't verify (e.g. did:web)
  if (room.min_account_age_days > 0) {
    const creationDate = await getDidCreationDate(did);
    if (!creationDate) {
      return {
        allowed: false,
        reason:
          'Account age could not be verified for this room (e.g. non-PLC DIDs). Use a PLC-backed account to join.',
      };
    }
    const ageDays = getAccountAgeDays(creationDate);
    if (ageDays < room.min_account_age_days) {
      return {
        allowed: false,
        reason: `Account must be at least ${String(room.min_account_age_days)} days old to join this room`,
      };
    }
  }

  return { allowed: true };
}

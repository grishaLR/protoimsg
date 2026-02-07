import type { Sql } from '../db/client.js';
import { filterText, type FilterResult } from './filter.js';
import { isUserBanned } from './queries.js';

export function checkMessageContent(text: string): FilterResult {
  return filterText(text);
}

export async function checkUserAccess(
  sql: Sql,
  roomId: string,
  did: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const banned = await isUserBanned(sql, roomId, did);
  if (banned) {
    return { allowed: false, reason: 'User is banned from this room' };
  }
  return { allowed: true };
}

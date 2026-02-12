import type { Sql } from '../db/client.js';
import {
  getMessagesByRoom,
  getThreadMessages,
  getReplyCountsByRootUris,
  type MessageRow,
  type ReplyCount,
} from './queries.js';

export interface MessageHistoryOptions {
  limit?: number;
  before?: string;
}

export async function getRoomMessages(
  sql: Sql,
  roomId: string,
  options: MessageHistoryOptions = {},
): Promise<MessageRow[]> {
  return getMessagesByRoom(sql, roomId, options);
}

export async function getThreadMessagesByRoot(
  sql: Sql,
  roomId: string,
  rootUri: string,
  options: { limit?: number } = {},
): Promise<MessageRow[]> {
  return getThreadMessages(sql, roomId, rootUri, options);
}

/**
 * Given a list of messages, find all root-level messages (no reply_root)
 * and return their reply counts.
 */
export async function getReplyCounts(
  sql: Sql,
  messages: MessageRow[],
): Promise<Record<string, number>> {
  // Root messages are those with no reply_root themselves
  const rootUris = messages.filter((m) => !m.reply_root).map((m) => m.uri);
  if (rootUris.length === 0) return {};

  const counts: ReplyCount[] = await getReplyCountsByRootUris(sql, rootUris);
  const result: Record<string, number> = {};
  for (const row of counts) {
    result[row.reply_root] = Number(row.count);
  }
  return result;
}

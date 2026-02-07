import type { Sql } from '../db/client.js';
import { getMessagesByRoom, type MessageRow } from './queries.js';

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

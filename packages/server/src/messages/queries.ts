import type { Sql } from '../db/client.js';

export interface MessageRow {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  text: string;
  reply_to: string | null;
  created_at: Date;
  indexed_at: Date;
}

export interface InsertMessageInput {
  id: string;
  uri: string;
  did: string;
  roomId: string;
  text: string;
  replyTo?: string;
  createdAt: string;
}

export async function insertMessage(sql: Sql, input: InsertMessageInput): Promise<void> {
  await sql`
    INSERT INTO messages (id, uri, did, room_id, text, reply_to, created_at)
    VALUES (
      ${input.id},
      ${input.uri},
      ${input.did},
      ${input.roomId},
      ${input.text},
      ${input.replyTo ?? null},
      ${input.createdAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getMessagesByRoom(
  sql: Sql,
  roomId: string,
  options: { limit?: number; before?: string } = {},
): Promise<MessageRow[]> {
  const { limit = 50, before } = options;

  if (before) {
    return sql<MessageRow[]>`
      SELECT * FROM messages
      WHERE room_id = ${roomId} AND created_at < ${before}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return sql<MessageRow[]>`
    SELECT * FROM messages
    WHERE room_id = ${roomId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

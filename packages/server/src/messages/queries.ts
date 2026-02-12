import type { Sql, JsonValue } from '../db/client.js';

export interface MessageRow {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  text: string;
  reply_parent: string | null;
  reply_root: string | null;
  facets: unknown;
  embed: unknown;
  created_at: Date;
  indexed_at: Date;
}

export interface InsertMessageInput {
  id: string;
  uri: string;
  did: string;
  cid: string | null;
  roomId: string;
  text: string;
  replyRoot?: string;
  replyParent?: string;
  facets?: unknown[];
  embed?: unknown;
  createdAt: string;
}

export async function insertMessage(sql: Sql, input: InsertMessageInput): Promise<void> {
  await sql`
    INSERT INTO messages (id, uri, did, cid, room_id, text, reply_parent, reply_root, facets, embed, created_at)
    VALUES (
      ${input.id},
      ${input.uri},
      ${input.did},
      ${input.cid},
      ${input.roomId},
      ${input.text},
      ${input.replyParent ?? null},
      ${input.replyRoot ?? null},
      ${input.facets ? sql.json(input.facets as JsonValue) : null},
      ${input.embed ? sql.json(input.embed as JsonValue) : null},
      ${input.createdAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      cid = EXCLUDED.cid,
      text = EXCLUDED.text,
      reply_parent = EXCLUDED.reply_parent,
      reply_root = EXCLUDED.reply_root,
      facets = EXCLUDED.facets,
      embed = EXCLUDED.embed,
      indexed_at = NOW()
  `;
}

/** Hard-delete a message by its AT-URI. */
export async function deleteMessage(sql: Sql, uri: string): Promise<void> {
  await sql`DELETE FROM messages WHERE uri = ${uri}`;
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

/** Delete room messages older than retentionDays. Returns count of deleted rows. */
export async function pruneOldMessages(sql: Sql, retentionDays: number): Promise<number> {
  const result = await sql<{ count: string }[]>`
    WITH deleted AS (
      DELETE FROM messages
      WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM deleted
  `;
  return Number(result[0]?.count ?? 0);
}

import type { Sql, JsonValue } from '../db/client.js';

export interface MessageRow {
  id: string;
  uri: string;
  did: string;
  room_id: string;
  channel_id: string;
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
  channelId: string;
  text: string;
  replyRoot?: string;
  replyParent?: string;
  facets?: unknown[];
  embed?: unknown;
  createdAt: string;
}

export async function insertMessage(sql: Sql, input: InsertMessageInput): Promise<void> {
  await sql`
    INSERT INTO messages (id, uri, did, cid, room_id, channel_id, text, reply_parent, reply_root, facets, embed, created_at)
    VALUES (
      ${input.id},
      ${input.uri},
      ${input.did},
      ${input.cid},
      ${input.roomId},
      ${input.channelId},
      ${input.text},
      ${input.replyParent ?? null},
      ${input.replyRoot ?? null},
      ${input.facets ? sql.json(input.facets as JsonValue) : null},
      ${input.embed ? sql.json(input.embed as JsonValue) : null},
      ${input.createdAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      cid = EXCLUDED.cid,
      channel_id = EXCLUDED.channel_id,
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

/** ISO 8601 datetime (basic validation to prevent SQL injection / garbage input) */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export async function getMessagesByRoom(
  sql: Sql,
  roomId: string,
  options: { limit?: number; before?: string } = {},
): Promise<MessageRow[]> {
  const { limit = 50, before } = options;

  if (before) {
    if (!ISO_DATETIME_RE.test(before)) {
      throw new Error('Invalid "before" cursor: expected ISO 8601 timestamp');
    }
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

export async function getMessagesByChannel(
  sql: Sql,
  channelId: string,
  options: { limit?: number; before?: string } = {},
): Promise<MessageRow[]> {
  const { limit = 50, before } = options;

  if (before) {
    if (!ISO_DATETIME_RE.test(before)) {
      throw new Error('Invalid "before" cursor: expected ISO 8601 timestamp');
    }
    return sql<MessageRow[]>`
      SELECT * FROM messages
      WHERE channel_id = ${channelId} AND created_at < ${before}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return sql<MessageRow[]>`
    SELECT * FROM messages
    WHERE channel_id = ${channelId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/** Get all messages in a thread (root + replies), ordered chronologically. */
export async function getThreadMessages(
  sql: Sql,
  channelId: string,
  rootUri: string,
  options: { limit?: number } = {},
): Promise<MessageRow[]> {
  const { limit = 200 } = options;

  return sql<MessageRow[]>`
    SELECT * FROM messages
    WHERE channel_id = ${channelId}
      AND (uri = ${rootUri} OR reply_root = ${rootUri})
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

/** Reply count per root URI. Only counts direct children of the thread root. */
export interface ReplyCount {
  reply_root: string;
  count: string;
}

/** Get reply counts for root messages in a room. Accepts the URIs of messages to check. */
export async function getReplyCountsByRootUris(
  sql: Sql,
  rootUris: string[],
): Promise<ReplyCount[]> {
  if (rootUris.length === 0) return [];

  return sql<ReplyCount[]>`
    SELECT reply_root, COUNT(*)::text as count
    FROM messages
    WHERE reply_root IN ${sql(rootUris)}
    GROUP BY reply_root
  `;
}

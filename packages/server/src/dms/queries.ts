import { createHash } from 'node:crypto';
import type { Sql } from '../db/client.js';

export interface DmConversationRow {
  id: string;
  did_1: string;
  did_2: string;
  persist: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DmMessageRow {
  id: string;
  conversation_id: string;
  sender_did: string;
  text: string;
  created_at: Date;
}

/** Sort two DIDs lexicographically — did_1 is always the smaller */
export function sortDids(didA: string, didB: string): [string, string] {
  return didA < didB ? [didA, didB] : [didB, didA];
}

/** Deterministic conversation ID from two DIDs (sha256, 16 hex chars) */
export function computeConversationId(didA: string, didB: string): string {
  const [did1, did2] = sortDids(didA, didB);
  return createHash('sha256').update(`${did1}:${did2}`).digest('hex').slice(0, 16);
}

export async function upsertConversation(
  sql: Sql,
  id: string,
  did1: string,
  did2: string,
): Promise<DmConversationRow> {
  const rows = await sql<DmConversationRow[]>`
    INSERT INTO dm_conversations (id, did_1, did_2)
    VALUES (${id}, ${did1}, ${did2})
    ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
    RETURNING *
  `;
  return rows[0] as DmConversationRow;
}

export async function getConversation(
  sql: Sql,
  conversationId: string,
): Promise<DmConversationRow | undefined> {
  const rows = await sql<DmConversationRow[]>`
    SELECT * FROM dm_conversations WHERE id = ${conversationId}
  `;
  return rows[0];
}

export async function listConversationsForDid(
  sql: Sql,
  did: string,
  opts?: { limit?: number; offset?: number },
): Promise<DmConversationRow[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return sql<DmConversationRow[]>`
    SELECT * FROM dm_conversations
    WHERE did_1 = ${did} OR did_2 = ${did}
    ORDER BY updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function insertDmMessage(
  sql: Sql,
  msg: { id: string; conversationId: string; senderDid: string; text: string },
): Promise<DmMessageRow> {
  const rows = await sql<DmMessageRow[]>`
    INSERT INTO dm_messages (id, conversation_id, sender_did, text)
    VALUES (${msg.id}, ${msg.conversationId}, ${msg.senderDid}, ${msg.text})
    RETURNING *
  `;
  // Update conversation's updated_at
  await sql`UPDATE dm_conversations SET updated_at = NOW() WHERE id = ${msg.conversationId}`;
  return rows[0] as DmMessageRow;
}

export async function getDmMessages(
  sql: Sql,
  conversationId: string,
  opts?: { limit?: number; before?: string },
): Promise<DmMessageRow[]> {
  const limit = opts?.limit ?? 50;
  if (opts?.before) {
    return sql<DmMessageRow[]>`
      SELECT * FROM dm_messages
      WHERE conversation_id = ${conversationId} AND created_at < ${opts.before}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<DmMessageRow[]>`
    SELECT * FROM dm_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function setConversationPersist(
  sql: Sql,
  conversationId: string,
  persist: boolean,
): Promise<void> {
  await sql`
    UPDATE dm_conversations SET persist = ${persist}, updated_at = NOW()
    WHERE id = ${conversationId}
  `;
}

export async function deleteConversationMessages(sql: Sql, conversationId: string): Promise<void> {
  await sql`DELETE FROM dm_messages WHERE conversation_id = ${conversationId}`;
}

export async function deleteConversation(sql: Sql, conversationId: string): Promise<void> {
  await sql`DELETE FROM dm_conversations WHERE id = ${conversationId}`;
}

export async function pruneExpiredDmMessages(sql: Sql, retentionDays: number): Promise<number> {
  const result = await sql`
    DELETE FROM dm_messages
    WHERE created_at < NOW() - ${`${String(retentionDays)} days`}::interval
    AND conversation_id IN (
      SELECT id FROM dm_conversations WHERE persist = TRUE
    )
  `;
  return result.count;
}

export async function pruneEmptyConversations(sql: Sql): Promise<number> {
  const result = await sql`
    DELETE FROM dm_conversations
    WHERE id NOT IN (SELECT DISTINCT conversation_id FROM dm_messages)
  `;
  return result.count;
}

import type { Sql } from '../db/client.js';

export interface ModActionRow {
  id: number;
  room_id: string;
  actor_did: string;
  subject_did: string;
  action: string;
  reason: string | null;
  created_at: Date;
}

export interface RecordModActionInput {
  roomId: string;
  actorDid: string;
  subjectDid: string;
  action: string;
  reason?: string;
}

export async function recordModAction(sql: Sql, input: RecordModActionInput): Promise<void> {
  await sql`
    INSERT INTO mod_actions (room_id, actor_did, subject_did, action, reason)
    VALUES (${input.roomId}, ${input.actorDid}, ${input.subjectDid}, ${input.action}, ${input.reason ?? null})
  `;
}

export async function isUserBanned(sql: Sql, roomId: string, did: string): Promise<boolean> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM mod_actions
    WHERE room_id = ${roomId} AND subject_did = ${did} AND action = 'ban'
  `;
  return Number(rows[0]?.count) > 0;
}

export async function getModActions(
  sql: Sql,
  roomId: string,
  options: { limit?: number } = {},
): Promise<ModActionRow[]> {
  const { limit = 50 } = options;
  return sql<ModActionRow[]>`
    SELECT * FROM mod_actions
    WHERE room_id = ${roomId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

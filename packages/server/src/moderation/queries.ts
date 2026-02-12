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
  uri?: string;
  roomId: string;
  actorDid: string;
  subjectDid: string;
  action: string;
  reason?: string;
}

export async function recordModAction(sql: Sql, input: RecordModActionInput): Promise<void> {
  await sql`
    INSERT INTO mod_actions (uri, room_id, actor_did, subject_did, action, reason)
    VALUES (${input.uri ?? null}, ${input.roomId}, ${input.actorDid}, ${input.subjectDid}, ${input.action}, ${input.reason ?? null})
    ON CONFLICT (uri) DO NOTHING
  `;
}

/** Hard-delete a mod action by its AT-URI. */
export async function deleteModActionByUri(sql: Sql, uri: string): Promise<void> {
  await sql`DELETE FROM mod_actions WHERE uri = ${uri}`;
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

// -- Role queries --

export interface UpsertRoomRoleInput {
  roomId: string;
  subjectDid: string;
  role: string;
  grantedBy: string;
  uri: string;
  cid: string | null;
  createdAt: string;
}

export interface RoomRoleRow {
  id: number;
  room_id: string;
  subject_did: string;
  role: string;
  granted_by: string;
  uri: string;
  created_at: Date;
  indexed_at: Date;
}

export async function upsertRoomRole(sql: Sql, input: UpsertRoomRoleInput): Promise<void> {
  await sql`
    INSERT INTO room_roles (room_id, subject_did, role, granted_by, uri, cid, created_at)
    VALUES (${input.roomId}, ${input.subjectDid}, ${input.role}, ${input.grantedBy}, ${input.uri}, ${input.cid}, ${input.createdAt})
    ON CONFLICT (room_id, subject_did, role) DO UPDATE SET
      granted_by = EXCLUDED.granted_by,
      uri = EXCLUDED.uri,
      cid = EXCLUDED.cid,
      created_at = EXCLUDED.created_at,
      indexed_at = NOW()
  `;
}

/** Hard-delete a role assignment by its AT-URI. */
export async function deleteRoomRoleByUri(sql: Sql, uri: string): Promise<void> {
  await sql`DELETE FROM room_roles WHERE uri = ${uri}`;
}

export async function isUserModerator(sql: Sql, roomId: string, did: string): Promise<boolean> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM room_roles
    WHERE room_id = ${roomId} AND subject_did = ${did}
      AND role IN ('moderator', 'owner')
  `;
  return Number(rows[0]?.count) > 0;
}

export async function getRoomRoles(sql: Sql, roomId: string): Promise<RoomRoleRow[]> {
  return sql<RoomRoleRow[]>`
    SELECT * FROM room_roles
    WHERE room_id = ${roomId}
    ORDER BY created_at ASC
  `;
}

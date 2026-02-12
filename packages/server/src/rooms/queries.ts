import type { Sql } from '../db/client.js';

export interface RoomRow {
  id: string;
  uri: string;
  did: string;
  name: string;
  topic: string;
  description: string | null;
  purpose: string;
  visibility: string;
  min_account_age_days: number;
  slow_mode_seconds: number;
  allowlist_enabled: boolean;
  created_at: Date;
  indexed_at: Date;
}

export interface CreateRoomInput {
  id: string;
  uri: string;
  did: string;
  cid: string | null;
  name: string;
  topic: string;
  description?: string;
  purpose: string;
  visibility: string;
  minAccountAgeDays: number;
  slowModeSeconds: number;
  allowlistEnabled: boolean;
  createdAt: string;
}

export async function createRoom(sql: Sql, input: CreateRoomInput): Promise<void> {
  await sql`
    INSERT INTO rooms (id, uri, did, cid, name, topic, description, purpose, visibility, min_account_age_days, slow_mode_seconds, allowlist_enabled, created_at)
    VALUES (
      ${input.id},
      ${input.uri},
      ${input.did},
      ${input.cid},
      ${input.name},
      ${input.topic},
      ${input.description ?? null},
      ${input.purpose},
      ${input.visibility},
      ${input.minAccountAgeDays},
      ${input.slowModeSeconds},
      ${input.allowlistEnabled},
      ${input.createdAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      cid = EXCLUDED.cid,
      name = EXCLUDED.name,
      topic = EXCLUDED.topic,
      description = EXCLUDED.description,
      purpose = EXCLUDED.purpose,
      visibility = EXCLUDED.visibility,
      min_account_age_days = EXCLUDED.min_account_age_days,
      slow_mode_seconds = EXCLUDED.slow_mode_seconds,
      allowlist_enabled = EXCLUDED.allowlist_enabled,
      indexed_at = NOW()
  `;
}

/** Hard-delete a room by its AT-URI. */
export async function deleteRoom(sql: Sql, uri: string): Promise<void> {
  await sql`DELETE FROM rooms WHERE uri = ${uri}`;
}

export async function listRooms(
  sql: Sql,
  options: { visibility?: string; limit?: number; offset?: number } = {},
): Promise<RoomRow[]> {
  const { visibility = 'public', limit = 50, offset = 0 } = options;
  return sql<RoomRow[]>`
    SELECT * FROM rooms
    WHERE visibility = ${visibility}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getRoomById(sql: Sql, id: string): Promise<RoomRow | undefined> {
  const rows = await sql<RoomRow[]>`
    SELECT * FROM rooms WHERE id = ${id}
  `;
  return rows[0];
}

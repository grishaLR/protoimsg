import type { Sql } from '../db/client.js';

export interface RoomRow {
  id: string;
  uri: string;
  did: string;
  name: string;
  description: string | null;
  purpose: string;
  visibility: string;
  min_account_age_days: number;
  slow_mode_seconds: number;
  created_at: Date;
  indexed_at: Date;
}

export interface CreateRoomInput {
  id: string;
  uri: string;
  did: string;
  name: string;
  description?: string;
  purpose: string;
  visibility: string;
  minAccountAgeDays: number;
  slowModeSeconds: number;
  createdAt: string;
}

export async function createRoom(sql: Sql, input: CreateRoomInput): Promise<void> {
  await sql`
    INSERT INTO rooms (id, uri, did, name, description, purpose, visibility, min_account_age_days, slow_mode_seconds, created_at)
    VALUES (
      ${input.id},
      ${input.uri},
      ${input.did},
      ${input.name},
      ${input.description ?? null},
      ${input.purpose},
      ${input.visibility},
      ${input.minAccountAgeDays},
      ${input.slowModeSeconds},
      ${input.createdAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      purpose = EXCLUDED.purpose,
      visibility = EXCLUDED.visibility,
      min_account_age_days = EXCLUDED.min_account_age_days,
      slow_mode_seconds = EXCLUDED.slow_mode_seconds,
      indexed_at = NOW()
  `;
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

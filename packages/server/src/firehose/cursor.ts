import type { Sql } from '../db/client.js';

export async function getCursor(sql: Sql): Promise<number | undefined> {
  const rows = await sql<{ cursor: string }[]>`
    SELECT cursor FROM firehose_cursor WHERE id = 1
  `;
  const row = rows[0];
  return row ? Number(row.cursor) : undefined;
}

export async function saveCursor(sql: Sql, cursor: number): Promise<void> {
  await sql`
    INSERT INTO firehose_cursor (id, cursor, updated_at)
    VALUES (1, ${cursor}, NOW())
    ON CONFLICT (id) DO UPDATE
    SET cursor = ${cursor}, updated_at = NOW()
  `;
}

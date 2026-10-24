import type { Sql, JsonValue } from '../db/client.js';
import type { TownPlacement, TownSpace } from '@protoimsg/shared';

/**
 * Upsert an indexed layout (idempotent: Jetstream may replay). `updatedAt`
 * is the record's own: an older write never replaces a newer one, so a
 * late firehose event can't undo a fresher save read from the PDS.
 * Returns false when the stored layout was newer.
 */
export async function upsertTownLayout(
  sql: Sql,
  input: {
    did: string;
    space: TownSpace;
    placements: TownPlacement[];
    cid: string | null;
    updatedAt: Date;
  },
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO town_layouts (did, space, placements, cid, updated_at, indexed_at)
    VALUES (${input.did}, ${input.space}, ${sql.json(input.placements as unknown as JsonValue)},
            ${input.cid}, ${input.updatedAt}, NOW())
    ON CONFLICT (did, space) DO UPDATE SET
      placements = EXCLUDED.placements,
      cid = EXCLUDED.cid,
      updated_at = EXCLUDED.updated_at,
      indexed_at = NOW()
    WHERE town_layouts.updated_at <= EXCLUDED.updated_at
    RETURNING did
  `;
  return rows.length > 0;
}

export async function deleteTownLayout(sql: Sql, did: string, space: TownSpace): Promise<void> {
  await sql`DELETE FROM town_layouts WHERE did = ${did} AND space = ${space}`;
}

/** The indexed layout, or null if the owner never designed this space. */
export async function getTownLayout(
  sql: Sql,
  did: string,
  space: TownSpace,
): Promise<TownPlacement[] | null> {
  const rows = await sql<Array<{ placements: unknown }>>`
    SELECT placements FROM town_layouts WHERE did = ${did} AND space = ${space}
  `;
  const row = rows[0];
  return row ? (row.placements as TownPlacement[]) : null;
}

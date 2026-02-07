import type { Sql, JsonValue } from '../db/client.js';

export interface BuddyListRow {
  did: string;
  groups: unknown; // JSONB
  updated_at: Date;
  indexed_at: Date;
}

export async function upsertBuddyList(
  sql: Sql,
  input: { did: string; groups: unknown },
): Promise<void> {
  await sql`
    INSERT INTO buddy_lists (did, groups, updated_at, indexed_at)
    VALUES (${input.did}, ${sql.json(input.groups as JsonValue)}, NOW(), NOW())
    ON CONFLICT (did) DO UPDATE SET
      groups = ${sql.json(input.groups as JsonValue)},
      updated_at = NOW(),
      indexed_at = NOW()
  `;
}

export async function syncBuddyMembers(
  sql: Sql,
  ownerDid: string,
  members: Array<{ did: string; addedAt: string }>,
): Promise<void> {
  await sql`DELETE FROM buddy_members WHERE owner_did = ${ownerDid}`;

  if (members.length > 0) {
    // Deduplicate by DID (a member can appear in multiple groups)
    const seen = new Set<string>();
    const unique: Array<{ did: string; addedAt: string }> = [];
    for (const m of members) {
      if (!seen.has(m.did)) {
        seen.add(m.did);
        unique.push(m);
      }
    }
    const rows = unique.map((m) => ({
      owner_did: ownerDid,
      buddy_did: m.did,
      added_at: m.addedAt,
    }));
    await sql`INSERT INTO buddy_members ${sql(rows)}`;
  }
}

export async function getBuddyList(sql: Sql, did: string): Promise<BuddyListRow | undefined> {
  const rows = await sql<BuddyListRow[]>`
    SELECT * FROM buddy_lists WHERE did = ${did}
  `;
  return rows[0];
}

/**
 * Check if `queryDid` is in any of `ownerDid`'s close-friends groups.
 * Scans the JSONB `groups` array for groups with `isCloseFriends: true`
 * that contain `queryDid` in their members.
 */
export async function isCloseFriend(
  sql: Sql,
  ownerDid: string,
  queryDid: string,
): Promise<boolean> {
  const rows = await sql<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM buddy_lists,
           jsonb_array_elements(groups) AS g
      WHERE did = ${ownerDid}
        AND jsonb_typeof(groups) = 'array'
        AND (g->>'isCloseFriends')::boolean = true
        AND jsonb_typeof(g->'members') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(g->'members') AS m
          WHERE m->>'did' = ${queryDid}
        )
    ) AS found
  `;
  return rows[0]?.found ?? false;
}

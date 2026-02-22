import type { Sql, JsonValue } from '../db/client.js';

export interface CommunityListRow {
  did: string;
  groups: unknown; // JSONB
  updated_at: Date;
  indexed_at: Date;
}

export async function upsertCommunityList(
  sql: Sql,
  input: { did: string; groups: unknown },
): Promise<void> {
  await sql`
    INSERT INTO community_lists (did, groups, updated_at, indexed_at)
    VALUES (${input.did}, ${sql.json(input.groups as JsonValue)}, NOW(), NOW())
    ON CONFLICT (did) DO UPDATE SET
      groups = ${sql.json(input.groups as JsonValue)},
      updated_at = NOW(),
      indexed_at = NOW()
  `;
}

export async function syncCommunityMembers(
  sql: Sql,
  ownerDid: string,
  members: Array<{ did: string; addedAt: string }>,
): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call -- postgres.js TransactionSql type loses tagged template call signature via Omit */
  await sql.begin(async (tx: any) => {
    await tx`DELETE FROM community_members WHERE owner_did = ${ownerDid}`;

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
        member_did: m.did,
        added_at: m.addedAt,
      }));
      await tx`INSERT INTO community_members ${sql(rows)}`;
    }
  });
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
}

export async function getCommunityList(
  sql: Sql,
  did: string,
): Promise<CommunityListRow | undefined> {
  const rows = await sql<CommunityListRow[]>`
    SELECT * FROM community_lists WHERE did = ${did}
  `;
  return rows[0];
}

/** Batch check which DIDs from a list are in the owner's community. Returns a Set of member DIDs. */
export async function batchIsCommunityMember(
  sql: Sql,
  ownerDid: string,
  queryDids: string[],
): Promise<Set<string>> {
  if (queryDids.length === 0) return new Set();
  const rows = await sql<Array<{ member_did: string }>>`
    SELECT member_did FROM community_members
    WHERE owner_did = ${ownerDid} AND member_did = ANY(${queryDids})
  `;
  return new Set(rows.map((r) => r.member_did));
}

/** Get all DIDs in the owner's inner circle groups. */
export async function getInnerCircleDids(sql: Sql, ownerDid: string): Promise<Set<string>> {
  const rows = await sql<Array<{ did: string }>>`
    SELECT m->>'did' AS did
    FROM community_lists,
         jsonb_array_elements(groups) AS g,
         jsonb_array_elements(g->'members') AS m
    WHERE community_lists.did = ${ownerDid}
      AND jsonb_typeof(groups) = 'array'
      AND (g->>'isInnerCircle')::boolean = true
      AND jsonb_typeof(g->'members') = 'array'
  `;
  return new Set(rows.map((r) => r.did));
}

/** Check if `queryDid` is in any of `ownerDid`'s community groups. */
export async function isCommunityMember(
  sql: Sql,
  ownerDid: string,
  queryDid: string,
): Promise<boolean> {
  const rows = await sql<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM community_members
      WHERE owner_did = ${ownerDid} AND member_did = ${queryDid}
    ) AS found
  `;
  return rows[0]?.found ?? false;
}

/**
 * Check if `queryDid` is in any of `ownerDid`'s inner circle groups.
 * Scans the JSONB `groups` array for groups with `isInnerCircle: true`
 * that contain `queryDid` in their members.
 */
export async function isInnerCircle(
  sql: Sql,
  ownerDid: string,
  queryDid: string,
): Promise<boolean> {
  const rows = await sql<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM community_lists,
           jsonb_array_elements(groups) AS g
      WHERE did = ${ownerDid}
        AND jsonb_typeof(groups) = 'array'
        AND (g->>'isInnerCircle')::boolean = true
        AND jsonb_typeof(g->'members') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(g->'members') AS m
          WHERE m->>'did' = ${queryDid}
        )
    ) AS found
  `;
  return rows[0]?.found ?? false;
}

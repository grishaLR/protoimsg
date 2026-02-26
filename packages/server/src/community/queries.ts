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

/**
 * Batch check which DIDs from a list are in the owner's community.
 * One owner, many candidate members.
 * Returns a Set of member DIDs that are in the owner's community.
 *
 * @example batchIsCommunityMember(sql, aliceDid, [bobDid, carolDid])
 * // → Set of DIDs from [bob, carol] that are in alice's community
 */
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

/**
 * Batch check which DIDs from a list are in the owner's inner circle.
 * One owner, many candidate members. Uses JSONB scan on the `groups` column.
 * Returns a Set of DIDs from `queryDids` that appear in the owner's inner-circle groups.
 *
 * @example batchIsInnerCircleMember(sql, aliceDid, [bobDid, carolDid])
 * // → Set of DIDs from [bob, carol] that are in alice's inner circle
 */
export async function batchIsInnerCircleMember(
  sql: Sql,
  ownerDid: string,
  queryDids: string[],
): Promise<Set<string>> {
  if (queryDids.length === 0) return new Set();
  const rows = await sql<Array<{ did: string }>>`
    SELECT DISTINCT m->>'did' AS did
    FROM community_lists,
         jsonb_array_elements(groups) AS g,
         jsonb_array_elements(g->'members') AS m
    WHERE community_lists.did = ${ownerDid}
      AND jsonb_typeof(groups) = 'array'
      AND (g->>'isInnerCircle')::boolean = true
      AND jsonb_typeof(g->'members') = 'array'
      AND m->>'did' = ANY(${queryDids})
  `;
  return new Set(rows.map((r) => r.did));
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

/**
 * Batch check which of `ownerDids` consider `queryDid` a community member.
 * Many owners, one candidate member — the inverse of `batchIsCommunityMember`.
 * Returns a Set of owner DIDs that include queryDid in their community.
 *
 * @example batchCheckMembership(sql, [aliceDid, bobDid], carolDid)
 * // → Set of owner DIDs from [alice, bob] whose community includes carol
 */
export async function batchCheckMembership(
  sql: Sql,
  ownerDids: string[],
  queryDid: string,
): Promise<Set<string>> {
  if (ownerDids.length === 0) return new Set();
  const rows = await sql<Array<{ owner_did: string }>>`
    SELECT owner_did FROM community_members
    WHERE owner_did = ANY(${ownerDids}) AND member_did = ${queryDid}
  `;
  return new Set(rows.map((r) => r.owner_did));
}

/**
 * Batch check which of `ownerDids` consider `queryDid` in their inner circle.
 * Many owners, one candidate member — the inverse of `batchIsInnerCircleMember`.
 * Scans the JSONB `groups` column for inner-circle groups containing queryDid.
 * Returns a Set of owner DIDs whose inner circle includes queryDid.
 *
 * @example batchCheckInnerCircle(sql, [aliceDid, bobDid], carolDid)
 * // → Set of owner DIDs from [alice, bob] whose inner circle includes carol
 */
export async function batchCheckInnerCircle(
  sql: Sql,
  ownerDids: string[],
  queryDid: string,
): Promise<Set<string>> {
  if (ownerDids.length === 0) return new Set();
  const rows = await sql<Array<{ did: string }>>`
    SELECT DISTINCT community_lists.did
    FROM community_lists,
         jsonb_array_elements(groups) AS g
    WHERE community_lists.did = ANY(${ownerDids})
      AND jsonb_typeof(groups) = 'array'
      AND (g->>'isInnerCircle')::boolean = true
      AND jsonb_typeof(g->'members') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(g->'members') AS m
        WHERE m->>'did' = ${queryDid}
      )
  `;
  return new Set(rows.map((r) => r.did));
}

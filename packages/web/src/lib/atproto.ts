import type { Agent } from '@atproto/api';
import { NSID } from '@protoimsg/shared';
import type { CommunityGroup } from '@protoimsg/lexicon';

/** Extract the record key (last path segment) from an AT URI */
export function extractRkey(uri: string): string {
  const segments = uri.split('/');
  return segments[segments.length - 1] ?? '';
}

const TID_CHARS = '234567abcdefghijklmnopqrstuvwxyz';

let lastTimestamp = 0;
let clockId = 0;

/** Generate a TID (timestamp identifier) in atproto format — base32-sortable, ~13 chars */
export function generateTid(): string {
  let now = Date.now() * 1000; // microseconds
  if (now <= lastTimestamp) {
    now = lastTimestamp + 1;
  }
  lastTimestamp = now;

  // 64-bit: top 53 bits timestamp, bottom 10 bits clock ID
  const id = now * 1024 + (clockId % 1024);
  clockId++;

  let result = '';
  let remaining = id;
  for (let i = 0; i < 13; i++) {
    const char = TID_CHARS[remaining & 0x1f] ?? '2';
    result = char + result;
    remaining = Math.floor(remaining / 32);
  }

  return result;
}

// -- Community List PDS helpers --

export async function getCommunityListRecord(agent: Agent): Promise<CommunityGroup[]> {
  try {
    const response = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: NSID.Community,
      rkey: 'self',
    });
    const record = response.data.value as { groups?: CommunityGroup[] };
    return record.groups ?? [];
  } catch (err: unknown) {
    // Only treat "record doesn't exist" as empty — rethrow real errors
    // (network failures, 500s, etc.) so callers don't accidentally wipe the buddy list
    const xrpcError = err as { error?: string };
    if (xrpcError.error === 'RecordNotFound') {
      return [];
    }
    throw err;
  }
}

export async function putCommunityListRecord(
  agent: Agent,
  groups: CommunityGroup[],
): Promise<{ uri: string; cid: string }> {
  const response = await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: NSID.Community,
    rkey: 'self',
    record: {
      $type: NSID.Community,
      groups,
    },
  });

  return { uri: response.data.uri, cid: response.data.cid };
}

// -- Add buddy from chat room --

export type AddBuddyResult = 'added' | 'already';

export async function addToBuddyList(
  agent: Agent,
  send: (msg: { type: 'sync_community'; groups: CommunityGroup[] }) => void,
  did: string,
): Promise<AddBuddyResult> {
  const groups = await getCommunityListRecord(agent);

  // Check if DID already exists in any group
  for (const group of groups) {
    if (group.members.some((m) => m.did === did)) {
      return 'already';
    }
  }

  // Find or create "Community" group
  let community = groups.find((g) => g.name === 'Community');
  if (!community) {
    community = { name: 'Community', members: [] };
    groups.push(community);
  }

  community.members.push({ did, addedAt: new Date().toISOString() });

  await putCommunityListRecord(agent, groups);
  send({ type: 'sync_community', groups });

  return 'added';
}

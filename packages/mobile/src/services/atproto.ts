import type { Agent } from '@atproto/api';
import { NSID } from '@protoimsg/shared';
import type { PresenceStatus } from '@protoimsg/shared';
import type { CommunityGroup } from '@protoimsg/lexicon';

/** Extract the record key (last path segment) from an AT URI */
export function extractRkey(uri: string): string {
  const segments = uri.split('/');
  return segments[segments.length - 1] ?? '';
}

const TID_CHARS = '234567abcdefghijklmnopqrstuvwxyz';

let lastTimestamp = 0;
let clockId = 0;

/** Generate a TID (timestamp identifier) in atproto format */
export function generateTid(): string {
  let now = Date.now() * 1000;
  if (now <= lastTimestamp) {
    now = lastTimestamp + 1;
  }
  lastTimestamp = now;

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

// -- Community List --

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

// -- Presence --

export async function putPresenceRecord(
  agent: Agent,
  status: PresenceStatus,
  opts?: { awayMessage?: string },
): Promise<{ uri: string; cid: string }> {
  const response = await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: NSID.Presence,
    rkey: 'self',
    record: {
      $type: NSID.Presence,
      status,
      awayMessage: opts?.awayMessage,
      updatedAt: new Date().toISOString(),
    },
  });
  return { uri: response.data.uri, cid: response.data.cid };
}

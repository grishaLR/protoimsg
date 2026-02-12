import type { Agent } from '@atproto/api';
import { NSID } from '@protoimsg/shared';
import type {
  RoomPurpose,
  RoomVisibility,
  PresenceStatus,
  PresenceVisibility,
} from '@protoimsg/shared';
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

export interface CreateRoomInput {
  name: string;
  description?: string;
  topic: string;
  purpose: RoomPurpose;
  visibility: RoomVisibility;
}

export interface CreateRoomResult {
  uri: string;
  cid: string;
  rkey: string;
}

export async function createRoomRecord(
  agent: Agent,
  input: CreateRoomInput,
): Promise<CreateRoomResult> {
  const rkey = generateTid();

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: NSID.Room,
    rkey,
    record: {
      $type: NSID.Room,
      name: input.name,
      description: input.description,
      topic: input.topic,
      purpose: input.purpose,
      createdAt: new Date().toISOString(),
      settings: {
        visibility: input.visibility,
      },
    },
  });

  return {
    uri: response.data.uri,
    cid: response.data.cid,
    rkey,
  };
}

export interface CreateMessageInput {
  roomUri: string;
  text: string;
  reply?: { root: string; parent: string };
}

export interface CreateMessageResult {
  uri: string;
  cid: string;
  rkey: string;
}

export async function createMessageRecord(
  agent: Agent,
  input: CreateMessageInput,
  existingRkey?: string,
): Promise<CreateMessageResult> {
  const rkey = existingRkey ?? generateTid();

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: NSID.Message,
    rkey,
    record: {
      $type: NSID.Message,
      room: input.roomUri,
      text: input.text,
      reply: input.reply,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    uri: response.data.uri,
    cid: response.data.cid,
    rkey,
  };
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
  } catch {
    // Record doesn't exist yet
    return [];
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

// -- Presence PDS helpers --

export async function getPresenceRecord(
  agent: Agent,
): Promise<{ visibleTo?: PresenceVisibility; awayMessage?: string } | null> {
  try {
    const response = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: NSID.Presence,
      rkey: 'self',
    });
    const record = response.data.value as {
      visibleTo?: PresenceVisibility;
      awayMessage?: string;
    };
    return record;
  } catch {
    return null;
  }
}

export async function putPresenceRecord(
  agent: Agent,
  status: PresenceStatus,
  opts?: { awayMessage?: string; visibleTo?: PresenceVisibility },
): Promise<{ uri: string; cid: string }> {
  const response = await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: NSID.Presence,
    rkey: 'self',
    record: {
      $type: NSID.Presence,
      status,
      visibleTo: opts?.visibleTo ?? 'everyone',
      awayMessage: opts?.awayMessage,
      updatedAt: new Date().toISOString(),
    },
  });

  return { uri: response.data.uri, cid: response.data.cid };
}

import type { Agent } from '@atproto/api';
import { NSID } from '@chatmosphere/shared';
import type { RoomPurpose, RoomVisibility } from '@chatmosphere/shared';

const TID_CHARS = '234567abcdefghijklmnopqrstuvwxyz';

let lastTimestamp = 0;
let clockId = 0;

/** Generate a TID (timestamp identifier) in ATProto format — base32-sortable, ~13 chars */
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
  replyTo?: string;
}

export interface CreateMessageResult {
  uri: string;
  cid: string;
  rkey: string;
}

export async function createMessageRecord(
  agent: Agent,
  input: CreateMessageInput,
): Promise<CreateMessageResult> {
  const rkey = generateTid();

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: NSID.Message,
    rkey,
    record: {
      $type: NSID.Message,
      room: input.roomUri,
      text: input.text,
      replyTo: input.replyTo,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    uri: response.data.uri,
    cid: response.data.cid,
    rkey,
  };
}

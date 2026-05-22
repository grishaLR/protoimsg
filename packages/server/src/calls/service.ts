import { randomUUID, randomBytes } from 'crypto';
import { RoomServiceClient } from 'livekit-server-sdk';
import { generateAnonymousToken } from './token.js';
import { createLogger } from '../logger.js';
import type { Sql } from '../db/client.js';
import { batchIsCommunityMember, batchIsInnerCircleMember } from '../community/queries.js';

const log = createLogger('group-calls');

export interface GroupCallParticipant {
  /** Random anonymous ID used in LiveKit (e.g. p_a8f3c9d2) */
  anonymousId: string;
  /** When this participant joined */
  joinedAt: number;
}

export type MeetAccess = 'anyone' | 'community' | 'inner-circle' | 'allowlist';

export interface GroupCall {
  callId: string;
  /** Chat room ID if this call is attached to a room, null for standalone meetings. */
  roomId: string | null;
  /** Short shareable code for standalone meetings (e.g. abc-defg-hij). */
  meetCode: string | null;
  /** LiveKit room name (prefixed to avoid collisions) */
  livekitRoom: string;
  /** DID → anonymous participant info. Ephemeral, never persisted. */
  participants: Map<string, GroupCallParticipant>;
  /** Who created the meeting (DID). Used for access control lookups. */
  creatorDid: string;
  /** Access control for standalone meetings. */
  access: MeetAccess;
  /** Specific DIDs allowed when access='allowlist'. */
  allowedDids: Set<string>;
  createdAt: number;
}

export interface GroupCallService {
  /** Create a new group call for a chat room. Returns the call and the creator's token. */
  createCall(roomId: string, creatorDid: string): Promise<{ call: GroupCall; token: string }>;
  /** Create a standalone meeting (not attached to any room). Returns the call and the creator's token. */
  createStandaloneCall(
    creatorDid: string,
    access?: MeetAccess,
    allowedDids?: string[],
  ): Promise<{ call: GroupCall; token: string }>;
  /** Join an existing group call. Returns the call and a fresh token. */
  joinCall(callId: string, did: string): Promise<{ call: GroupCall; token: string }>;
  /** Join by meet code. Returns the call and a fresh token. */
  joinByCode(meetCode: string, did: string): Promise<{ call: GroupCall; token: string }>;
  /** Remove a participant from a call. Returns the updated call, or null if the call ended. */
  leaveCall(callId: string, did: string): Promise<GroupCall | null>;
  /** Get the active call for a room, if any. */
  getCallForRoom(roomId: string): GroupCall | undefined;
  /** Get a call by ID. */
  getCall(callId: string): GroupCall | undefined;
  /** Remove a participant from all calls (disconnect cleanup). */
  removeFromAllCalls(
    did: string,
  ): Array<{ call: GroupCall | null; callId: string; roomId: string | null }>;
  /** Clean up stale calls (no participants for >5 min). */
  pruneStale(): void;
  /** LiveKit WebSocket URL for clients to connect to. */
  readonly livekitUrl: string;
}

/** How long an empty call lingers before being cleaned up. */
const STALE_CALL_TTL_MS = 5 * 60 * 1000;

/** Hard cap on participants per call — a defensive limit against abuse. */
const MAX_ROOM_PARTICIPANTS = 200;

export function createGroupCallService(
  livekitUrl: string,
  livekitApiKey: string,
  livekitApiSecret: string,
  sql: Sql,
): GroupCallService {
  /** All active calls. Key: callId. */
  const calls = new Map<string, GroupCall>();
  /** Reverse lookup: chatRoomId → callId (one active call per room). */
  const roomToCall = new Map<string, string>();
  /** Reverse lookup: meetCode → callId (standalone meetings). */
  const codeToCall = new Map<string, string>();

  // LiveKit Room Service client for creating/destroying rooms
  // Extract HTTP URL from WSS URL for the REST API
  // ws:// → http://, wss:// → https://
  const livekitHttpUrl = livekitUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const roomService = new RoomServiceClient(livekitHttpUrl, livekitApiKey, livekitApiSecret);

  function generateParticipantId(): string {
    return `p_${randomBytes(8).toString('hex')}`;
  }

  /** Generate a short human-readable meet code like "abc-defg-hij". */
  function generateMeetCode(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyz'; // no l, o (ambiguous)
    const pick = (n: number) => {
      const bytes = randomBytes(n);
      return Array.from(bytes, (b) => chars[b % chars.length]).join('');
    };
    return `${pick(3)}-${pick(4)}-${pick(3)}`;
  }

  async function generateToken(livekitRoom: string, participantId: string): Promise<string> {
    return await generateAnonymousToken(
      livekitApiKey,
      livekitApiSecret,
      livekitRoom,
      participantId,
    );
  }

  async function createCall(
    roomId: string,
    creatorDid: string,
  ): Promise<{ call: GroupCall; token: string }> {
    // Check if there's already an active call for this room
    const existingCallId = roomToCall.get(roomId);
    if (existingCallId) {
      const existing = calls.get(existingCallId);
      if (existing && existing.participants.size > 0) {
        // Room already has an active call — join it instead
        return joinCall(existingCallId, creatorDid);
      }
      // Stale call — clean it up
      calls.delete(existingCallId);
      roomToCall.delete(roomId);
    }

    const callId = randomUUID();
    const livekitRoom = `protoimsg_${callId}`;
    const anonymousId = generateParticipantId();

    // Create the LiveKit room
    try {
      await roomService.createRoom({
        name: livekitRoom,
        emptyTimeout: 300,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
      });
    } catch (err) {
      log.error({ err, callId, roomId }, 'Failed to create LiveKit room');
      throw new Error('Failed to create video call room');
    }

    const call: GroupCall = {
      callId,
      roomId,
      meetCode: null,
      livekitRoom,
      participants: new Map([[creatorDid, { anonymousId, joinedAt: Date.now() }]]),
      creatorDid,
      access: 'anyone',
      allowedDids: new Set(),
      createdAt: Date.now(),
    };

    calls.set(callId, call);
    roomToCall.set(roomId, callId);

    const token = await generateToken(livekitRoom, anonymousId);
    log.info({ callId, roomId, participantCount: 1 }, 'Group call created');

    return { call, token };
  }

  async function createStandaloneCall(
    creatorDid: string,
    access: MeetAccess = 'anyone',
    allowedDids: string[] = [],
  ): Promise<{ call: GroupCall; token: string }> {
    const callId = randomUUID();
    const livekitRoom = `protoimsg_${callId}`;
    const anonymousId = generateParticipantId();
    const meetCode = generateMeetCode();

    try {
      await roomService.createRoom({
        name: livekitRoom,
        emptyTimeout: 300,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
      });
    } catch (err) {
      log.error({ err, callId }, 'Failed to create LiveKit room for standalone call');
      throw new Error('Failed to create video call room');
    }

    const call: GroupCall = {
      callId,
      roomId: null,
      meetCode,
      livekitRoom,
      participants: new Map([[creatorDid, { anonymousId, joinedAt: Date.now() }]]),
      creatorDid,
      access,
      allowedDids: new Set(allowedDids),
      createdAt: Date.now(),
    };

    calls.set(callId, call);
    codeToCall.set(meetCode, callId);

    const token = await generateToken(livekitRoom, anonymousId);
    log.info({ callId, meetCode, participantCount: 1 }, 'Standalone meeting created');

    return { call, token };
  }

  async function joinByCode(
    meetCode: string,
    did: string,
  ): Promise<{ call: GroupCall; token: string }> {
    const callId = codeToCall.get(meetCode);
    if (!callId) throw new Error('Meeting not found');
    return joinCall(callId, did);
  }

  async function checkAccess(call: GroupCall, did: string): Promise<void> {
    // Creator always has access
    if (did === call.creatorDid) return;
    // Already in the call (rejoin/token refresh)
    if (call.participants.has(did)) return;

    switch (call.access) {
      case 'anyone':
        return;
      case 'community': {
        const members = await batchIsCommunityMember(sql, call.creatorDid, [did]);
        if (!members.has(did)) throw new Error('This meeting is restricted to community members');
        return;
      }
      case 'inner-circle': {
        const inner = await batchIsInnerCircleMember(sql, call.creatorDid, [did]);
        if (!inner.has(did)) throw new Error('This meeting is restricted to inner circle');
        return;
      }
      case 'allowlist': {
        if (!call.allowedDids.has(did))
          throw new Error('You are not on the invite list for this meeting');
        return;
      }
    }
  }

  async function joinCall(
    callId: string,
    did: string,
  ): Promise<{ call: GroupCall; token: string }> {
    const call = calls.get(callId);
    if (!call) throw new Error('Call not found');

    await checkAccess(call, did);

    // Already in the call? Generate a fresh token
    let participant = call.participants.get(did);
    if (!participant) {
      // Enforce the cap in our own authoritative state, not just LiveKit-side,
      // so an over-limit joiner gets a clean error instead of a stale Map entry.
      if (call.participants.size >= MAX_ROOM_PARTICIPANTS) {
        throw new Error('This meeting is full');
      }
      participant = { anonymousId: generateParticipantId(), joinedAt: Date.now() };
      call.participants.set(did, participant);
    }

    const token = await generateToken(call.livekitRoom, participant.anonymousId);
    log.info(
      { callId, roomId: call.roomId, participantCount: call.participants.size },
      'Participant joined group call',
    );

    return { call, token };
  }

  async function leaveCall(callId: string, did: string): Promise<GroupCall | null> {
    const call = calls.get(callId);
    if (!call) return null;

    call.participants.delete(did);
    log.info(
      { callId, roomId: call.roomId, participantCount: call.participants.size },
      'Participant left group call',
    );

    if (call.participants.size === 0) {
      // Last participant left — destroy the call
      calls.delete(callId);
      if (call.roomId) roomToCall.delete(call.roomId);
      if (call.meetCode) codeToCall.delete(call.meetCode);
      try {
        await roomService.deleteRoom(call.livekitRoom);
      } catch (err) {
        log.warn({ err, callId }, 'Failed to delete LiveKit room (may already be gone)');
      }
      log.info({ callId, roomId: call.roomId }, 'Group call ended (empty)');
      return null;
    }

    return call;
  }

  function getCallForRoom(roomId: string): GroupCall | undefined {
    const callId = roomToCall.get(roomId);
    return callId ? calls.get(callId) : undefined;
  }

  function getCall(callId: string): GroupCall | undefined {
    return calls.get(callId);
  }

  function removeFromAllCalls(
    did: string,
  ): Array<{ call: GroupCall | null; callId: string; roomId: string | null }> {
    const results: Array<{ call: GroupCall | null; callId: string; roomId: string | null }> = [];

    for (const [callId, call] of calls) {
      if (call.participants.has(did)) {
        const roomId = call.roomId;
        call.participants.delete(did);

        if (call.participants.size === 0) {
          calls.delete(callId);
          if (roomId) roomToCall.delete(roomId);
          if (call.meetCode) codeToCall.delete(call.meetCode);
          // Best-effort LiveKit cleanup (no await — we're in disconnect handler)
          roomService.deleteRoom(call.livekitRoom).catch((err: unknown) => {
            log.warn({ err, callId }, 'Failed to delete LiveKit room on disconnect');
          });
          results.push({ call: null, callId, roomId });
        } else {
          results.push({ call, callId, roomId });
        }
      }
    }

    return results;
  }

  function pruneStale(): void {
    const now = Date.now();
    for (const [callId, call] of calls) {
      if (call.participants.size === 0 && now - call.createdAt > STALE_CALL_TTL_MS) {
        calls.delete(callId);
        if (call.roomId) roomToCall.delete(call.roomId);
        if (call.meetCode) codeToCall.delete(call.meetCode);
        roomService.deleteRoom(call.livekitRoom).catch((err: unknown) => {
          log.warn({ err, callId }, 'Failed to delete stale LiveKit room');
        });
        log.info({ callId }, 'Pruned stale group call');
      }
    }
  }

  return {
    createCall,
    createStandaloneCall,
    joinCall,
    joinByCode,
    leaveCall,
    getCallForRoom,
    getCall,
    removeFromAllCalls,
    pruneStale,
    livekitUrl,
  };
}

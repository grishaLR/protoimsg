import { z } from 'zod';
import { LIMITS, BOT } from '@protoimsg/shared';
import type { IceCandidateInit } from '@protoimsg/shared';

const MAX_BLOCK_LIST_SIZE = 10_000;

const did = z.string().startsWith('did:');

const statusChange = z.object({
  type: z.literal('status_change'),
  status: z.enum(['online', 'away', 'idle']),
  awayMessage: z.string().max(LIMITS.maxAwayMessageLength).optional(),
  visibleTo: z.enum(['everyone', 'community', 'inner-circle', 'no-one']).optional(),
});

const ping = z.object({ type: z.literal('ping') });

const requestCommunityPresence = z.object({
  type: z.literal('request_community_presence'),
  dids: z.array(did).max(100),
});

const syncBlocks = z.object({
  type: z.literal('sync_blocks'),
  blockedDids: z.array(did).max(MAX_BLOCK_LIST_SIZE),
});

const syncCommunity = z.object({
  type: z.literal('sync_community'),
  groups: z
    .array(
      z.object({
        name: z.string().min(1),
        isInnerCircle: z.boolean().optional(),
        members: z
          .array(
            z.object({
              did,
              addedAt: z.string(),
            }),
          )
          .max(LIMITS.maxGroupMembers),
      }),
    )
    .max(LIMITS.maxBuddyGroups),
});

const dmOpen = z.object({
  type: z.literal('dm_open'),
  recipientDid: did,
});

const dmClose = z.object({
  type: z.literal('dm_close'),
  conversationId: z.string().min(1),
});

const dmReject = z.object({
  type: z.literal('dm_reject'),
  conversationId: z.string().min(1),
});

const callInit = z.object({
  type: z.literal('call_init'),
  recipientDid: did,
});

const makeCall = z.object({
  type: z.literal('make_call'),
  conversationId: z.string().min(1),
  offer: z.string().min(1).max(65_536),
});

const rejectCall = z.object({
  type: z.literal('reject_call'),
  conversationId: z.string().min(1),
});

const acceptCall = z.object({
  type: z.literal('accept_call'),
  conversationId: z.string().min(1),
  answer: z.string().min(1).max(65_536),
});

const candidateSchema: z.ZodType<IceCandidateInit> = z.object({
  candidate: z.string().max(2048),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

const newIceCandidate = z.object({
  type: z.literal('new_ice_candidate'),
  conversationId: z.string().min(1),
  candidate: candidateSchema,
});

const imOffer = z.object({
  type: z.literal('im_offer'),
  conversationId: z.string().min(1),
  offer: z.string().min(1).max(65_536),
});

const imAnswer = z.object({
  type: z.literal('im_answer'),
  conversationId: z.string().min(1),
  answer: z.string().min(1).max(65_536),
});

const imIceCandidate = z.object({
  type: z.literal('im_ice_candidate'),
  conversationId: z.string().min(1),
  candidate: candidateSchema,
});

const botDmOpen = z.object({ type: z.literal('bot_dm_open') });

const botDmSend = z.object({
  type: z.literal('bot_dm_send'),
  text: z.string().min(1).max(BOT.maxCommandLength),
});

const botDmClose = z.object({ type: z.literal('bot_dm_close') });

const groupCallCreateStandalone = z.object({
  type: z.literal('group_call_create_standalone'),
  access: z.enum(['anyone', 'community', 'inner-circle', 'allowlist']).optional(),
  allowedDids: z.array(did).max(150).optional(),
});

const groupCallJoin = z.object({
  type: z.literal('group_call_join'),
  callId: z.string().min(1),
});

const groupCallJoinByCode = z.object({
  type: z.literal('group_call_join_by_code'),
  meetCode: z.string().min(1).max(20),
});

const groupCallLeave = z.object({
  type: z.literal('group_call_leave'),
  callId: z.string().min(1),
});

const coord = z.number().finite().min(-1000).max(10_000);
const facing = z.number().int().min(0).max(3);

const townJoin = z.object({
  type: z.literal('town_join'),
  x: coord,
  y: coord,
  dir: facing,
});

const townMove = z.object({
  type: z.literal('town_move'),
  x: coord,
  y: coord,
  dir: facing,
});

const townChat = z.object({
  type: z.literal('town_chat'),
  text: z.string().trim().min(1).max(280),
});

const townLeave = z.object({ type: z.literal('town_leave') });

const clientMessage = z.discriminatedUnion('type', [
  statusChange,
  ping,
  requestCommunityPresence,
  syncBlocks,
  syncCommunity,
  dmOpen,
  dmClose,
  dmReject,
  imOffer,
  imAnswer,
  imIceCandidate,
  callInit,
  makeCall,
  rejectCall,
  acceptCall,
  newIceCandidate,
  botDmOpen,
  botDmSend,
  botDmClose,
  groupCallCreateStandalone,
  groupCallJoin,
  groupCallJoinByCode,
  groupCallLeave,
  townJoin,
  townMove,
  townChat,
  townLeave,
]);

export type ValidatedClientMessage = z.infer<typeof clientMessage>;

/** Parse and validate a raw WS message. Returns null if invalid. */
export function parseClientMessage(raw: unknown): ValidatedClientMessage | null {
  const result = clientMessage.safeParse(raw);
  return result.success ? result.data : null;
}

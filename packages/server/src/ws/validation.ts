import { z } from 'zod';
import { LIMITS } from '@protoimsg/shared';
import type { IceCandidateInit } from '@protoimsg/shared';

const MAX_BLOCK_LIST_SIZE = 10_000;

const did = z.string().startsWith('did:');

const joinRoom = z.object({
  type: z.literal('join_room'),
  roomId: z.string().min(1),
});

const leaveRoom = z.object({
  type: z.literal('leave_room'),
  roomId: z.string().min(1),
});

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

const channelTyping = z.object({
  type: z.literal('channel_typing'),
  roomId: z.string().min(1),
  channelId: z.string().min(1),
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

const notifyRecord = z.object({
  type: z.literal('notify_record'),
  uri: z.string().min(1),
  cid: z.string().min(1),
});

const clientMessage = z.discriminatedUnion('type', [
  joinRoom,
  leaveRoom,
  statusChange,
  ping,
  requestCommunityPresence,
  channelTyping,
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
  notifyRecord,
]);

export type ValidatedClientMessage = z.infer<typeof clientMessage>;

/** Parse and validate a raw WS message. Returns null if invalid. */
export function parseClientMessage(raw: unknown): ValidatedClientMessage | null {
  const result = clientMessage.safeParse(raw);
  return result.success ? result.data : null;
}

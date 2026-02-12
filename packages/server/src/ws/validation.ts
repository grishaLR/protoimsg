import { z } from 'zod';

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
  awayMessage: z.string().max(200).optional(),
  visibleTo: z.enum(['everyone', 'community', 'inner-circle', 'no-one']).optional(),
});

const ping = z.object({ type: z.literal('ping') });

const requestCommunityPresence = z.object({
  type: z.literal('request_community_presence'),
  dids: z.array(did).max(100),
});

const roomTyping = z.object({
  type: z.literal('room_typing'),
  roomId: z.string().min(1),
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
          .max(100),
      }),
    )
    .max(20),
});

const dmOpen = z.object({
  type: z.literal('dm_open'),
  recipientDid: did,
});

const dmClose = z.object({
  type: z.literal('dm_close'),
  conversationId: z.string().min(1),
});

const dmSend = z.object({
  type: z.literal('dm_send'),
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

const dmTyping = z.object({
  type: z.literal('dm_typing'),
  conversationId: z.string().min(1),
});

const dmTogglePersist = z.object({
  type: z.literal('dm_toggle_persist'),
  conversationId: z.string().min(1),
  persist: z.boolean(),
});

const clientMessage = z.discriminatedUnion('type', [
  joinRoom,
  leaveRoom,
  statusChange,
  ping,
  requestCommunityPresence,
  roomTyping,
  syncBlocks,
  syncCommunity,
  dmOpen,
  dmClose,
  dmSend,
  dmTyping,
  dmTogglePersist,
]);

export type ValidatedClientMessage = z.infer<typeof clientMessage>;

/** Parse and validate a raw WS message. Returns null if invalid. */
export function parseClientMessage(raw: unknown): ValidatedClientMessage | null {
  const result = clientMessage.safeParse(raw);
  return result.success ? result.data : null;
}

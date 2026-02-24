/**
 * Zod schemas for Jetstream record validation.
 * Mirrors lexicon types so malformed or adversarial records are skipped, not indexed.
 *
 * ATProto conventions:
 * - `knownValues` fields use z.string() (open set — future values must not be rejected)
 * - AT-URI and DID fields have format validation
 * - datetime fields use z.string().datetime()
 * - Facets and embeds are structurally typed but permissive for forward compatibility
 */
import { z } from 'zod';

// -- Format validators --

/** AT-URI: at://did/collection/rkey */
const atUri = z.string().regex(/^at:\/\//, 'Expected AT-URI');

/** Channel reference: AT-URI for user-created channels, synthetic:// for auto-created defaults */
const channelRef = z.string().min(1);

/** DID: did:method:identifier */
const did = z.string().regex(/^did:/, 'Expected DID');

/** ISO 8601 datetime */
const datetime = z.string().datetime({ offset: true });

// -- Facet schemas (structurally typed, permissive for unknown feature types) --

const byteSliceSchema = z.object({
  byteStart: z.number().int().min(0),
  byteEnd: z.number().int().min(0),
});

/**
 * Facet features must carry a `$type` discriminator per ATProto union convention.
 * We validate its presence but passthrough the rest for forward compatibility.
 */
const facetFeatureSchema = z.object({ $type: z.string() }).passthrough();

const richTextFacetSchema = z.object({
  index: byteSliceSchema,
  features: z.array(facetFeatureSchema),
});

// -- Embed schemas (union — passthrough for forward compatibility) --

const imageItemSchema = z
  .object({
    image: z.object({}).passthrough(), // blob ref
    alt: z.string().max(2000),
  })
  .passthrough();

const imageEmbedSchema = z
  .object({
    $type: z.literal('app.protoimsg.chat.message#imageEmbed').optional(),
    images: z.array(imageItemSchema).max(4),
  })
  .passthrough();

const videoEmbedSchema = z
  .object({
    $type: z.literal('app.protoimsg.chat.message#videoEmbed').optional(),
    video: z.object({}).passthrough(), // blob ref
  })
  .passthrough();

const externalEmbedSchema = z
  .object({
    $type: z.literal('app.protoimsg.chat.message#externalEmbed').optional(),
    uri: z.string(),
    title: z.string().max(300),
  })
  .passthrough();

const embedSchema = z.union([imageEmbedSchema, videoEmbedSchema, externalEmbedSchema]).optional();

// -- Room --

const roomSettings = z
  .object({
    visibility: z.string().optional(), // knownValues: public, unlisted, private
    minAccountAgeDays: z.number().int().min(0).optional(),
    slowModeSeconds: z.number().int().min(0).optional(),
    allowlistEnabled: z.boolean().optional(),
  })
  .optional();

export const roomRecordSchema = z
  .object({
    name: z.string().max(100),
    topic: z.string().max(200),
    description: z.string().max(500).optional(),
    purpose: z.string(), // knownValues: discussion, event, community, support
    category: z.string().max(50).optional(),
    createdAt: datetime,
    settings: roomSettings,
  })
  .passthrough();

// -- Channel --

export const channelRecordSchema = z
  .object({
    room: atUri,
    name: z.string().max(100),
    description: z.string().max(500).optional(),
    position: z.number().int().min(0).optional(),
    postPolicy: z.string().optional(), // knownValues: everyone, owner, moderators
    createdAt: datetime,
  })
  .passthrough();

// -- Message --

const replyRefSchema = z
  .object({
    root: atUri,
    parent: atUri,
  })
  .optional();

export const messageRecordSchema = z
  .object({
    channel: channelRef,
    text: z.string().max(3000),
    facets: z.array(richTextFacetSchema).optional(),
    reply: replyRefSchema,
    embed: embedSchema,
    createdAt: datetime,
  })
  .passthrough();

// -- Ban --

export const banRecordSchema = z
  .object({
    room: atUri,
    subject: did,
    reason: z.string().max(300).optional(),
    createdAt: datetime,
  })
  .passthrough();

// -- Role --

export const roleRecordSchema = z
  .object({
    room: atUri,
    subject: did,
    role: z.string(), // knownValues: moderator, owner
    createdAt: datetime,
  })
  .passthrough();

// -- Community --

const communityMemberSchema = z.object({
  did: did,
  addedAt: datetime,
});

const communityGroupSchema = z.object({
  name: z.string().max(100),
  isInnerCircle: z.boolean().optional(),
  members: z.array(communityMemberSchema).max(500),
});

export const communityRecordSchema = z
  .object({
    groups: z.array(communityGroupSchema).max(50),
  })
  .passthrough();

// -- Allowlist --

export const allowlistRecordSchema = z
  .object({
    room: atUri,
    subject: did,
    createdAt: datetime,
  })
  .passthrough();

// -- Presence --

export const presenceRecordSchema = z
  .object({
    status: z.string(), // knownValues: online, away, idle, offline, invisible
    visibleTo: z.string(), // knownValues: everyone, community, inner-circle, no-one
    awayMessage: z.string().max(300).optional(),
    updatedAt: datetime,
  })
  .passthrough();

// -- Poll --

export const pollRecordSchema = z
  .object({
    channel: channelRef,
    question: z.string().max(200),
    options: z.array(z.string().max(100)).min(2).max(10),
    allowMultiple: z.boolean().optional(),
    expiresAt: datetime.optional(),
    createdAt: datetime,
  })
  .passthrough();

// -- Vote --

export const voteRecordSchema = z
  .object({
    poll: atUri,
    selectedOptions: z.array(z.number().int().min(0)).max(10),
    createdAt: datetime,
  })
  .passthrough();

// -- Inferred types --

export type RoomRecordParsed = z.infer<typeof roomRecordSchema>;
export type ChannelRecordParsed = z.infer<typeof channelRecordSchema>;
export type MessageRecordParsed = z.infer<typeof messageRecordSchema>;
export type BanRecordParsed = z.infer<typeof banRecordSchema>;
export type RoleRecordParsed = z.infer<typeof roleRecordSchema>;
export type CommunityRecordParsed = z.infer<typeof communityRecordSchema>;
export type AllowlistRecordParsed = z.infer<typeof allowlistRecordSchema>;
export type PresenceRecordParsed = z.infer<typeof presenceRecordSchema>;
export type PollRecordParsed = z.infer<typeof pollRecordSchema>;
export type VoteRecordParsed = z.infer<typeof voteRecordSchema>;

/**
 * Zod schemas for Jetstream record validation.
 * Mirrors lexicon types so malformed or adversarial records are skipped, not indexed.
 */
import { z } from 'zod';

/** DID: did:method:identifier */
const did = z.string().regex(/^did:/, 'Expected DID');

/** ISO 8601 datetime */
const datetime = z.string().datetime({ offset: true });

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

// -- Inferred types --

export type CommunityRecordParsed = z.infer<typeof communityRecordSchema>;

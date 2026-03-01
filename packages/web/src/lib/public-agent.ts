import { Agent } from '@atproto/api';

/**
 * Unauthenticated Agent pointing at the public Bluesky appview.
 * Used for read-only bsky API calls that don't need auth, bypassing the PDS
 * proxy entirely. This avoids the PDS scope-audit bug where `include:`
 * permission-set scopes aren't expanded during fine-grained scope checking.
 *
 * Limitations: viewer-specific state (likes, follows, mutes) won't be
 * populated in responses. Write operations still use the authenticated agent.
 */
export const publicAgent = new Agent('https://public.api.bsky.app');

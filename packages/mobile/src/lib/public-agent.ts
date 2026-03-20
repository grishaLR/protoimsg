import { Agent } from '@atproto/api';

/**
 * Unauthenticated agent for public Bluesky API reads.
 * Avoids PDS scope-audit bugs where include: permission-set scopes
 * aren't expanded through the proxy.
 */
export const publicAgent = new Agent('https://public.api.bsky.app');

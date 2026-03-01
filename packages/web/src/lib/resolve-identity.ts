import type { Agent } from '@atproto/api';
import { publicAgent } from './public-agent';

/**
 * Resolve a DID or handle string to a DID.
 * If the input already starts with `did:`, returns it as-is.
 * Otherwise resolves via the public API (avoids PDS proxy scope bug).
 * An optional authenticated agent can be passed but is no longer required.
 */
export async function resolveDidOrHandle(_agent: Agent | null, input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.startsWith('did:')) return trimmed;

  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const res = await publicAgent.resolveHandle({ handle });
  return res.data.did;
}

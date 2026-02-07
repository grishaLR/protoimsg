import type { Agent } from '@atproto/api';

/**
 * Resolve a DID or handle string to a DID.
 * If the input already starts with `did:`, returns it as-is.
 * Otherwise, strips a leading `@` and resolves via the agent.
 */
export async function resolveDidOrHandle(agent: Agent, input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.startsWith('did:')) return trimmed;

  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const res = await agent.resolveHandle({ handle });
  return res.data.did;
}

import { fetchProfiles } from './profiles';

/** Simple in-memory cache so repeated notifications don't re-fetch */
const cache = new Map<string, string>();

function truncateDid(did: string): string {
  return did.length > 20 ? `${did.slice(0, 14)}...${did.slice(-4)}` : did;
}

/**
 * Resolve a DID to a human-readable name for native notifications.
 * Returns displayName, @handle, or truncated DID as fallback.
 * Never throws — always returns a string.
 */
export async function resolveDisplayName(did: string): Promise<string> {
  const cached = cache.get(did);
  if (cached) return cached;

  try {
    const profiles = await fetchProfiles([did]);
    const profile = profiles[0];
    if (profile) {
      const name = profile.displayName ?? `@${profile.handle}`;
      cache.set(did, name);
      return name;
    }
  } catch {
    // Network error — fall through to truncated DID
  }

  return truncateDid(did);
}

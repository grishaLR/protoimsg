/**
 * Resolve a DID to its PDS service endpoint.
 *
 * Used for cross-collection record reads — `com.atproto.repo.listRecords` is a
 * PDS endpoint, not an appview one, so we must talk to the user's PDS directly.
 */

interface DidDoc {
  alsoKnownAs?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

const PLC_DIRECTORY = 'https://plc.directory';

async function fetchDidDoc(did: string): Promise<DidDoc | null> {
  if (did.startsWith('did:plc:')) {
    const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    if (!res.ok) return null;
    return (await res.json()) as DidDoc;
  }
  if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length).split(':')[0];
    const res = await fetch(`https://${host}/.well-known/did.json`);
    if (!res.ok) return null;
    return (await res.json()) as DidDoc;
  }
  return null;
}

export async function resolvePdsForDid(did: string): Promise<string | null> {
  try {
    const doc = await fetchDidDoc(did);
    if (!doc?.service) return null;
    const svc = doc.service.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    return svc?.serviceEndpoint ?? null;
  } catch {
    return null;
  }
}

const BSKY_APPVIEW = 'https://public.api.bsky.app';

/**
 * Resolve a DID to a human-friendly name: the account's display name, falling
 * back to its handle. Uses the public Bluesky appview profile endpoint.
 */
export async function resolveDisplayNameForDid(did: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BSKY_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    );
    if (!res.ok) return null;
    const profile = (await res.json()) as { displayName?: string; handle?: string };
    const name = profile.displayName?.trim() || profile.handle?.trim();
    return name || null;
  } catch {
    return null;
  }
}

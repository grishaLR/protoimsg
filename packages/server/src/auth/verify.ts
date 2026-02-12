// DID Core: did:method:method-specific-id — allow any method (plc, web, key, etc.)
const DID_RE = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

export function isValidDid(did: string): boolean {
  return DID_RE.test(did);
}

interface ResolveHandleResponse {
  did: string;
}

export async function verifyDidHandle(
  did: string,
  handle: string,
  publicApiUrl: string,
): Promise<boolean> {
  if (!isValidDid(did)) return false;

  try {
    const url = `${publicApiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
    const res = await fetch(url);
    if (!res.ok) return false;

    const data = (await res.json()) as ResolveHandleResponse;
    return data.did === did;
  } catch {
    return false;
  }
}

// -- PDS endpoint resolution via DID document --

const PLC_DIRECTORY = 'https://plc.directory';

interface DidDocument {
  id: string;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

/** Resolve a DID to its ATProto PDS endpoint via the DID document. */
export async function resolvePdsEndpoint(did: string): Promise<string | null> {
  try {
    let didDoc: DidDocument;

    if (did.startsWith('did:plc:')) {
      const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
      if (!res.ok) return null;
      didDoc = (await res.json()) as DidDocument;
    } else if (did.startsWith('did:web:')) {
      const identifier = did.slice('did:web:'.length);
      const res = await fetch(`https://${identifier}/.well-known/did.json`);
      if (!res.ok) return null;
      didDoc = (await res.json()) as DidDocument;
    } else {
      return null;
    }

    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    return pdsService?.serviceEndpoint ?? null;
  } catch {
    return null;
  }
}

// -- Auth record verification --

const AUTH_VERIFY_COLLECTION = 'app.protoimsg.chat.authVerify';

interface GetRecordResponse {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

/**
 * Verify an auth challenge record exists on the user's PDS with the correct nonce.
 * The client writes this record after completing ATProto OAuth, proving they have
 * write access to the DID's repository.
 */
export async function verifyAuthRecord(did: string, nonce: string, rkey: string): Promise<boolean> {
  const pdsUrl = await resolvePdsEndpoint(did);
  if (!pdsUrl) return false;

  try {
    const url = `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(AUTH_VERIFY_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`;
    const res = await fetch(url);
    if (!res.ok) return false;

    const data = (await res.json()) as GetRecordResponse;
    return data.value.nonce === nonce;
  } catch {
    return false;
  }
}

import { lookup } from 'dns/promises';
import { USER_AGENT } from '@protoimsg/shared';

// DID Core: did:method:method-specific-id — allow any method (plc, web, key, etc.)
const DID_RE = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

export function isValidDid(did: string): boolean {
  return DID_RE.test(did);
}

// -- SSRF protection --

/**
 * Check if an IP address is in a private/reserved range.
 * Blocks: loopback, private RFC1918, link-local, multicast, cloud metadata.
 */
function isPrivateIp(ip: string): boolean {
  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
    // Safe: guarded by parts.length === 4 check above
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast + reserved
  }

  // IPv6 loopback and private
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80')) return true; // link-local

  return false;
}

/**
 * Validate that a hostname does not resolve to a private IP.
 * Returns true if safe to fetch, false if SSRF risk.
 */
async function isSafeHostname(hostname: string): Promise<boolean> {
  // Reject raw IP addresses in hostname position
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return !isPrivateIp(hostname);
  }

  try {
    const { address } = await lookup(hostname);
    return !isPrivateIp(address);
  } catch {
    return false; // DNS failure = reject
  }
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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
      const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) return null;
      didDoc = (await res.json()) as DidDocument;
    } else if (did.startsWith('did:web:')) {
      const identifier = did.slice('did:web:'.length);
      if (!(await isSafeHostname(identifier))) return null;
      const res = await fetch(`https://${identifier}/.well-known/did.json`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) return null;
      didDoc = (await res.json()) as DidDocument;
    } else {
      return null;
    }

    // Validate the PDS endpoint URL isn't pointing at a private IP
    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    const endpoint = pdsService?.serviceEndpoint ?? null;
    if (endpoint) {
      try {
        const pdsHostname = new URL(endpoint).hostname;
        if (!(await isSafeHostname(pdsHostname))) return null;
      } catch {
        return null;
      }
    }
    return endpoint;
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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return false;

    const data = (await res.json()) as GetRecordResponse;
    return data.value.nonce === nonce;
  } catch {
    return false;
  }
}

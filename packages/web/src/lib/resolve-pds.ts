/**
 * Resolve a DID to its PDS service endpoint.
 *
 * Used for cross-collection record reads — `com.atproto.repo.listRecords` is a
 * PDS endpoint, not an appview one, so we must talk to the user's PDS directly.
 */

interface DidDoc {
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

const PLC_DIRECTORY = 'https://plc.directory';

export async function resolvePdsForDid(did: string): Promise<string | null> {
  try {
    let doc: DidDoc | null = null;
    if (did.startsWith('did:plc:')) {
      const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
      if (!res.ok) return null;
      doc = (await res.json()) as DidDoc;
    } else if (did.startsWith('did:web:')) {
      const host = did.slice('did:web:'.length).split(':')[0];
      const res = await fetch(`https://${host}/.well-known/did.json`);
      if (!res.ok) return null;
      doc = (await res.json()) as DidDoc;
    }
    if (!doc?.service) return null;
    const svc = doc.service.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    return svc?.serviceEndpoint ?? null;
  } catch {
    return null;
  }
}

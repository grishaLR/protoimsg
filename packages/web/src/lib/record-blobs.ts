/**
 * Utilities for extracting image blobs out of arbitrary ATProto records and
 * resolving them to fetchable URLs via the user's PDS getBlob endpoint.
 */

interface BlobRef {
  cid: string;
  mimeType: string;
}

function isBlobRef(v: unknown): v is { $type: 'blob'; ref: { $link: string }; mimeType: string } {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.$type !== 'blob') return false;
  const ref = obj.ref as { $link?: unknown } | undefined;
  return typeof ref?.$link === 'string' && typeof obj.mimeType === 'string';
}

function collectBlobsByPrefix(value: unknown, prefix: string): BlobRef[] {
  const out: BlobRef[] = [];
  const seen = new Set<unknown>();
  function walk(v: unknown) {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (isBlobRef(v)) {
      if (v.mimeType.startsWith(prefix)) {
        out.push({ cid: v.ref.$link, mimeType: v.mimeType });
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    for (const x of Object.values(v as Record<string, unknown>)) walk(x);
  }
  walk(value);
  return out;
}

/** Walk a record value tree and collect every image blob in document order. */
export function collectImageBlobs(value: unknown): BlobRef[] {
  return collectBlobsByPrefix(value, 'image/');
}

/** Walk a record value tree and collect every audio blob in document order. */
export function collectAudioBlobs(value: unknown): BlobRef[] {
  return collectBlobsByPrefix(value, 'audio/');
}

export function blobUrl(pds: string, did: string, cid: string): string {
  const params = new URLSearchParams({ did, cid });
  return `${pds}/xrpc/com.atproto.sync.getBlob?${params}`;
}

/** Universal viewer URL for an at:// record. */
export function pdslsUrl(uri: string): string {
  return `https://pdsls.dev/${uri}`;
}

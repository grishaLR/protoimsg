/** Resolves DID creation dates from the PLC directory. Caches results with TTL. */

const PLC_DIRECTORY = 'https://plc.directory';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  date: Date;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

interface PlcAuditEntry {
  createdAt: string;
}

export async function getDidCreationDate(did: string): Promise<Date | null> {
  const entry = cache.get(did);
  if (entry) {
    if (Date.now() < entry.expiresAt) return entry.date;
    cache.delete(did);
  }

  // Only did:plc is supported via PLC directory
  if (!did.startsWith('did:plc:')) return null;

  try {
    const res = await fetch(`${PLC_DIRECTORY}/${did}/log/audit`);
    if (!res.ok) return null;

    const entries = (await res.json()) as PlcAuditEntry[];
    const first = entries[0];
    if (!first?.createdAt) return null;

    const date = new Date(first.createdAt);
    cache.set(did, { date, expiresAt: Date.now() + CACHE_TTL_MS });
    return date;
  } catch {
    return null;
  }
}

export function getAccountAgeDays(creationDate: Date): number {
  const now = Date.now();
  const diff = now - creationDate.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

import { createLogger } from '../logger.js';
import { resolvePdsEndpoint } from '../auth/verify.js';

const log = createLogger('town-blocks');

/**
 * Who a neighborhood owner has blocked, when the owner isn't connected.
 *
 * BlockService only knows block lists clients have synced, and forgets them
 * soon after the client leaves — but someone you blocked stays on your
 * community list (blocking a buddy doesn't remove them), so without this a
 * blocked person could walk into your neighborhood while you're away.
 * Blocks are public `app.bsky.graph.block` records, so we read them from the
 * owner's PDS and cache them. Unknown = blocked: no gate, no entry, until
 * the list has loaded.
 */
export interface OwnerBlocks {
  /** true/false once known; null while loading (callers fail closed). */
  blocks(owner: string, did: string): boolean | null;
  /** Start loading these owners' block lists (no-op for fresh entries). */
  prefetch(owners: Iterable<string>): void;
  /** A list finished loading — callers re-check gates and access. */
  onLoaded?: () => void;
}

export type BlockListFetcher = (owner: string) => Promise<Set<string>>;

interface Cached {
  blocked: Set<string> | null; // null = load failed
  at: number;
}

const FRESH_MS = 10 * 60_000;
const FAILED_RETRY_MS = 60_000;
const MAX_CONCURRENT = 4;
const MAX_CACHED = 5000;
// A user on hundreds of community lists shouldn't trigger hundreds of PDS
// reads at once; the rest load as their gates come into play.
const MAX_PREFETCH = 64;

export class CachedOwnerBlocks implements OwnerBlocks {
  private cache = new Map<string, Cached>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private running = 0;
  onLoaded?: () => void;

  constructor(private fetchList: BlockListFetcher = fetchPublicBlockList) {}

  blocks(owner: string, did: string): boolean | null {
    const c = this.cache.get(owner);
    if (!c?.blocked) return null;
    return c.blocked.has(did);
  }

  prefetch(owners: Iterable<string>): void {
    let added = 0;
    const now = Date.now();
    for (const owner of owners) {
      if (added >= MAX_PREFETCH) break;
      const c = this.cache.get(owner);
      const fresh = c && now - c.at < (c.blocked ? FRESH_MS : FAILED_RETRY_MS);
      if (fresh || this.queued.has(owner)) continue;
      this.queued.add(owner);
      this.queue.push(owner);
      added++;
    }
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const owner = this.queue.shift();
      if (owner === undefined) break;
      this.running++;
      void this.fetchList(owner)
        .then(
          (blocked) => ({ blocked, at: Date.now() }),
          (err: unknown) => {
            log.warn({ err, owner }, 'Could not load block list; their gate stays closed');
            return { blocked: null, at: Date.now() };
          },
        )
        .then((entry) => {
          // Keep any previous good list over a failed refresh.
          const prev = this.cache.get(owner);
          this.cache.set(
            owner,
            entry.blocked || !prev?.blocked ? entry : { ...prev, at: entry.at },
          );
          if (this.cache.size > MAX_CACHED) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
          }
          this.onLoaded?.();
        })
        .finally(() => {
          this.queued.delete(owner);
          this.running--;
          this.pump();
        });
    }
  }
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_PAGES = 50; // 5000 blocks

/** Read every `app.bsky.graph.block` subject from `owner`'s PDS. */
export async function fetchPublicBlockList(owner: string): Promise<Set<string>> {
  const pds = await resolvePdsEndpoint(owner);
  if (!pds) throw new Error('No PDS for DID');
  const blocked = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', pds);
    url.searchParams.set('repo', owner);
    url.searchParams.set('collection', 'app.bsky.graph.block');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`listRecords ${String(res.status)}`);
    const body = (await res.json()) as {
      records?: Array<{ value?: { subject?: unknown } }>;
      cursor?: string;
    };
    for (const r of body.records ?? []) {
      if (typeof r.value?.subject === 'string') blocked.add(r.value.subject);
    }
    if (!body.cursor || (body.records ?? []).length === 0) return blocked;
    cursor = body.cursor;
  }
  // Too many to read: a partial list could miss the one that matters.
  throw new Error('Block list too long to load');
}

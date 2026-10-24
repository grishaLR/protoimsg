import {
  TOWN_DEFAULT_LAYOUT,
  TOWN_LAYOUT_COLLECTION,
  validateTownLayout,
  type TownPlacement,
  type TownSpace,
} from '@protoimsg/shared';
import type { Sql } from '../db/client.js';
import { resolvePdsEndpoint } from '../auth/verify.js';
import { createLogger } from '../logger.js';
import { deleteTownLayout, getTownLayout, upsertTownLayout } from './queries.js';

const log = createLogger('town-layouts');

/**
 * Designed spaces (`app.protoimsg.town.layout` records), validated and cached
 * so a scene can be sent synchronously. The record in its owner's repo is
 * the truth; Postgres indexes it (from Jetstream, or straight from the PDS
 * when the owner saves) and this caches what's in use.
 */
export interface TownLayouts {
  /** What to show for `owner`'s space: their layout if known, else the default. */
  get(owner: string, space: TownSpace): TownPlacement[];
  /** Make sure `owner`'s layout is cached before their space is shown. */
  load(owner: string, space: TownSpace): Promise<void>;
  /** A record arrived (firehose): validate, index, cache. `null` = deleted. */
  apply(owner: string, space: TownSpace, record: unknown, cid: string | null): Promise<void>;
  /** The owner just saved: read their record from their own PDS now. */
  refresh(owner: string, space: TownSpace): Promise<void>;
  /** Called after a cached layout changes, so open scenes can redraw. */
  onChange?: (owner: string, space: TownSpace) => void;
}

/** Only defaults: every space looks the same (tests, no database). */
export function defaultTownLayouts(): TownLayouts {
  return {
    get: (_owner, space) => TOWN_DEFAULT_LAYOUT[space],
    load: () => Promise.resolve(),
    apply: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
  };
}

const MAX_CACHED = 5000;
const FETCH_TIMEOUT_MS = 5000;
// A layout record is a few KB at most; never buffer a hostile PDS's stream.
const MAX_RECORD_BYTES = 64 * 1024;
// A record dated far ahead would block its owner's own later saves; trust
// the owner's clock only this far.
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** The placements a record may show in `space` (wrong space, malformed → none). */
export function placementsFromRecord(space: TownSpace, record: unknown): TownPlacement[] {
  if (!record || typeof record !== 'object') return [];
  const r = record as { space?: unknown; placements?: unknown };
  if (r.space !== space) return [];
  return validateTownLayout(space, r.placements);
}

/** When the owner says they saved it (clamped), for ordering writes. */
export function recordTime(record: unknown, now = Date.now()): Date {
  const raw = (record as { updatedAt?: unknown } | null)?.updatedAt;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return new Date(Number.isFinite(t) ? Math.min(t, now + MAX_CLOCK_SKEW_MS) : now);
}

export type LayoutFetcher = (
  owner: string,
  space: TownSpace,
) => Promise<{ record: unknown; cid: string | null } | null>;

export class IndexedTownLayouts implements TownLayouts {
  /** `${did}|${space}` → validated placements (null = never designed). */
  private cache = new Map<string, TownPlacement[] | null>();
  /** Keys being loaded in the background (someone was shown the default). */
  private loading = new Set<string>();
  /** Refreshes per key: one in flight, plus at most one more after it. */
  private refreshing = new Map<string, { again: boolean; done: Promise<void> }>();
  onChange?: (owner: string, space: TownSpace) => void;

  constructor(
    private sql: Sql,
    private fetchRecord: LayoutFetcher = fetchLayoutRecord,
  ) {}

  /**
   * What to show now. A space nobody has loaded (someone was moved into it
   * by the server, not by joining) shows the default while it loads, then
   * redraws through onChange.
   */
  get(owner: string, space: TownSpace): TownPlacement[] {
    const k = cacheKey(owner, space);
    if (!this.cache.has(k) && !this.loading.has(k)) {
      this.loading.add(k);
      void this.load(owner, space).finally(() => {
        this.loading.delete(k);
        if (this.cache.get(k)) this.onChange?.(owner, space);
      });
    }
    return this.cache.get(k) ?? TOWN_DEFAULT_LAYOUT[space];
  }

  async load(owner: string, space: TownSpace): Promise<void> {
    const k = cacheKey(owner, space);
    if (this.cache.has(k)) return;
    try {
      const stored = await getTownLayout(this.sql, owner, space);
      // A save landed while we read: it's newer than what we read.
      if (this.cache.has(k)) return;
      // Re-validate on the way out too: the rules may have changed since.
      this.remember(k, stored ? validateTownLayout(space, stored) : null);
    } catch (err) {
      log.error({ err, owner, space }, 'Could not load a town layout; showing the default');
    }
  }

  async apply(owner: string, space: TownSpace, record: unknown, cid: string | null): Promise<void> {
    // A record for the other space (or not a layout at all) isn't a design
    // of this one: show the default rather than an empty room.
    if ((record as { space?: unknown } | null)?.space !== space) record = null;
    if (record === null) {
      await deleteTownLayout(this.sql, owner, space);
      this.update(owner, space, null);
      return;
    }
    const placements = placementsFromRecord(space, record);
    const updatedAt = recordTime(record);
    // Older than what's stored (a late firehose event): keep the newer one.
    if (!(await upsertTownLayout(this.sql, { did: owner, space, placements, cid, updatedAt }))) {
      return;
    }
    this.update(owner, space, placements);
  }

  /**
   * Saves come in bursts: never more than one read of the owner's PDS at a
   * time per space, and one trailing read so the last save is always seen.
   */
  refresh(owner: string, space: TownSpace): Promise<void> {
    const k = cacheKey(owner, space);
    const running = this.refreshing.get(k);
    if (running) {
      running.again = true;
      return running.done;
    }
    const entry = { again: false, done: Promise.resolve() };
    // Set by other calls while a read is in flight (not visible to narrowing).
    const again = (): boolean => entry.again;
    entry.done = (async () => {
      try {
        do {
          entry.again = false;
          const fetched = await this.fetchRecord(owner, space);
          await this.apply(owner, space, fetched ? fetched.record : null, fetched?.cid ?? null);
        } while (again());
      } finally {
        this.refreshing.delete(k);
      }
    })();
    this.refreshing.set(k, entry);
    return entry.done;
  }

  private update(owner: string, space: TownSpace, placements: TownPlacement[] | null): void {
    this.remember(cacheKey(owner, space), placements);
    this.onChange?.(owner, space);
  }

  private remember(k: string, placements: TownPlacement[] | null): void {
    this.cache.delete(k);
    this.cache.set(k, placements);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}

function cacheKey(owner: string, space: TownSpace): string {
  return `${owner}|${space}`;
}

/** Read a response body as JSON, refusing anything larger than `max` bytes. */
async function readJsonCapped(res: Response, max: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Error('Record too large');
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('Record too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/**
 * Read `owner`'s layout record straight from their PDS (public). `null` =
 * there is none; throws on anything else (the caller keeps what it has).
 * No redirects: the PDS host was checked, wherever it points next was not.
 */
async function fetchLayoutRecord(
  owner: string,
  space: TownSpace,
): Promise<{ record: unknown; cid: string | null } | null> {
  const pds = await resolvePdsEndpoint(owner);
  if (!pds) throw new Error('No PDS for DID');
  const url = new URL('/xrpc/com.atproto.repo.getRecord', pds);
  url.searchParams.set('repo', owner);
  url.searchParams.set('collection', TOWN_LAYOUT_COLLECTION);
  url.searchParams.set('rkey', space);
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  const body = (await readJsonCapped(res, MAX_RECORD_BYTES)) as {
    value?: unknown;
    cid?: string;
    error?: string;
  } | null;
  // 400 also means a deactivated or taken-down repo: only a missing record
  // counts as "deleted".
  if (res.status === 400 && body?.error === 'RecordNotFound') return null;
  if (!res.ok) throw new Error(`getRecord ${String(res.status)}`);
  return { record: body?.value ?? null, cid: body?.cid ?? null };
}

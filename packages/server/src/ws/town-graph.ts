import { createLogger } from '../logger.js';

const log = createLogger('town-graph');

/**
 * Community relationships proto town needs, for people currently in town:
 * whose neighborhood you may enter, who your mutuals are, and who's a friend
 * of a friend. Synchronous reads over a cache so TownRoom's view and voice
 * ticks stay cheap; everything fails closed — someone not loaded has no
 * gates, no mutuals and no friends of friends.
 */
export interface TownGraph {
  /**
   * Load (or share) `did`'s relationships while they're in town. False if
   * loading failed — the caller holds no reference and must not release.
   */
  acquire(did: string): Promise<boolean>;
  /** One reference to `did` let go; dropped from the cache at zero. */
  release(did: string): void;
  /** Owners whose community includes `did` — the neighborhoods `did` may enter. */
  gatesFor(did: string): ReadonlySet<string>;
  /**
   * Each lists the other in their community (any group). Both people's
   * entries must agree, so a stale one fails closed and the answer is
   * symmetric — it feeds visibility and voice, which must be.
   */
  mutual(a: string, b: string): boolean;
  /** Mutuals, or sharing at least one mutual (two steps on the mutual graph). */
  friendOfFriend(a: string, b: string): boolean;
  /** `did` is in `owner`'s inner circle (`did` must be loaded). */
  inInnerCircle(owner: string, did: string): boolean;
  /**
   * `owner` synced their community list: `members` is everyone in it,
   * `innerCircle` the subset in inner-circle groups.
   */
  communityChanged?(owner: string, members: Iterable<string>, innerCircle: Iterable<string>): void;
  /** Called whenever relationships change, so the town can re-check everyone. */
  onChange?: () => void;
}

/** Reads a graph with no data: nobody is anybody's mutual. */
export const EMPTY_TOWN_GRAPH: TownGraph = {
  acquire: () => Promise.resolve(true),
  release: () => {},
  gatesFor: () => new Set(),
  mutual: () => false,
  friendOfFriend: () => false,
  inInnerCircle: () => false,
};

export interface TownGraphLoader {
  /** Everyone in `did`'s community. */
  loadMembers(did: string): Promise<Set<string>>;
  /** Everyone whose community includes `did`. */
  loadOwners(did: string): Promise<Set<string>>;
  /** Which of `owners` have `did` in their inner circle. */
  loadInnerOwners(did: string, owners: Set<string>): Promise<Set<string>>;
}

interface Entry {
  refs: number;
  /** In my community. */
  out: Set<string>;
  /** Have me in theirs. */
  in: Set<string>;
  /** out ∩ in. */
  mutuals: Set<string>;
  /** Owners whose inner circle includes me (⊆ in). */
  innerOf: Set<string>;
}

// Safety net for community changes that reach the database without telling
// us (the WebSocket and firehose paths call communityChanged directly).
const REFRESH_MS = 60_000;

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<string>();
  for (const x of small) if (big.has(x)) out.add(x);
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export class CommunityTownGraph implements TownGraph {
  private entries = new Map<string, Entry>();
  /** In-flight loads, so two tabs joining at once share one query pair. */
  private loading = new Map<string, Promise<Entry | null>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  /**
   * Bumped on every communityChanged. A load that was in flight across a
   * bump may predate that change, so it's discarded (or redone) rather than
   * written over the patch — otherwise a removed gate could come back.
   */
  private generation = 0;
  onChange?: () => void;

  constructor(private loader: TownGraphLoader) {
    this.refreshTimer = setInterval(() => {
      if (this.refreshing) return;
      this.refreshing = true;
      this.refreshAll()
        .catch((err: unknown) => {
          log.error({ err }, 'Town relationship refresh failed');
        })
        .finally(() => {
          this.refreshing = false;
        });
    }, REFRESH_MS);
    this.refreshTimer.unref();
  }

  async acquire(did: string): Promise<boolean> {
    const existing = this.entries.get(did);
    if (existing) {
      existing.refs++;
      return true;
    }
    let pending = this.loading.get(did);
    if (!pending) {
      pending = this.loadFresh(did);
      this.loading.set(did, pending);
    }
    const entry = await pending;
    if (this.loading.get(did) === pending) this.loading.delete(did);
    if (!entry) return false; // failed to load: stays unknown (fails closed)
    const raced = this.entries.get(did);
    if (raced) raced.refs++;
    else {
      entry.refs = 1;
      this.entries.set(did, entry);
    }
    return true;
  }

  release(did: string): void {
    const e = this.entries.get(did);
    if (!e) return;
    e.refs--;
    if (e.refs <= 0) this.entries.delete(did);
  }

  gatesFor(did: string): ReadonlySet<string> {
    return this.entries.get(did)?.in ?? new Set();
  }

  mutual(a: string, b: string): boolean {
    const ea = this.entries.get(a);
    const eb = this.entries.get(b);
    return !!ea && !!eb && ea.mutuals.has(b) && eb.mutuals.has(a);
  }

  inInnerCircle(owner: string, did: string): boolean {
    return this.entries.get(did)?.innerOf.has(owner) ?? false;
  }

  friendOfFriend(a: string, b: string): boolean {
    const ea = this.entries.get(a);
    const eb = this.entries.get(b);
    if (!ea || !eb) return false;
    if (ea.mutuals.has(b) && eb.mutuals.has(a)) return true;
    const [small, big] = ea.mutuals.size <= eb.mutuals.size ? [ea, eb] : [eb, ea];
    for (const c of small.mutuals) if (big.mutuals.has(c)) return true;
    return false;
  }

  /**
   * `owner` synced their community list. Patch everyone in town it touches —
   * the owner's own list, and the reverse side for each loaded member — with
   * no extra queries.
   */
  communityChanged(owner: string, members: Iterable<string>, innerCircle: Iterable<string>): void {
    this.generation++;
    const next = new Set(members);
    const inner = new Set(innerCircle);
    let changed = false;
    const own = this.entries.get(owner);
    if (own && !sameSet(own.out, next)) {
      own.out = next;
      own.mutuals = intersect(own.out, own.in);
      changed = true;
    }
    for (const [did, e] of this.entries) {
      if (did === owner) continue;
      const listed = next.has(did);
      const close = listed && inner.has(did);
      if (close !== e.innerOf.has(owner)) {
        if (close) e.innerOf.add(owner);
        else e.innerOf.delete(owner);
        changed = true;
      }
      if (listed === e.in.has(owner)) continue;
      if (listed) e.in.add(owner);
      else e.in.delete(owner);
      e.mutuals = intersect(e.out, e.in);
      changed = true;
    }
    // Nobody in town affected (the usual case for a sync from outside town):
    // no need to re-check the whole town.
    if (changed) this.onChange?.();
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /**
   * Load, redoing it (a few times) if a community change landed while the
   * queries were in flight — the result might not include it.
   */
  private async loadFresh(did: string): Promise<Entry | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const gen = this.generation;
      const entry = await this.load(did);
      if (!entry || gen === this.generation) return entry;
    }
    return null; // churning: stay unknown (fails closed) until the next join/refresh
  }

  private async load(did: string): Promise<Entry | null> {
    try {
      const [out, inn] = await Promise.all([
        this.loader.loadMembers(did),
        this.loader.loadOwners(did),
      ]);
      const innerOf =
        inn.size > 0 ? await this.loader.loadInnerOwners(did, inn) : new Set<string>();
      return { refs: 0, out, in: inn, mutuals: intersect(out, inn), innerOf };
    } catch (err) {
      log.error({ err, did }, 'Failed to load town relationships');
      return null;
    }
  }

  private async refreshAll(): Promise<void> {
    let changed = false;
    for (const did of [...this.entries.keys()]) {
      const gen = this.generation;
      const fresh = await this.load(did);
      const cur = this.entries.get(did);
      // A change landed mid-query: the live patch is newer than this result.
      if (!fresh || !cur || gen !== this.generation) continue;
      if (
        sameSet(fresh.out, cur.out) &&
        sameSet(fresh.in, cur.in) &&
        sameSet(fresh.innerOf, cur.innerOf)
      ) {
        continue;
      }
      cur.out = fresh.out;
      cur.in = fresh.in;
      cur.mutuals = fresh.mutuals;
      cur.innerOf = fresh.innerOf;
      changed = true;
    }
    if (changed) this.onChange?.();
  }
}

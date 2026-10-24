import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { TOWN_LAYOUT_COLLECTION } from '@protoimsg/shared';
import type { ClientMessage, TownPlacement, TownSpace } from '@protoimsg/shared';

/** Quiet time after the last edit before it's written to your repo. */
const SAVE_DELAY_MS = 1200;
/** After a failed save, try again on its own: 5s, 15s, 45s, then every 2 min. */
const RETRY_MS = [5000, 15_000, 45_000, 120_000];

export type LayoutSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Your record can be written with this session's permissions. */
export function canSaveLayouts(grantedScopes: readonly string[]): boolean {
  const scope = `repo:${TOWN_LAYOUT_COLLECTION}`;
  return grantedScopes.some((s) => s === scope || s.startsWith(`${scope}?`));
}

/**
 * Saves your designs as `app.protoimsg.town.layout` records in your own repo
 * (record key = the space), a moment after you stop editing. Once a save
 * lands, the server is told to re-read it so everyone there sees it at once
 * (Jetstream would bring it too, just later). One write at a time; edits
 * made while one is in flight are saved right after it. A failed save keeps
 * its design and retries on its own, so leaving build mode never loses it.
 */
export function useLayoutSaver(
  agent: Agent | null,
  did: string | null,
  send: (msg: ClientMessage) => void,
) {
  const [status, setStatus] = useState<LayoutSaveStatus>('idle');
  const pending = useRef(new Map<TownSpace, TownPlacement[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const live = useRef({ agent, did, send });
  live.current = { agent, did, send };

  const drain = useCallback(async (): Promise<void> => {
    if (inFlight.current || pending.current.size === 0) return;
    const { agent: a, did: repo } = live.current;
    if (!a || !repo) return;
    inFlight.current = true;
    setStatus('saving');
    let failed = false;
    while (pending.current.size > 0) {
      const [space, placements] = pending.current.entries().next().value as [
        TownSpace,
        TownPlacement[],
      ];
      pending.current.delete(space);
      try {
        await a.com.atproto.repo.putRecord({
          repo,
          collection: TOWN_LAYOUT_COLLECTION,
          rkey: space,
          record: {
            $type: TOWN_LAYOUT_COLLECTION,
            space,
            placements,
            updatedAt: new Date().toISOString(),
          },
        });
        live.current.send({ type: 'town_layout_saved', space });
      } catch {
        // Keep it for the next edit (or flush) unless something newer came in.
        if (!pending.current.has(space)) pending.current.set(space, placements);
        failed = true;
        break;
      }
    }
    inFlight.current = false;
    setStatus(failed ? 'error' : 'saved');
    if (!failed) {
      failures.current = 0;
      return;
    }
    const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)] ?? SAVE_DELAY_MS;
    failures.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void drain();
    }, wait);
  }, []);

  /** A design is waiting or being written (its echo from the server is stale). */
  const busy = useCallback(
    () => pending.current.size > 0 || inFlight.current || timer.current !== null,
    [],
  );

  /** The unsaved design for a space, if a save hasn't landed yet. */
  const pendingFor = useCallback(
    (space: TownSpace): TownPlacement[] | undefined => pending.current.get(space),
    [],
  );

  /** Save now whatever is waiting (leaving build mode, leaving the page). */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void drain();
  }, [drain]);

  /** Your latest design for a space; written after a quiet moment. */
  const queue = useCallback(
    (space: TownSpace, placements: TownPlacement[]) => {
      pending.current.set(space, placements);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void drain();
      }, SAVE_DELAY_MS);
    },
    [drain],
  );

  // Another account: what was waiting belonged to the last one.
  useEffect(() => {
    pending.current.clear();
    failures.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStatus('idle');
  }, [did]);

  // Leaving the page: write now (the debounce would never fire), and ask
  // before closing while a write is still waiting.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onUnload = (e: BeforeUnloadEvent): void => {
      if (!busy()) return;
      flush();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flush, busy]);

  // Unmounting with edits waiting: write them rather than lose them.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void drain();
    },
    [drain],
  );

  return { status, queue, flush, busy, pendingFor };
}

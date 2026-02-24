import { createContext, useCallback, useContext, useRef, useMemo, type ReactNode } from 'react';

interface ActiveVideoContextValue {
  /** Request this video to become the active one; pauses the previous active video. */
  requestActive: (id: string) => void;
  /** Release active status (e.g. on pause or unmount). */
  releaseActive: (id: string) => void;
  /** Register a pause callback for a given video id. Returns an unsubscribe function. */
  onPauseRequest: (id: string, cb: () => void) => () => void;
}

const ActiveVideoContext = createContext<ActiveVideoContextValue | null>(null);

export function ActiveVideoProvider({ children }: { children: ReactNode }) {
  const activeIdRef = useRef<string | null>(null);
  const callbacksRef = useRef(new Map<string, Set<() => void>>());

  const requestActive = useCallback((id: string) => {
    const prev = activeIdRef.current;
    if (prev && prev !== id) {
      // Fire pause callbacks for the previous active video
      const cbs = callbacksRef.current.get(prev);
      if (cbs) {
        for (const cb of cbs) cb();
      }
    }
    activeIdRef.current = id;
  }, []);

  const releaseActive = useCallback((id: string) => {
    if (activeIdRef.current === id) {
      activeIdRef.current = null;
    }
  }, []);

  const onPauseRequest = useCallback((id: string, cb: () => void) => {
    const map = callbacksRef.current;
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    set.add(cb);

    return () => {
      set.delete(cb);
      if (set.size === 0) map.delete(id);
    };
  }, []);

  const value = useMemo<ActiveVideoContextValue>(
    () => ({ requestActive, releaseActive, onPauseRequest }),
    [requestActive, releaseActive, onPauseRequest],
  );

  return <ActiveVideoContext.Provider value={value}>{children}</ActiveVideoContext.Provider>;
}

export function useActiveVideo(): ActiveVideoContextValue {
  const ctx = useContext(ActiveVideoContext);
  if (!ctx) throw new Error('useActiveVideo must be used within ActiveVideoProvider');
  return ctx;
}

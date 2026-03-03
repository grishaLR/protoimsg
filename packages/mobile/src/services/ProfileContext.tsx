import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { fetchProfiles, type ProfileInfo } from './profiles';

export type { ProfileInfo };

interface ProfileContextValue {
  getProfile: (did: string) => ProfileInfo | undefined;
  requestProfile: (did: string) => void;
  subscribe: (cb: () => void) => () => void;
  getVersion: () => number;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

const DEBOUNCE_MS = 50;

export function ProfileProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, ProfileInfo>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(0);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    versionRef.current++;
    for (const cb of listenersRef.current) cb();
  }, []);

  const flush = useCallback(async () => {
    const dids = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (dids.length === 0) return;

    try {
      const profiles = await fetchProfiles(dids);
      for (const profile of profiles) {
        cacheRef.current.set(profile.did, profile);
      }
      notify();
    } catch (err) {
      console.error('Profile fetch failed:', err);
    }
  }, [notify]);

  const requestProfile = useCallback(
    (did: string) => {
      if (cacheRef.current.has(did) || pendingRef.current.has(did)) return;
      pendingRef.current.add(did);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  const getProfile = useCallback((did: string): ProfileInfo | undefined => {
    return cacheRef.current.get(did);
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getVersion = useCallback(() => versionRef.current, []);

  const value = useMemo<ProfileContextValue>(
    () => ({ getProfile, requestProfile, subscribe, getVersion }),
    [getProfile, requestProfile, subscribe, getVersion],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/** Returns getProfile(did) for batch lookups without subscribing to a specific DID */
export function useProfileLookup(): (did: string) => ProfileInfo | undefined {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfileLookup must be used within ProfileProvider');
  useSyncExternalStore(ctx.subscribe, ctx.getVersion);
  return ctx.getProfile;
}

export function useProfile(did: string | null | undefined): ProfileInfo | undefined {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');

  useSyncExternalStore(ctx.subscribe, ctx.getVersion);

  const profile = did ? ctx.getProfile(did) : undefined;

  useEffect(() => {
    if (did && !ctx.getProfile(did)) {
      ctx.requestProfile(did);
    }
  }, [did, ctx]);

  return profile;
}

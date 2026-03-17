import { useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient } from '@tanstack/react-query';
import {
  PersistQueryClientProvider,
  type PersistQueryClientProviderProps,
} from '@tanstack/react-query-persist-client';
import { storage } from '@/services/storage';

// MMKV-backed storage adapter for TanStack Query persister.
// MMKV is synchronous but the persister API expects async — wrap in Promise.resolve.
const mmkvPersistStorage = {
  getItem: (key: string) => {
    const value = storage.getString(key);
    return Promise.resolve(value ?? null);
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    storage.delete(key);
    return Promise.resolve();
  },
};

// Track app focus state for TanStack Query
focusManager.setEventListener((_onFocus) => {
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
  return () => {
    subscription.remove();
  };
});

/** Root key for queries that should be persisted to disk */
export const PERSISTED_QUERY_ROOT = 'persisted';

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        structuralSharing: false,
        retry: false,
      },
    },
  });

const dehydrateOptions: PersistQueryClientProviderProps['persistOptions']['dehydrateOptions'] = {
  shouldDehydrateMutation: () => false,
  shouldDehydrateQuery: (query) => {
    return String(query.queryKey[0]) === PERSISTED_QUERY_ROOT;
  },
};

/**
 * QueryProvider with per-user cache isolation and MMKV disk persistence.
 * Key by DID so switching accounts never leaks cached data.
 */
export function QueryProvider({
  children,
  currentDid,
}: {
  children: ReactNode;
  currentDid: string | undefined;
}) {
  return (
    <QueryProviderInner key={currentDid} currentDid={currentDid}>
      {children}
    </QueryProviderInner>
  );
}

function QueryProviderInner({
  children,
  currentDid,
}: {
  children: ReactNode;
  currentDid: string | undefined;
}) {
  const initialDid = useRef(currentDid);
  if (currentDid !== initialDid.current) {
    throw new Error('QueryProvider DID changed without remount — check key prop');
  }

  const [queryClient] = useState(() => createQueryClient());
  const [persistOptions] = useState(() => {
    const asyncPersister = createAsyncStoragePersister({
      storage: mmkvPersistStorage,
      key: `queryClient-${currentDid ?? 'logged-out'}`,
    });
    return {
      persister: asyncPersister,
      dehydrateOptions,
    };
  });

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}

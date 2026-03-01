import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useBlockSync } from '../hooks/useBlockSync';
import { useAuth } from '../hooks/useAuth';

interface BlockContextValue {
  blockedDids: Set<string>;
  canWriteBlocks: boolean;
  resync: () => Promise<void>;
  toggleBlock: (did: string) => void;
}

const BlockContext = createContext<BlockContextValue | null>(null);

export function BlockProvider({ children }: { children: ReactNode }) {
  const { blockedDids, resync, toggleBlock } = useBlockSync();
  const { grantedScopes } = useAuth();
  const canWriteBlocks = grantedScopes.includes('repo:app.bsky.graph.block');

  const value = useMemo<BlockContextValue>(
    () => ({ blockedDids, canWriteBlocks, resync, toggleBlock }),
    [blockedDids, canWriteBlocks, resync, toggleBlock],
  );

  return <BlockContext.Provider value={value}>{children}</BlockContext.Provider>;
}

export function useBlocks(): BlockContextValue {
  const ctx = useContext(BlockContext);
  if (!ctx) throw new Error('useBlocks must be used within BlockProvider');
  return ctx;
}

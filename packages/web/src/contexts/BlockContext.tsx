import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useBlockSync } from '../hooks/useBlockSync';

interface BlockContextValue {
  blockedDids: Set<string>;
  resync: () => Promise<void>;
  toggleBlock: (did: string) => void;
}

const BlockContext = createContext<BlockContextValue | null>(null);

export function BlockProvider({ children }: { children: ReactNode }) {
  const { blockedDids, resync, toggleBlock } = useBlockSync();

  const value = useMemo<BlockContextValue>(
    () => ({ blockedDids, resync, toggleBlock }),
    [blockedDids, resync, toggleBlock],
  );

  return <BlockContext.Provider value={value}>{children}</BlockContext.Provider>;
}

export function useBlocks(): BlockContextValue {
  const ctx = useContext(BlockContext);
  if (!ctx) throw new Error('useBlocks must be used within BlockProvider');
  return ctx;
}

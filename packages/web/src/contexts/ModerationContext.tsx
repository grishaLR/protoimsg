import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ModerationOpts } from '@atproto/api';
import { useAuth } from '../hooks/useAuth';

const ModerationContext = createContext<ModerationOpts | null>(null);

const DEFAULT_PREFS = {
  adultContentEnabled: false,
  labels: {},
  labelers: [],
  mutedWords: [],
  hiddenPosts: [],
};

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { agent, did } = useAuth();
  const [opts, setOpts] = useState<ModerationOpts | null>(null);

  useEffect(() => {
    if (!agent || !did) {
      setOpts(null);
      return;
    }

    // No bsky scopes requested — use default moderation prefs
    setOpts({ userDid: did, prefs: DEFAULT_PREFS, labelDefs: {} });
  }, [agent, did]);

  return <ModerationContext.Provider value={opts}>{children}</ModerationContext.Provider>;
}

export function useModerationOpts(): ModerationOpts | null {
  return useContext(ModerationContext);
}

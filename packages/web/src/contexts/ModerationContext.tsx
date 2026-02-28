import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ModerationOpts, InterpretedLabelValueDefinition } from '@atproto/api';
import { useAuth } from '../hooks/useAuth';

const ModerationContext = createContext<ModerationOpts | null>(null);

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { agent, did, hasBskyReads } = useAuth();
  const [opts, setOpts] = useState<ModerationOpts | null>(null);

  useEffect(() => {
    if (!agent || !did || !hasBskyReads) {
      setOpts(null);
      return;
    }

    const currentAgent = agent;
    const currentDid = did;
    let cancelled = false;

    async function load() {
      try {
        const prefs = await currentAgent.getPreferences();
        let labelDefs: Record<string, InterpretedLabelValueDefinition[]> = {};
        try {
          labelDefs = await currentAgent.getLabelDefinitions(prefs);
        } catch {
          // Non-critical — custom labeler defs are optional
        }
        if (!cancelled) {
          setOpts({
            userDid: currentDid,
            prefs: prefs.moderationPrefs,
            labelDefs,
          });
        }
      } catch (err) {
        console.error('Failed to load moderation preferences:', err);
        // Fall back to empty prefs so the app never breaks
        if (!cancelled) {
          setOpts({
            userDid: currentDid,
            prefs: {
              adultContentEnabled: false,
              labels: {},
              labelers: [],
              mutedWords: [],
              hiddenPosts: [],
            },
            labelDefs: {},
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agent, did, hasBskyReads]);

  return <ModerationContext.Provider value={opts}>{children}</ModerationContext.Provider>;
}

export function useModerationOpts(): ModerationOpts | null {
  return useContext(ModerationContext);
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ModerationOpts, InterpretedLabelValueDefinition } from '@atproto/api';
import { useAuth } from '../hooks/useAuth';
import { publicAgent } from '../lib/public-agent';

const ModerationContext = createContext<ModerationOpts | null>(null);

const DEFAULT_PREFS = {
  adultContentEnabled: false,
  labels: {},
  labelers: [],
  mutedWords: [],
  hiddenPosts: [],
};

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { agent, did, hasFeed } = useAuth();
  const [opts, setOpts] = useState<ModerationOpts | null>(null);

  useEffect(() => {
    if (!agent || !did) {
      setOpts(null);
      return;
    }

    const currentDid = did;

    // Moderation prefs are only useful when feed scope is enabled.
    // Skip the proxied appview calls entirely otherwise.
    if (!hasFeed) {
      setOpts({ userDid: currentDid, prefs: DEFAULT_PREFS, labelDefs: {} });
      return;
    }

    const currentAgent = agent;
    let cancelled = false;

    async function load() {
      try {
        const prefs = await currentAgent.getPreferences();
        let labelDefs: Record<string, InterpretedLabelValueDefinition[]> = {};
        try {
          labelDefs = await publicAgent.getLabelDefinitions(prefs);
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
      } catch {
        // Proxied appview call failed — use defaults
        if (!cancelled) {
          setOpts({ userDid: currentDid, prefs: DEFAULT_PREFS, labelDefs: {} });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agent, did, hasFeed]);

  return <ModerationContext.Provider value={opts}>{children}</ModerationContext.Provider>;
}

export function useModerationOpts(): ModerationOpts | null {
  return useContext(ModerationContext);
}

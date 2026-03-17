import { useMemo } from 'react';
import { moderateProfile, type ModerationUI } from '@atproto/api';
import { useProfile } from '@/services/ProfileContext';
import { useModerationOpts } from '@/services/ModerationContext';

export interface ModerationInfo {
  shouldFilter: boolean;
  shouldBlur: boolean;
  shouldAlert: boolean;
  shouldInform: boolean;
  cause: ModerationUI | null;
}

const SAFE_DEFAULT: ModerationInfo = {
  shouldFilter: false,
  shouldBlur: false,
  shouldAlert: false,
  shouldInform: false,
  cause: null,
};

export function useModeration(did: string): ModerationInfo {
  const profile = useProfile(did);
  const opts = useModerationOpts();

  return useMemo(() => {
    if (!profile?.bskyProfile || !opts) return SAFE_DEFAULT;

    try {
      const decision = moderateProfile(profile.bskyProfile, opts);
      const ui = decision.ui('profileView');
      return {
        shouldFilter: ui.filter,
        shouldBlur: ui.blur,
        shouldAlert: ui.alert,
        shouldInform: ui.inform,
        cause: ui,
      };
    } catch {
      return SAFE_DEFAULT;
    }
  }, [profile?.bskyProfile, opts]);
}

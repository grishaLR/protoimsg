import { useQuery } from '@tanstack/react-query';
import type { AppBskyActorDefs } from '@atproto/api';
import { publicAgent } from '@/lib/public-agent';

interface UseProfileDetailResult {
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a full profile (with banner, bio, stats) via public API.
 * Separate from ProfileContext's batch fetcher which only gets ProfileViewBasic.
 */
export function useProfileDetail(did: string | undefined): UseProfileDetailResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['profile-detail', did],
    queryFn: async () => {
      const res = await publicAgent.app.bsky.actor.getProfile({ actor: did ?? '' });
      return res.data;
    },
    enabled: !!did,
    staleTime: 60_000,
  });

  return {
    profile: data ?? null,
    loading: isLoading,
    error: error ? 'Failed to load profile' : null,
  };
}

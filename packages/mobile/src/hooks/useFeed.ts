import { useCallback } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from '@/services/auth';
import { publicAgent } from '@/lib/public-agent';
import { PERSISTED_QUERY_ROOT } from '@/lib/query-client';

interface UseFeedResult {
  posts: AppBskyFeedDefs.FeedViewPost[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

/**
 * Infinite-scrolling feed hook backed by TanStack Query.
 * - `feedUri === undefined` → "Following" timeline (requires auth)
 * - `feedUri === string` → named feed via public API
 */
export function useFeed(feedUri: string | undefined): UseFeedResult {
  const { agent } = useAuth();
  const queryClient = useQueryClient();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching, error } =
    useInfiniteQuery({
      queryKey: [PERSISTED_QUERY_ROOT, 'feed', feedUri],
      queryFn: async ({ pageParam }) => {
        if (feedUri === undefined) {
          if (!agent) throw new Error('No agent');
          const res = await agent.app.bsky.feed.getTimeline({ limit: 30, cursor: pageParam });
          return res.data;
        }
        const res = await publicAgent.app.bsky.feed.getFeed({
          feed: feedUri,
          limit: 30,
          cursor: pageParam,
        });
        return res.data;
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.cursor,
      enabled: feedUri === undefined ? !!agent : true,
      staleTime: Infinity,
    });

  const posts = data?.pages.flatMap((p) => p.feed) ?? [];

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [PERSISTED_QUERY_ROOT, 'feed', feedUri] });
  }, [queryClient, feedUri]);

  return {
    posts,
    loading: isLoading,
    loadingMore: isFetchingNextPage,
    error: error ? 'Failed to load feed' : null,
    hasMore: hasNextPage,
    loadMore,
    refresh,
    refreshing: isRefetching && !isFetchingNextPage,
  };
}

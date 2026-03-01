import { useCallback } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useAuth } from './useAuth';
import { publicAgent } from '../lib/public-agent';

interface UseFeedResult {
  posts: AppBskyFeedDefs.FeedViewPost[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useFeed(feedUri: string | undefined): UseFeedResult {
  const { agent } = useAuth();
  const queryClient = useQueryClient();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } =
    useInfiniteQuery({
      queryKey: ['feed', feedUri],
      queryFn: async ({ pageParam }) => {
        if (feedUri === undefined) {
          // "Following" timeline requires auth proxy — may 403 on unpatched PDSes
          if (!agent) throw new Error('No agent');
          const res = await agent.app.bsky.feed.getTimeline({ limit: 30, cursor: pageParam });
          return res.data;
        }
        // Named feeds work via public API (no PDS proxy needed)
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
    });

  const posts = data?.pages.flatMap((p) => p.feed) ?? [];

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['feed', feedUri] });
  }, [queryClient, feedUri]);

  return {
    posts,
    loading: isLoading,
    loadingMore: isFetchingNextPage,
    error: error ? 'Failed to load feed' : null,
    hasMore: hasNextPage,
    loadMore,
    refresh,
  };
}

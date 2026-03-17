import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';
import { publicAgent } from '@/lib/public-agent';
import { PERSISTED_QUERY_ROOT } from '@/lib/query-client';

/**
 * Group self-reply threads so root appears before its continuations.
 * The API returns items in reverse-chron (newest first), so a self-thread
 * shows as [reply, root] — we reorder to [root, reply].
 */
function groupSelfThreads(items: AppBskyFeedDefs.FeedViewPost[]): AppBskyFeedDefs.FeedViewPost[] {
  const result: AppBskyFeedDefs.FeedViewPost[] = [];
  // Track which URIs are replies waiting for their root
  const replyRootMap = new Map<string, number[]>(); // rootUri -> indices of replies in result

  for (const item of items) {
    const record = item.post.record as AppBskyFeedPost.Record;
    const replyRoot = record.reply?.root.uri;
    const isReply = replyRoot && replyRoot !== item.post.uri;

    if (isReply) {
      // This is a reply — add it and note it's waiting for its root
      const idx = result.length;
      result.push(item);
      const existing = replyRootMap.get(replyRoot) ?? [];
      existing.push(idx);
      replyRootMap.set(replyRoot, existing);
    } else {
      // This is a root post — check if any replies to it are already in the list
      const replyIndices = replyRootMap.get(item.post.uri);
      if (replyIndices && replyIndices.length > 0) {
        // Find the earliest reply position and insert the root before it
        const earliest = Math.min(...replyIndices);
        result.splice(earliest, 0, item);
        replyRootMap.delete(item.post.uri);
      } else {
        result.push(item);
      }
    }
  }

  return result;
}

export interface AnnotatedFeedPost {
  item: AppBskyFeedDefs.FeedViewPost;
  /** true if this post has a self-reply continuation below it */
  hasThreadChild: boolean;
  /** true if this post is a self-reply continuation of the post above it */
  hasThreadParent: boolean;
}

interface UseAuthorFeedResult {
  posts: AnnotatedFeedPost[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

export function useAuthorFeed(did: string | undefined): UseAuthorFeedResult {
  const queryClient = useQueryClient();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching, error } =
    useInfiniteQuery({
      queryKey: [PERSISTED_QUERY_ROOT, 'author-feed', did],
      queryFn: async ({ pageParam }) => {
        const res = await publicAgent.app.bsky.feed.getAuthorFeed({
          actor: did ?? '',
          filter: 'posts_and_author_threads',
          limit: 30,
          cursor: pageParam,
        });
        return res.data;
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.cursor,
      enabled: !!did,
      staleTime: 60_000,
    });

  const rawPosts = data?.pages.flatMap((p) => p.feed) ?? [];
  const posts = useMemo(() => {
    const grouped = groupSelfThreads(rawPosts);
    // Annotate with thread position
    const annotated: AnnotatedFeedPost[] = grouped.map((item, i) => {
      const record = item.post.record as AppBskyFeedPost.Record;
      const replyRoot = record.reply?.root.uri;
      const isReply = !!replyRoot && replyRoot !== item.post.uri;

      // Check if the next item is a self-reply to this post's thread
      const next = i + 1 < grouped.length ? grouped[i + 1] : undefined;
      const nextRecord = next?.post.record as AppBskyFeedPost.Record | undefined;
      const nextReplyRoot = nextRecord?.reply?.root.uri;
      const nextIsChild =
        !!next &&
        !!nextReplyRoot &&
        (nextReplyRoot === item.post.uri || nextReplyRoot === replyRoot);

      // Check if prev item is root/sibling of this post's thread
      const prev = i > 0 ? grouped[i - 1] : undefined;
      const hasThreadParent =
        isReply &&
        !!prev &&
        (prev.post.uri === replyRoot ||
          (prev.post.record as AppBskyFeedPost.Record).reply?.root.uri === replyRoot);

      return { item, hasThreadChild: nextIsChild, hasThreadParent };
    });
    return annotated;
  }, [rawPosts]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: [PERSISTED_QUERY_ROOT, 'author-feed', did],
    });
  }, [queryClient, did]);

  return {
    posts,
    loading: isLoading,
    loadingMore: isFetchingNextPage,
    error: error ? 'Failed to load posts' : null,
    hasMore: hasNextPage,
    loadMore,
    refresh,
    refreshing: isRefetching && !isFetchingNextPage,
  };
}

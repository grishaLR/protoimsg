import { useQuery } from '@tanstack/react-query';
import type { AppBskyFeedDefs } from '@atproto/api';
import { publicAgent } from '../lib/public-agent';

interface UseThreadResult {
  thread: AppBskyFeedDefs.ThreadViewPost | null;
  loading: boolean;
  error: string | null;
}

export function useThread(uri: string | null): UseThreadResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['thread', uri],
    queryFn: async () => {
      if (!uri) throw new Error('No URI');
      const res = await publicAgent.app.bsky.feed.getPostThread({
        uri,
        depth: 1,
        parentHeight: 10,
      });
      return res.data.thread;
    },
    enabled: !!uri,
  });

  const thread =
    data && '$type' in data && data.$type === 'app.bsky.feed.defs#threadViewPost'
      ? (data as AppBskyFeedDefs.ThreadViewPost)
      : null;

  return {
    thread,
    loading: isLoading,
    error: error ? 'Failed to load thread' : null,
  };
}

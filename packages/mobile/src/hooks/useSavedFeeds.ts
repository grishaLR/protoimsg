import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/services/auth';
import { publicAgent } from '@/lib/public-agent';

const FOR_YOU_FEED_URI = 'at://did:plc:3guzzweuqraryl3rdkimjamk/app.bsky.feed.generator/for-you';

export interface FeedInfo {
  uri: string | undefined;
  displayName: string;
}

const BUILT_IN: FeedInfo[] = [
  { uri: undefined, displayName: 'Following' },
  { uri: FOR_YOU_FEED_URI, displayName: 'For You' },
];

export function useSavedFeeds() {
  const { agent } = useAuth();

  const { data: feeds = BUILT_IN, isLoading: loading } = useQuery({
    queryKey: ['savedFeeds'],
    queryFn: async () => {
      if (!agent) return BUILT_IN;

      let prefs;
      try {
        const res = await agent.app.bsky.actor.getPreferences();
        prefs = res.data.preferences;
      } catch {
        return BUILT_IN;
      }

      const savedFeedUris: string[] = [];

      for (const pref of prefs) {
        if (pref.$type === 'app.bsky.actor.defs#savedFeedsPrefV2') {
          const items = (pref as Record<string, unknown>).items as
            | Array<{ type: string; value: string; pinned: boolean }>
            | undefined;
          if (items) {
            for (const item of items) {
              if (item.type === 'feed' && item.value !== FOR_YOU_FEED_URI) {
                savedFeedUris.push(item.value);
              }
            }
          }
          break;
        }
        if (pref.$type === 'app.bsky.actor.defs#savedFeedsPref') {
          const saved = (pref as Record<string, unknown>).saved as string[] | undefined;
          if (saved) {
            for (const uri of saved) {
              if (uri !== FOR_YOU_FEED_URI) {
                savedFeedUris.push(uri);
              }
            }
          }
          break;
        }
      }

      if (savedFeedUris.length === 0) {
        return BUILT_IN;
      }

      const genRes = await publicAgent.app.bsky.feed.getFeedGenerators({
        feeds: savedFeedUris,
      });

      const savedFeeds: FeedInfo[] = genRes.data.feeds.map((gen) => ({
        uri: gen.uri,
        displayName: gen.displayName,
      }));

      return [...BUILT_IN, ...savedFeeds];
    },
    enabled: !!agent,
    staleTime: 10 * 60 * 1000,
  });

  return { feeds, loading };
}

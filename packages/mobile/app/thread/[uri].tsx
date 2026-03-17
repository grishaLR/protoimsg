import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { AppBskyFeedDefs } from '@atproto/api';
import { publicAgent } from '@/lib/public-agent';
import { FeedPost } from '@/components/FeedPost';
import { useTheme } from '@/theme';
import { spacing, fontSize } from '@/theme/tokens';

type ThreadViewPost = AppBskyFeedDefs.ThreadViewPost;

function isThreadViewPost(v: unknown): v is ThreadViewPost {
  return (
    v != null &&
    typeof v === 'object' &&
    '$type' in (v as Record<string, unknown>) &&
    (v as Record<string, unknown>).$type === 'app.bsky.feed.defs#threadViewPost'
  );
}

function collectParents(post: ThreadViewPost): ThreadViewPost[] {
  const parents: ThreadViewPost[] = [];
  let current = post.parent;
  while (isThreadViewPost(current)) {
    parents.unshift(current);
    current = current.parent;
  }
  return parents;
}

function collectReplies(post: ThreadViewPost): ThreadViewPost[] {
  if (!post.replies) return [];
  return post.replies.filter(isThreadViewPost);
}

function toFeedViewPost(threadPost: ThreadViewPost): AppBskyFeedDefs.FeedViewPost {
  return { post: threadPost.post };
}

export default function ThreadScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    navigation.setOptions({
      title: 'Thread',
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
    });
  }, [navigation, colors]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['thread', uri],
    queryFn: async () => {
      const res = await publicAgent.app.bsky.feed.getPostThread({ uri: uri, depth: 6 });
      return res.data;
    },
    enabled: !!uri,
  });

  const thread = data?.thread;
  const mainPost = isThreadViewPost(thread) ? thread : null;

  const items = useMemo(() => {
    if (!mainPost) return [];
    const parents = collectParents(mainPost).map(toFeedViewPost);
    const main = toFeedViewPost(mainPost);
    const replies = collectReplies(mainPost).map(toFeedViewPost);
    return [...parents, main, ...replies];
  }, [mainPost]);

  const mainIndex = useMemo(() => {
    if (!mainPost) return 0;
    return collectParents(mainPost).length;
  }, [mainPost]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<AppBskyFeedDefs.FeedViewPost>) => {
      const isMain = index === mainIndex;
      return (
        <View style={isMain ? [styles.mainPost, { borderLeftColor: colors.primary }] : undefined}>
          <FeedPost item={item} />
        </View>
      );
    },
    [mainIndex, colors.primary],
  );

  const keyExtractor = useCallback(
    (item: AppBskyFeedDefs.FeedViewPost, index: number) => `${item.post.uri}-${index}`,
    [],
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !mainPost) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error ? 'Failed to load thread' : 'Post not found'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
      />
      {/* Reply button */}
      <Pressable
        style={[
          styles.replyBar,
          { backgroundColor: colors.base200, borderTopColor: colors.base300 },
        ]}
        onPress={() => {
          router.push(`/compose?replyUri=${encodeURIComponent(mainPost.post.uri)}` as never);
        }}
      >
        <Text style={[styles.replyBarText, { color: colors.chromeTextMuted }]}>
          Write a reply...
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[12],
  },
  list: {
    flexGrow: 1,
  },
  mainPost: {
    borderLeftWidth: 3,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderRadius: 0,
  },
  replyBarText: {
    fontSize: fontSize.base,
  },
  errorText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
});

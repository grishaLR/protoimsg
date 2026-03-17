import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useFeed } from '@/hooks/useFeed';
import { FeedPost } from '@/components/FeedPost';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/services/auth';
import { useProfile } from '@/services/ProfileContext';
import { ActiveVideoProvider, useActiveVideo } from '@/services/ActiveVideoContext';
import { useTheme } from '@/theme';
import { spacing, fontSize } from '@/theme/tokens';

export default function FeedScreen() {
  return (
    <ActiveVideoProvider>
      <FeedScreenInner />
    </ActiveVideoProvider>
  );
}

function FeedScreenInner() {
  const { t } = useTranslation('feed');
  const router = useRouter();
  const { colors } = useTheme();
  const { did } = useAuth();
  const myProfile = useProfile(did);
  const { setActiveVideo } = useActiveVideo();
  const { posts, loading, loadingMore, error, loadMore, refresh, refreshing } = useFeed(undefined); // "Following" timeline

  // Viewability tracking for autoplay — must be stable refs (FlatList requirement)
  const setActiveVideoRef = useRef(setActiveVideo);
  setActiveVideoRef.current = setActiveVideo;

  const viewabilityConfigRef = useRef([
    {
      viewabilityConfig: { viewAreaCoveragePercentThreshold: 60 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        let foundVideo: string | null = null;
        for (const token of viewableItems) {
          if (!token.isViewable || !token.item) continue;
          const feedItem = token.item as AppBskyFeedDefs.FeedViewPost;
          const embed = feedItem.post.embed as Record<string, unknown> | undefined;
          if (!embed) continue;
          const embedType = embed.$type as string | undefined;
          if (
            embedType === 'app.bsky.embed.video#view' ||
            (embedType === 'app.bsky.embed.recordWithMedia#view' &&
              ((embed as { media?: Record<string, unknown> }).media?.$type as string) ===
                'app.bsky.embed.video#view')
          ) {
            foundVideo = feedItem.post.uri;
            break;
          }
        }
        setActiveVideoRef.current(foundVideo);
      },
    },
  ]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<AppBskyFeedDefs.FeedViewPost>) => {
    return <FeedPost item={item} />;
  }, []);

  const keyExtractor = useCallback(
    (item: AppBskyFeedDefs.FeedViewPost, index: number) => `${item.post.uri}-${index}`,
    [],
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
        <Text style={[styles.title, { color: colors.baseContent }]}>
          {t('feedView.title', { defaultValue: 'Feed' })}
        </Text>
      </View>
      {/* Compose bar */}
      <Pressable
        style={[styles.composeBar, { borderBottomColor: colors.base200 }]}
        onPress={() => {
          router.push('/compose' as never);
        }}
      >
        <Avatar url={myProfile?.avatarUrl} name={myProfile?.displayName ?? ''} size="sm" />
        <Text style={[styles.composePlaceholder, { color: colors.chromeTextMuted }]}>
          {t('composer.collapsed', { defaultValue: "What's on your mind?" })}
        </Text>
      </Pressable>
      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        viewabilityConfigCallbackPairs={viewabilityConfigRef.current}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
              {t('feedView.empty', {
                defaultValue: 'No posts yet. Follow people to see their posts here.',
              })}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
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
  header: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  errorText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  composeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  composePlaceholder: {
    fontSize: fontSize.base,
    flex: 1,
  },
  footer: {
    paddingVertical: spacing[6],
    alignItems: 'center',
  },
});

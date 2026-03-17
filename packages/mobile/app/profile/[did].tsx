import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Linking,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { useAuthorFeed, type AnnotatedFeedPost } from '@/hooks/useAuthorFeed';
import { useGermDeclaration } from '@/hooks/useGermDeclaration';
import { useContentTranslation } from '@/hooks/useContentTranslation';
import { useAuth } from '@/services/auth';
import { Avatar } from '@/components/Avatar';
import { FeedPost } from '@/components/FeedPost';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ProfileScreen() {
  const { t } = useTranslation(['feed', 'chat', 'common']);
  const { did } = useLocalSearchParams<{ did: string }>();
  const { did: myDid } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();
  const { colors } = useTheme();
  const { profile, loading: profileLoading, error: profileError } = useProfileDetail(did);
  const {
    posts,
    loading: feedLoading,
    loadMore,
    refresh,
    refreshing,
    loadingMore,
  } = useAuthorFeed(did);
  const { canMessage: hasGerm, germUrl } = useGermDeclaration(did);
  const {
    available: translateAvailable,
    getTranslation,
    requestTranslation,
  } = useContentTranslation();

  const displayName = profile?.displayName ?? profile?.handle ?? did.split(':').pop() ?? '';

  // Sticky header — appears when scrolled past the profile header (~280px)
  const STICKY_THRESHOLD = 280;
  const stickyOpacity = useSharedValue(0);
  const stickyTranslateY = useSharedValue(-10);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const shouldShow = y > STICKY_THRESHOLD;
      stickyOpacity.value = withTiming(shouldShow ? 1 : 0, { duration: 150 });
      stickyTranslateY.value = withTiming(shouldShow ? 0 : -10, { duration: 150 });
    },
    [stickyOpacity, stickyTranslateY],
  );

  const stickyStyle = useAnimatedStyle(() => ({
    opacity: stickyOpacity.value,
    transform: [{ translateY: stickyTranslateY.value }],
    pointerEvents: stickyOpacity.value > 0.5 ? ('auto' as const) : ('none' as const),
  }));

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: '',
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
    });
  }, [navigation, colors]);

  // Translate bio
  const bioTranslation = profile?.description ? getTranslation(profile.description) : undefined;
  const handleTranslateBio = useCallback(() => {
    if (profile?.description) requestTranslation(profile.description);
  }, [profile?.description, requestTranslation]);

  const handleGerm = useCallback(() => {
    if (germUrl) void Linking.openURL(germUrl);
  }, [germUrl]);

  const handleDm = useCallback(() => {
    if (did) router.push(`/dm/${encodeURIComponent(did)}`);
  }, [did, router]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<AnnotatedFeedPost>) => {
    return (
      <FeedPost
        item={item.item}
        hasThreadChild={item.hasThreadChild}
        hasThreadParent={item.hasThreadParent}
      />
    );
  }, []);

  const keyExtractor = useCallback(
    (item: AnnotatedFeedPost, index: number) => `${item.item.post.uri}-${index}`,
    [],
  );

  if (profileLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (profileError || !profile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {profileError ?? 'Profile not found'}
          </Text>
        </View>
      </View>
    );
  }

  const isSelf = myDid === did;

  const header = (
    <View>
      {/* Banner */}
      {profile.banner ? (
        <Image source={{ uri: profile.banner }} style={styles.banner} resizeMode="cover" />
      ) : (
        <View style={[styles.banner, { backgroundColor: colors.base200 }]} />
      )}

      {/* Avatar + names */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarContainer}>
          <Avatar url={profile.avatar} name={displayName} size="lg" />
        </View>
        <Text style={[styles.displayName, { color: colors.baseContent }]}>{displayName}</Text>
        <Text style={[styles.handle, { color: colors.chromeTextMuted }]}>@{profile.handle}</Text>
      </View>

      {/* Bio */}
      {profile.description ? (
        <View style={styles.bioSection}>
          <Text style={[styles.bioText, { color: colors.baseContent }]}>
            {bioTranslation ?? profile.description}
          </Text>
          {bioTranslation ? (
            <Text style={[styles.translatedLabel, { color: colors.chromeTextMuted }]}>
              {t('feed:post.translate', { defaultValue: 'Translated' })}
            </Text>
          ) : translateAvailable && !bioTranslation ? (
            <Pressable onPress={handleTranslateBio}>
              <Text style={[styles.translateButton, { color: colors.primary }]}>
                {t('feed:post.translate', { defaultValue: 'Translate' })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statCount, { color: colors.baseContent }]}>
            {formatCount(profile.followersCount ?? 0)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.chromeTextMuted }]}>
            {t('feed:profileView.followers', { defaultValue: 'followers' })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statCount, { color: colors.baseContent }]}>
            {formatCount(profile.followsCount ?? 0)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.chromeTextMuted }]}>
            {t('feed:profileView.following', { defaultValue: 'following' })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statCount, { color: colors.baseContent }]}>
            {formatCount(profile.postsCount ?? 0)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.chromeTextMuted }]}>
            {t('feed:profileView.posts', { defaultValue: 'posts' })}
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      {!isSelf ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={handleDm}
          >
            <Text style={[styles.actionText, { color: colors.primaryContent }]}>
              {t('chat:buddyMenu.openDm', { defaultValue: 'Message' })}
            </Text>
          </Pressable>
          {hasGerm && germUrl ? (
            <Pressable
              style={[styles.actionButton, { backgroundColor: colors.base200 }]}
              onPress={handleGerm}
            >
              <Text style={[styles.actionText, { color: colors.baseContent }]}>GERM</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Posts heading */}
      <View style={[styles.postsHeading, { borderTopColor: colors.base200 }]}>
        <Text style={[styles.postsHeadingText, { color: colors.baseContent }]}>
          {t('feed:profileView.postsSection', { defaultValue: 'Posts' })}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Sticky header bar */}
      <Animated.View
        style={[styles.stickyBar, { backgroundColor: colors.base200, paddingTop: 0 }, stickyStyle]}
      >
        <Pressable
          style={styles.stickyContent}
          onPress={() => {
            // Could scroll to top
          }}
        >
          <Avatar url={profile.avatar} name={displayName} size="sm" />
          <View style={styles.stickyTextContainer}>
            <Text style={[styles.stickyName, { color: colors.baseContent }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text
              style={[styles.stickyHandle, { color: colors.chromeTextMuted }]}
              numberOfLines={1}
            >
              @{profile.handle}
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
          feedLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                {t('feed:profileView.noPosts', { defaultValue: 'No posts yet' })}
              </Text>
            </View>
          )
        }
      />
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
  banner: {
    width: '100%',
    height: 150,
  },
  profileHeader: {
    alignItems: 'center',
    marginTop: -40,
    paddingHorizontal: spacing[4],
  },
  avatarContainer: {
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  displayName: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    marginTop: spacing[3],
  },
  handle: {
    fontSize: fontSize.base,
    marginTop: spacing[1],
  },
  bioSection: {
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
  },
  bioText: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.5,
  },
  translatedLabel: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    marginTop: spacing[1],
  },
  translateButton: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing[2],
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[8],
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[6],
  },
  stat: {
    alignItems: 'center',
  },
  statCount: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: fontSize.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[4],
  },
  actionButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
  },
  actionText: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  postsHeading: {
    borderTopWidth: 1,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
  },
  postsHeadingText: {
    fontSize: fontSize.base,
    fontWeight: '700',
  },
  footer: {
    paddingVertical: spacing[6],
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: spacing[12],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.base,
  },
  stickyBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  stickyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  stickyTextContainer: {
    flex: 1,
  },
  stickyName: {
    fontSize: fontSize.base,
    fontWeight: '700',
  },
  stickyHandle: {
    fontSize: fontSize.xs,
  },
  errorText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
});

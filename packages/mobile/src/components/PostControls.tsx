import React, { useCallback } from 'react';
import { View, Text, Pressable, ActionSheetIOS, Platform, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle, Repeat2, Heart, Languages } from 'lucide-react-native';
import type { AppBskyFeedDefs } from '@atproto/api';
import { usePostInteractions } from '@/hooks/usePostInteractions';
import { useTheme } from '@/theme';
import { spacing, fontSize } from '@/theme/tokens';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const ICON_SIZE = 16;

interface PostControlsProps {
  post: AppBskyFeedDefs.PostView;
  onTranslate?: () => void;
  showTranslate?: boolean;
}

export const PostControls = React.memo(function PostControls({
  post,
  onTranslate,
  showTranslate,
}: PostControlsProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { isLiked, isReposted, likeCount, repostCount, replyCount, toggleLike, toggleRepost } =
    usePostInteractions(post);

  const handleReply = useCallback(() => {
    router.push(`/compose?replyUri=${encodeURIComponent(post.uri)}` as never);
  }, [router, post.uri]);

  const handleRepostMenu = useCallback(() => {
    const repostLabel = isReposted ? 'Undo repost' : 'Repost';
    const quoteLabel = 'Quote post';
    const cancelLabel = 'Cancel';

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [repostLabel, quoteLabel, cancelLabel],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) toggleRepost();
          if (index === 1) router.push(`/compose` as never);
        },
      );
    } else {
      Alert.alert('', undefined, [
        { text: repostLabel, onPress: toggleRepost },
        {
          text: quoteLabel,
          onPress: () => {
            router.push(`/compose` as never);
          },
        },
        { text: cancelLabel, style: 'cancel' },
      ]);
    }
  }, [isReposted, toggleRepost, router]);

  return (
    <View style={styles.container}>
      <Pressable style={styles.button} onPress={handleReply} accessibilityLabel="Reply">
        <MessageCircle size={ICON_SIZE} color={colors.chromeTextMuted} />
        {replyCount > 0 ? (
          <Text style={[styles.count, { color: colors.chromeTextMuted }]}>
            {formatCount(replyCount)}
          </Text>
        ) : null}
      </Pressable>

      <Pressable style={styles.button} onPress={handleRepostMenu} accessibilityLabel="Repost">
        <Repeat2 size={ICON_SIZE} color={isReposted ? colors.success : colors.chromeTextMuted} />
        {repostCount > 0 ? (
          <Text
            style={[styles.count, { color: isReposted ? colors.success : colors.chromeTextMuted }]}
          >
            {formatCount(repostCount)}
          </Text>
        ) : null}
      </Pressable>

      <Pressable style={styles.button} onPress={toggleLike} accessibilityLabel="Like">
        <Heart
          size={ICON_SIZE}
          color={isLiked ? colors.error : colors.chromeTextMuted}
          fill={isLiked ? colors.error : 'none'}
        />
        {likeCount > 0 ? (
          <Text style={[styles.count, { color: isLiked ? colors.error : colors.chromeTextMuted }]}>
            {formatCount(likeCount)}
          </Text>
        ) : null}
      </Pressable>

      {showTranslate ? (
        <Pressable style={styles.button} onPress={onTranslate} accessibilityLabel="Translate">
          <Languages size={ICON_SIZE} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing[6],
    paddingTop: spacing[3],
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  count: {
    fontSize: fontSize.xs,
  },
});

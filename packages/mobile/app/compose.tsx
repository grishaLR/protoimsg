import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCompose } from '@/hooks/useCompose';
import { publicAgent } from '@/lib/public-agent';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/services/auth';
import { useProfile } from '@/services/ProfileContext';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

const MAX_GRAPHEMES = 300;

export default function ComposeScreen() {
  const { replyUri } = useLocalSearchParams<{ replyUri?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { did } = useAuth();
  const myProfile = useProfile(did);

  // If replying, fetch the parent post
  const { data: replyPost } = useQuery({
    queryKey: ['post-for-reply', replyUri],
    queryFn: async () => {
      const res = await publicAgent.app.bsky.feed.getPosts({ uris: [replyUri ?? ''] });
      return res.data.posts[0] ?? null;
    },
    enabled: !!replyUri,
  });

  const handleSuccess = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const { text, setText, setReplyTo, posting, error, graphemeCount, canPost, submit } =
    useCompose(handleSuccess);

  // Set reply target when post loads
  useEffect(() => {
    if (replyPost) setReplyTo(replyPost);
  }, [replyPost, setReplyTo]);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: replyUri ? 'Reply' : 'New Post',
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          style={styles.headerButton}
        >
          <Text style={[styles.headerButtonText, { color: colors.baseContent }]}>Cancel</Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => void submit()}
          disabled={!canPost}
          style={[
            styles.postButton,
            { backgroundColor: canPost ? colors.primary : colors.base300 },
          ]}
        >
          {posting ? (
            <ActivityIndicator size="small" color={colors.primaryContent} />
          ) : (
            <Text
              style={[
                styles.postButtonText,
                { color: canPost ? colors.primaryContent : colors.chromeTextMuted },
              ]}
            >
              {replyUri ? 'Reply' : 'Post'}
            </Text>
          )}
        </Pressable>
      ),
    });
  }, [navigation, colors, canPost, posting, submit, replyUri, router]);

  const replyAuthor = replyPost?.author;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Reply context */}
      {replyPost && replyAuthor ? (
        <View style={[styles.replyContext, { borderBottomColor: colors.base200 }]}>
          <View style={styles.replyContextRow}>
            <Avatar
              url={replyAuthor.avatar}
              name={replyAuthor.displayName ?? replyAuthor.handle}
              size="sm"
            />
            <View style={styles.replyContextBody}>
              <Text
                style={[styles.replyContextName, { color: colors.baseContent }]}
                numberOfLines={1}
              >
                {replyAuthor.displayName ?? replyAuthor.handle}
              </Text>
              <Text
                style={[styles.replyContextText, { color: colors.chromeTextMuted }]}
                numberOfLines={3}
              >
                {(replyPost.record as { text?: string }).text}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Composer */}
      <View style={styles.composerRow}>
        <Avatar url={myProfile?.avatarUrl} name={myProfile?.displayName ?? ''} size="sm" />
        <TextInput
          style={[styles.textInput, { color: colors.baseContent }]}
          placeholder={replyUri ? 'Write your reply...' : "What's on your mind?"}
          placeholderTextColor={colors.chromeTextMuted}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          maxLength={MAX_GRAPHEMES * 4} // byte safety margin
          textAlignVertical="top"
        />
      </View>

      {/* Footer */}
      <View
        style={[
          styles.footer,
          { borderTopColor: colors.base200, paddingBottom: insets.bottom || spacing[4] },
        ]}
      >
        {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}
        <Text
          style={[
            styles.charCount,
            {
              color: graphemeCount > MAX_GRAPHEMES ? colors.error : colors.chromeTextMuted,
            },
          ]}
        >
          {graphemeCount}/{MAX_GRAPHEMES}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  headerButtonText: {
    fontSize: fontSize.base,
  },
  postButton: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    minWidth: 60,
    alignItems: 'center',
  },
  postButtonText: {
    fontSize: fontSize.base,
    fontWeight: '700',
  },
  replyContext: {
    padding: spacing[4],
    borderBottomWidth: 1,
  },
  replyContextRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  replyContextBody: {
    flex: 1,
  },
  replyContextName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  replyContextText: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.4,
  },
  composerRow: {
    flex: 1,
    flexDirection: 'row',
    padding: spacing[4],
    gap: spacing[3],
    alignItems: 'flex-start',
  },
  textInput: {
    flex: 1,
    fontSize: fontSize.lg,
    lineHeight: fontSize.lg * 1.5,
    minHeight: 120,
    paddingTop: 0,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
  },
  errorText: {
    fontSize: fontSize.sm,
  },
  charCount: {
    fontSize: fontSize.sm,
    marginLeft: 'auto',
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/services/auth';
import { useProfile } from '@/services/ProfileContext';
import { fetchChannelThreadMessages } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { RichText } from '@/components/RichText';
import { EmbedRenderer, isGifEmbed } from '@/components/EmbedRenderer';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW, type ThemeColors } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { MessageView } from '@/types';

// -- Thread message row --

const ThreadMessageRow = React.memo(function ThreadMessageRow({
  message,
  isSelf: _isSelf,
  colors,
  isAim,
  isRoot,
}: {
  message: MessageView;
  isSelf: boolean;
  colors: ThemeColors;
  isAim: boolean;
  isRoot: boolean;
}) {
  const profile = useProfile(message.did);
  const handle =
    profile?.displayName ??
    profile?.handle ??
    message.did.split(':').pop()?.slice(0, 12) ??
    message.did;
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isGif = isGifEmbed(message.embed);

  return (
    <View
      style={[
        styles.messageRow,
        isRoot && {
          backgroundColor: colors.base200,
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[4],
        },
      ]}
    >
      <Avatar url={profile?.avatarUrl} name={handle} size="sm" />
      <View style={styles.messageContent}>
        <View style={styles.messageHeader}>
          <Text style={[styles.messageHandle, { color: colors.secondary }]} numberOfLines={1}>
            {profile?.handle ? `@${profile.handle}` : handle}
          </Text>
          <Text style={[styles.messageTime, { color: colors.chromeTextMuted }]}>{time}</Text>
        </View>
        {!isGif ? (
          message.facets && message.facets.length > 0 ? (
            <RichText
              text={message.text}
              facets={message.facets as React.ComponentProps<typeof RichText>['facets']}
              colors={colors}
            />
          ) : (
            <Text style={[styles.messageText, { color: colors.baseContent }]}>{message.text}</Text>
          )
        ) : null}
        {message.embed ? (
          <EmbedRenderer embed={message.embed} colors={colors} isAim={isAim} />
        ) : null}
        {message.pending ? (
          <ActivityIndicator
            size={10}
            color={colors.chromeTextMuted}
            style={{ marginTop: spacing[1] }}
          />
        ) : null}
      </View>
    </View>
  );
});

// -- Main thread screen --

export default function ThreadScreen() {
  const { t } = useTranslation(['chat', 'common']);
  const { messageUri, roomId, channelId, channelUri } = useLocalSearchParams<{
    messageUri: string;
    roomId: string;
    channelId: string;
    channelUri: string;
  }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { colors } = useTheme();
  const { isAim } = useAimStyle();
  const { did } = useAuth();

  const [threadMessages, setThreadMessages] = useState<MessageView[]>([]);
  const [loadingThread, setLoadingThread] = useState(true);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<MessageView>>(null);

  // Get live messages stream for this room/channel
  const { messages: liveMessages, sendMessage } = useMessages(roomId, channelId);

  // Find root message from live stream
  const rootMessage = useMemo(
    () => liveMessages.find((m) => m.uri === messageUri),
    [liveMessages, messageUri],
  );

  // Set header
  useEffect(() => {
    navigation.setOptions({
      headerShown: !isAim,
      title: t('chat:threadPanel.title'),
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
      headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
    });
  }, [navigation, colors, isAim, t]);

  // Fetch thread replies on mount
  useEffect(() => {
    if (!messageUri || !roomId || !channelId) return;
    const ac = new AbortController();

    async function load() {
      try {
        const msgs = await fetchChannelThreadMessages(roomId, channelId, messageUri, {
          signal: ac.signal,
        });
        if (!ac.signal.aborted) {
          setThreadMessages(msgs.reverse());
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load thread:', err);
      } finally {
        if (!ac.signal.aborted) setLoadingThread(false);
      }
    }

    void load();
    return () => {
      ac.abort();
    };
  }, [messageUri, roomId, channelId]);

  // Merge thread messages with live replies
  const replies = useMemo(() => {
    const threadIds = new Set(threadMessages.map((m) => m.id));
    const liveReplies = liveMessages.filter(
      (m) => m.reply_root === messageUri && !threadIds.has(m.id),
    );
    return [...threadMessages, ...liveReplies];
  }, [threadMessages, liveMessages, messageUri]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !messageUri || !channelUri) return;
    setInputText('');

    try {
      await sendMessage(text, channelUri, { root: messageUri, parent: messageUri });
    } catch {
      // Error logged in hook
    }
  }, [inputText, messageUri, channelUri, sendMessage]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const renderReply = useCallback(
    ({ item }: ListRenderItemInfo<MessageView>) => (
      <ThreadMessageRow
        message={item}
        isSelf={item.did === did}
        colors={colors}
        isAim={isAim}
        isRoot={false}
      />
    ),
    [did, colors, isAim],
  );

  const keyExtractor = useCallback((item: MessageView) => item.id, []);

  if (!messageUri || !roomId || !channelId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.error }]}>
            {t('chat:threadPanel.notFound')}
          </Text>
        </View>
      </View>
    );
  }

  const inputBar = (
    <View style={[styles.inputBar, { backgroundColor: isAim ? colors.base100 : colors.base200 }]}>
      <TextInput
        style={[
          styles.textInput,
          {
            backgroundColor: isAim ? colors.surfaceContent : colors.surface,
            color: colors.baseContent,
            borderRadius: isAim ? 0 : radius.md,
          },
        ]}
        value={inputText}
        onChangeText={setInputText}
        placeholder={t('chat:threadPanel.inputPlaceholder')}
        placeholderTextColor={colors.chromeTextMuted}
        returnKeyType="send"
        onSubmitEditing={() => void handleSend()}
        submitBehavior="submit"
        multiline={false}
      />
      <Pressable
        style={[
          styles.sendButton,
          {
            backgroundColor: inputText.trim() ? colors.primary : colors.base300,
            borderRadius: isAim ? 0 : radius.md,
          },
        ]}
        onPress={() => void handleSend()}
        disabled={!inputText.trim()}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.sendButtonText,
            { color: inputText.trim() ? colors.primaryContent : colors.chromeTextMuted },
          ]}
        >
          {t('common:button.send')}
        </Text>
      </Pressable>
    </View>
  );

  const content = (
    <>
      {loadingThread ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={replies}
          keyExtractor={keyExtractor}
          renderItem={renderReply}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListHeaderComponent={
            rootMessage ? (
              <ThreadMessageRow
                message={rootMessage}
                isSelf={rootMessage.did === did}
                colors={colors}
                isAim={isAim}
                isRoot
              />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyReplies}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                {t('chat:threadPanel.replyCount', { count: 0 })}
              </Text>
            </View>
          }
        />
      )}
      {inputBar}
    </>
  );

  if (isAim) {
    return (
      <View style={[styles.container, { backgroundColor: AIM_DESKTOP }]}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <SafeAreaView style={styles.container}>
            <BeveledView
              variant="raised"
              style={[
                styles.aimWindowFrame,
                { backgroundColor: colors.base100 },
                AIM_WINDOW_SHADOW,
              ]}
              innerStyle={{ backgroundColor: colors.base100, flex: 1 }}
            >
              <AimTitlebar title={t('chat:threadPanel.title')} onBack={handleBack} />
              {content}
            </BeveledView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {content}
    </KeyboardAvoidingView>
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
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
  },
  messageContent: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  messageHandle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  messageTime: {
    fontSize: fontSize['2xs'],
    opacity: 0.7,
  },
  messageText: {
    fontSize: fontSize.base,
  },
  messageList: {
    paddingVertical: spacing[4],
    gap: spacing[1],
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    gap: spacing[4],
  },
  textInput: {
    flex: 1,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    fontSize: fontSize.base,
    maxHeight: 100,
  },
  sendButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    minWidth: 56,
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: fontSize.base,
  },
  emptyReplies: {
    padding: spacing[6],
    alignItems: 'center',
  },
  aimWindowFrame: {
    flex: 1,
    marginHorizontal: spacing[3],
  },
});

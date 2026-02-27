import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useRoom } from '@/hooks/useRoom';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/services/auth';
import { useProfile } from '@/services/ProfileContext';
import { Avatar } from '@/components/Avatar';
import { useTheme, type ThemeColors } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { MessageView, ChannelView } from '@/types';

// -- Message row --

const MessageRow = React.memo(function MessageRow({
  message,
  isSelf,
  colors,
}: {
  message: MessageView;
  isSelf: boolean;
  colors: ThemeColors;
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

  return (
    <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
      {!isSelf ? <Avatar url={profile?.avatarUrl} name={handle} size="sm" /> : null}
      <View
        style={[
          styles.messageBubble,
          isSelf ? { backgroundColor: colors.primary } : { backgroundColor: colors.base200 },
        ]}
      >
        {!isSelf ? (
          <Text style={[styles.messageHandle, { color: colors.secondary }]} numberOfLines={1}>
            {profile?.handle ? `@${profile.handle}` : handle}
          </Text>
        ) : null}
        <Text
          style={[
            styles.messageText,
            { color: isSelf ? colors.primaryContent : colors.baseContent },
          ]}
        >
          {message.text}
        </Text>
        <View style={styles.messageFooter}>
          <Text
            style={[
              styles.messageTime,
              { color: isSelf ? colors.primaryContent : colors.chromeTextMuted },
              isSelf && styles.messageTimeSelf,
            ]}
          >
            {time}
          </Text>
          {message.pending ? (
            <Text
              style={[
                styles.pendingLabel,
                { color: isSelf ? colors.primaryContent : colors.chromeTextMuted },
              ]}
            >
              sending...
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

// -- Channel pill selector --

function ChannelPills({
  channels,
  activeId,
  onSelect,
  colors,
}: {
  channels: ChannelView[];
  activeId: string | null;
  onSelect: (ch: ChannelView) => void;
  colors: ThemeColors;
}) {
  if (channels.length <= 1) return null;

  return (
    <View style={[styles.channelBar, { borderBottomColor: colors.borderLight }]}>
      {channels.map((ch) => {
        const active = ch.id === activeId;
        return (
          <Pressable
            key={ch.id}
            style={[
              styles.channelPill,
              {
                backgroundColor: active ? colors.primary : colors.base200,
              },
            ]}
            onPress={() => {
              onSelect(ch);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Channel ${ch.name}`}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.channelPillText,
                { color: active ? colors.primaryContent : colors.baseContent },
              ]}
            >
              {ch.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// -- Typing indicator --

function TypingIndicator({ users, colors }: { users: string[]; colors: ThemeColors }) {
  if (users.length === 0) return null;

  const label =
    users.length === 1
      ? `${users[0].split(':').pop()?.slice(0, 12)} is typing...`
      : `${users.length} people are typing...`;

  return (
    <View style={[styles.typingBar, { borderTopColor: colors.borderLight }]}>
      <Text style={[styles.typingText, { color: colors.chromeTextMuted }]}>{label}</Text>
    </View>
  );
}

// -- Main screen --

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { did } = useAuth();

  const { room, members, channels, loading: roomLoading, error: roomError } = useRoom(id);

  const [activeChannel, setActiveChannel] = useState<ChannelView | null>(null);

  // Auto-select default channel when channels arrive
  const channelsKey = channels.map((c) => c.id).join(',');
  React.useEffect(() => {
    if (channels.length === 0) return;
    // If we don't have an active channel yet, or the current one was deleted
    if (!activeChannel || !channels.find((c) => c.id === activeChannel.id)) {
      const defaultCh = channels.find((c) => c.isDefault) ?? channels[0];
      setActiveChannel(defaultCh);
    }
  }, [channelsKey]);

  const channelId = activeChannel?.id ?? null;
  const channelUri = activeChannel?.uri ?? null;

  const {
    messages,
    loading: messagesLoading,
    typingUsers,
    sendMessage,
    sendTyping,
  } = useMessages(id, channelId);

  // Set header title
  React.useEffect(() => {
    if (room) {
      navigation.setOptions({
        headerShown: true,
        title: room.name,
        headerStyle: { backgroundColor: colors.base200 },
        headerTintColor: colors.baseContent,
        headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
      });
    }
  }, [room, navigation, colors]);

  // -- Input state --
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<MessageView>>(null);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !channelUri) return;
    setInputText('');
    try {
      await sendMessage(text, channelUri);
    } catch {
      // Error is already logged in the hook
    }
  }, [inputText, channelUri, sendMessage]);

  const handleChangeText = useCallback(
    (text: string) => {
      setInputText(text);
      sendTyping();
    },
    [sendTyping],
  );

  // -- Render helpers --
  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<MessageView>) => (
      <MessageRow message={item} isSelf={item.did === did} colors={colors} />
    ),
    [did, colors],
  );

  const keyExtractor = useCallback((item: MessageView) => item.id, []);

  const memberCountLabel = useMemo(() => `${members.length} online`, [members.length]);

  // -- Loading state --
  if (roomLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // -- Error state --
  if (roomError || !room) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {roomError ?? 'Room not found'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Topic + member count */}
      <View style={[styles.subHeader, { backgroundColor: colors.base200 }]}>
        {room.topic ? (
          <Text style={[styles.topic, { color: colors.chromeTextMuted }]} numberOfLines={1}>
            {room.topic}
          </Text>
        ) : null}
        <Text style={[styles.memberCount, { color: colors.chromeTextMuted }]}>
          {memberCountLabel}
        </Text>
      </View>

      {/* Channel selector */}
      <ChannelPills
        channels={channels}
        activeId={channelId}
        onSelect={setActiveChannel}
        colors={colors}
      />

      {/* Messages */}
      {messagesLoading || !channelId ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          inverted={false}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                No messages yet. Say something!
              </Text>
            </View>
          }
        />
      )}

      {/* Typing indicator */}
      <TypingIndicator users={typingUsers} colors={colors} />

      {/* Input bar */}
      <View style={[styles.inputBar, { backgroundColor: colors.base200 }]}>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.surface,
              color: colors.baseContent,
            },
          ]}
          value={inputText}
          onChangeText={handleChangeText}
          placeholder="Type a message..."
          placeholderTextColor={colors.chromeTextMuted}
          returnKeyType="send"
          onSubmitEditing={() => void handleSend()}
          submitBehavior="submit"
          multiline={false}
          accessibilityLabel="Message input"
        />
        <Pressable
          style={[
            styles.sendButton,
            { backgroundColor: inputText.trim() ? colors.primary : colors.base300 },
          ]}
          onPress={() => void handleSend()}
          disabled={!inputText.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Text
            style={[
              styles.sendButtonText,
              { color: inputText.trim() ? colors.primaryContent : colors.chromeTextMuted },
            ]}
          >
            Send
          </Text>
        </Pressable>
      </View>
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
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[3],
  },
  topic: {
    fontSize: fontSize.sm,
    flex: 1,
    marginRight: spacing[4],
  },
  memberCount: {
    fontSize: fontSize.xs,
  },
  channelBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    gap: spacing[3],
    borderBottomWidth: 1,
  },
  channelPill: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
  },
  channelPillText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  messageList: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[3],
    maxWidth: '85%',
  },
  messageRowSelf: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  messageBubble: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    borderRadius: radius.md,
    maxWidth: '100%',
  },
  messageHandle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  messageText: {
    fontSize: fontSize.base,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[1],
  },
  messageTime: {
    fontSize: fontSize['2xs'],
    opacity: 0.7,
  },
  messageTimeSelf: {
    opacity: 0.8,
  },
  pendingLabel: {
    fontSize: fontSize['2xs'],
    fontStyle: 'italic',
    opacity: 0.6,
  },
  typingBar: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
  },
  typingText: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
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
    borderRadius: radius.md,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    fontSize: fontSize.base,
    maxHeight: 100,
  },
  sendButton: {
    borderRadius: radius.md,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
  },
  sendButtonText: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  errorText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: fontSize.base,
  },
});

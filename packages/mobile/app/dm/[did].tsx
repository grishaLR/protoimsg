import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { useTheme, type ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';
import { useDm } from '@/services/DmContext';
import { isWebRTCAvailable } from '@/services/datachannel';
import { useVideoCall } from '@/services/VideoCallContext';
import { useProfile } from '@/services/ProfileContext';
import { useAuth } from '@/services/auth';
import { Avatar } from '@/components/Avatar';
import type { DmMessageView } from '@/types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MessageRow = React.memo(function MessageRow({
  item,
  isSelf,
  colors,
}: {
  item: DmMessageView;
  isSelf: boolean;
  colors: ThemeColors;
}) {
  return (
    <View
      style={[
        styles.messageBubble,
        isSelf ? styles.messageSelf : styles.messagePeer,
        {
          backgroundColor: isSelf ? colors.primary : colors.base300,
        },
      ]}
    >
      <Text
        style={[styles.messageText, { color: isSelf ? colors.primaryContent : colors.baseContent }]}
      >
        {item.text}
      </Text>
      <Text
        style={[
          styles.messageTime,
          {
            color: isSelf ? colors.primaryContent : colors.chromeTextMuted,
            opacity: 0.7,
          },
        ]}
      >
        {formatTime(item.createdAt)}
      </Text>
    </View>
  );
});

export default function DmScreen() {
  const { did: recipientDid } = useLocalSearchParams<{ did: string }>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { did: myDid } = useAuth();
  const { conversations, openDm, closeDm, sendDm, sendTyping, retryConnection } = useDm();
  const { videoCall: startVideoCall } = useVideoCall();
  const profile = useProfile(recipientDid);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<DmMessageView>>(null);
  const lastTypingSentRef = useRef(0);
  const webrtcReady = isWebRTCAvailable();

  const conversation = useMemo(
    () => conversations.find((c) => c.recipientDid === recipientDid),
    [conversations, recipientDid],
  );

  const displayName =
    profile?.displayName ?? profile?.handle ?? recipientDid.split(':').pop()?.slice(0, 16) ?? '';

  const handleVideoCall = useCallback(() => {
    if (!recipientDid) return;
    startVideoCall(recipientDid);
    router.push(`/call/${encodeURIComponent(recipientDid)}`);
  }, [recipientDid, startVideoCall]);

  // Set header options
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: displayName,
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
      headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
      ...(webrtcReady && {
        headerRight: () => (
          <Pressable
            onPress={handleVideoCall}
            style={styles.callButton}
            accessibilityRole="button"
            accessibilityLabel="Video call"
          >
            <Text style={[styles.callButtonText, { color: colors.primary }]}>Call</Text>
          </Pressable>
        ),
      }),
    });
  }, [displayName, navigation, colors, webrtcReady, handleVideoCall]);

  // Open DM on mount, close on unmount
  useEffect(() => {
    if (recipientDid) {
      openDm(recipientDid);
    }
    return () => {
      if (conversation?.conversationId) {
        closeDm(conversation.conversationId);
      }
    };
    // Only run on mount/unmount — don't re-open on every conversation change
  }, [recipientDid]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (conversation?.messages.length) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [conversation?.messages.length]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !conversation?.conversationId) return;
    sendDm(conversation.conversationId, inputText.trim());
    setInputText('');
  }, [inputText, conversation?.conversationId, sendDm]);

  const handleTextChange = useCallback(
    (text: string) => {
      setInputText(text);
      if (!conversation?.conversationId) return;
      const now = Date.now();
      if (now - lastTypingSentRef.current > 3000) {
        lastTypingSentRef.current = now;
        sendTyping(conversation.conversationId);
      }
    },
    [conversation?.conversationId, sendTyping],
  );

  const handleRetry = useCallback(() => {
    if (conversation?.conversationId) {
      retryConnection(conversation.conversationId);
    }
  }, [conversation?.conversationId, retryConnection]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DmMessageView>) => {
      const isSelf = item.senderDid === myDid;
      return <MessageRow item={item} isSelf={isSelf} colors={colors} />;
    },
    [myDid, colors],
  );

  const keyExtractor = useCallback((item: DmMessageView) => item.id, []);

  const peerState = conversation?.peerState ?? 'connecting';
  const closingIn = conversation?.closingIn ?? null;

  if (!webrtcReady) {
    return (
      <View
        style={[styles.container, styles.unavailableContainer, { backgroundColor: colors.surface }]}
      >
        <Text style={[styles.unavailableTitle, { color: colors.baseContent }]}>
          Dev Client Required
        </Text>
        <Text style={[styles.unavailableText, { color: colors.chromeTextMuted }]}>
          DMs require WebRTC which needs a native dev client build. Run{' '}
          <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
            expo prebuild
          </Text>{' '}
          then build with Xcode or Android Studio.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Connection status banner */}
      {peerState === 'connecting' && (
        <View style={[styles.statusBanner, { backgroundColor: colors.base200 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.statusText, { color: colors.chromeTextMuted }]}>Connecting...</Text>
        </View>
      )}
      {peerState === 'failed' && (
        <View style={[styles.statusBanner, { backgroundColor: colors.errorBannerBg }]}>
          <Text style={[styles.statusText, { color: colors.errorBannerText }]}>
            Connection failed
          </Text>
          <Pressable
            onPress={handleRetry}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryContent }]}>Retry</Text>
          </Pressable>
        </View>
      )}
      {peerState === 'closed' && closingIn !== null && (
        <View style={[styles.statusBanner, { backgroundColor: colors.base200 }]}>
          <Text style={[styles.statusText, { color: colors.chromeTextMuted }]}>
            Closing in {closingIn}...
          </Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={conversation?.messages ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyAvatarRow}>
              <Avatar url={profile?.avatarUrl} name={displayName} size="lg" />
            </View>
            <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
              {peerState === 'open'
                ? 'Say something!'
                : peerState === 'connecting'
                  ? 'Waiting for connection...'
                  : ''}
            </Text>
          </View>
        }
      />

      {/* Typing indicator */}
      {conversation?.typing && (
        <View style={styles.typingContainer}>
          <Text style={[styles.typingText, { color: colors.chromeTextMuted }]}>typing...</Text>
        </View>
      )}

      {/* Input bar */}
      <View
        style={[
          styles.inputBar,
          { backgroundColor: colors.base200, borderTopColor: colors.borderLight },
        ]}
      >
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.base100,
              color: colors.baseContent,
              borderColor: colors.borderLight,
            },
          ]}
          value={inputText}
          onChangeText={handleTextChange}
          placeholder="Send a message..."
          placeholderTextColor={colors.chromeTextMuted}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={peerState === 'open' || peerState === 'connecting'}
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim() || !conversation?.conversationId}
          style={[
            styles.sendButton,
            {
              backgroundColor: inputText.trim() ? colors.primary : colors.base300,
            },
          ]}
        >
          <Text
            style={[
              styles.sendText,
              {
                color: inputText.trim() ? colors.primaryContent : colors.chromeTextMuted,
              },
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
  unavailableContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[12],
  },
  unavailableTitle: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    marginBottom: spacing[4],
  },
  unavailableText: {
    fontSize: fontSize.base,
    textAlign: 'center',
    lineHeight: fontSize.base * 1.5,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  statusText: {
    fontSize: fontSize.sm,
  },
  retryButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.sm,
  },
  retryText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  messageList: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    flexGrow: 1,
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    marginVertical: spacing[1],
  },
  messageSelf: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: spacing[1],
  },
  messagePeer: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: spacing[1],
  },
  messageText: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.4,
  },
  messageTime: {
    fontSize: fontSize['2xs'],
    marginTop: spacing[1],
    textAlign: 'right',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[16],
  },
  emptyAvatarRow: {
    marginBottom: spacing[4],
  },
  emptyText: {
    fontSize: fontSize.sm,
  },
  typingContainer: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[1],
  },
  typingText: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    gap: spacing[2],
  },
  textInput: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    fontSize: fontSize.base,
  },
  sendButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  callButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  callButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});

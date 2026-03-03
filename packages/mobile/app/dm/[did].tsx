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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW, type ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';
import { useDm } from '@/services/DmContext';
import { isWebRTCAvailable } from '@/services/datachannel';
import { useVideoCall } from '@/services/VideoCallContext';
import { useProfile } from '@/services/ProfileContext';
import { useAuth } from '@/services/auth';
import { Avatar } from '@/components/Avatar';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import type { DmMessageView } from '@/types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function TypingDots({ color }: { color: string }) {
  const { t } = useTranslation('dm');
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => {
      clearInterval(id);
    };
  }, []);

  return (
    <View style={styles.typingContainer}>
      <Text style={[styles.typingText, { color }]}>
        {t('typing.label')}
        {dots}
      </Text>
    </View>
  );
}

function getStatusColors(colors: ThemeColors) {
  return {
    connecting: colors.warning,
    open: colors.success,
    failed: colors.error,
    closed: colors.statusOffline,
  };
}

const MessageRow = React.memo(function MessageRow({
  item,
  isSelf,
  colors,
  isAim,
}: {
  item: DmMessageView;
  isSelf: boolean;
  colors: ThemeColors;
  isAim: boolean;
}) {
  const bubbleBg = isAim
    ? isSelf
      ? colors.primary
      : colors.base200
    : isSelf
      ? colors.primary
      : colors.base200;

  return (
    <View
      style={[
        styles.messageBubble,
        isSelf ? styles.messageSelf : styles.messagePeer,
        { backgroundColor: bubbleBg, borderRadius: isAim ? 0 : radius.md },
        isAim && (isSelf ? styles.messageSelfAim : styles.messagePeerAim),
      ]}
    >
      <Text
        style={[styles.messageText, { color: isSelf ? colors.primaryContent : colors.baseContent }]}
      >
        {item.text}
      </Text>
      <View style={styles.messageFooter}>
        {item.pending ? (
          <ActivityIndicator
            size={10}
            color={isSelf ? colors.primaryContent : colors.chromeTextMuted}
            style={styles.pendingSpinner}
          />
        ) : null}
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
    </View>
  );
});

export default function DmScreen() {
  const { t } = useTranslation(['dm', 'chat', 'common']);
  const { did: recipientDid } = useLocalSearchParams<{ did: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const statusColors = getStatusColors(colors);
  const { isAim, aimRadius } = useAimStyle();
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
    router.push(`/call/${encodeURIComponent(recipientDid)}` as never);
  }, [recipientDid, startVideoCall, router]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // Set header options
  useEffect(() => {
    navigation.setOptions({
      headerShown: !isAim,
      title: displayName,
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
      headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
      ...(webrtcReady &&
        !isAim && {
          headerRight: () => (
            <Pressable
              onPress={handleVideoCall}
              style={styles.callButton}
              accessibilityRole="button"
              accessibilityLabel={t('chat:buddyMenu.videoCall')}
            >
              <Text style={[styles.callButtonText, { color: colors.primary }]}>
                {t('chat:buddyMenu.call')}
              </Text>
            </Pressable>
          ),
        }),
    });
  }, [displayName, navigation, colors, webrtcReady, handleVideoCall, isAim]);

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
      return <MessageRow item={item} isSelf={isSelf} colors={colors} isAim={isAim} />;
    },
    [myDid, colors, isAim],
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
          {t('devClientRequired.title')}
        </Text>
        <Text style={[styles.unavailableText, { color: colors.chromeTextMuted }]}>
          {t('devClientRequired.description')}
        </Text>
      </View>
    );
  }

  const statusBanners = (
    <>
      {peerState === 'connecting' && (
        <View style={[styles.statusBanner, { backgroundColor: statusColors.connecting + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors.connecting }]} />
          <ActivityIndicator size="small" color={statusColors.connecting} />
          <Text style={[styles.statusText, { color: colors.baseContent }]}>
            {t('status.connecting')}
          </Text>
        </View>
      )}
      {peerState === 'open' && conversation?.messages.length === 0 && (
        <View style={[styles.statusBanner, { backgroundColor: statusColors.open + '15' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors.open }]} />
          <Text style={[styles.statusText, { color: colors.baseContent }]}>
            {t('status.connected')}
          </Text>
        </View>
      )}
      {peerState === 'failed' && (
        <View style={[styles.statusBanner, { backgroundColor: statusColors.failed + '18' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors.failed }]} />
          <Text style={[styles.statusText, { color: colors.errorBannerText }]}>
            {t('status.connectionFailed')}
          </Text>
          <Pressable
            onPress={handleRetry}
            style={[
              styles.retryButton,
              { backgroundColor: colors.primary, borderRadius: aimRadius ?? radius.sm },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.primaryContent }]}>
              {t('common:button.retry')}
            </Text>
          </Pressable>
        </View>
      )}
      {peerState === 'closed' && closingIn !== null && (
        <View style={[styles.statusBanner, { backgroundColor: statusColors.closed + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors.closed }]} />
          <Text style={[styles.statusText, { color: colors.chromeTextMuted }]}>
            {t('status.closingIn', { seconds: closingIn })}
          </Text>
        </View>
      )}
    </>
  );

  const messageArea = (
    <BeveledView
      variant="sunken"
      style={isAim ? styles.aimMessageArea : styles.messageAreaFlex}
      innerStyle={isAim ? { backgroundColor: colors.surfaceContent, flex: 1 } : { flex: 1 }}
    >
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
                ? t('status.saySomething')
                : peerState === 'connecting'
                  ? t('status.waitingForConnection')
                  : ''}
            </Text>
          </View>
        }
      />
    </BeveledView>
  );

  const inputBar = isAim ? (
    <View style={[styles.aimInputBarOuter, { backgroundColor: colors.base100 }]}>
      <View style={[styles.inputBar, { backgroundColor: colors.base100 }]}>
        <View style={styles.aimInputSunkenOuter}>
          <View style={[styles.aimInputSunkenInner, { backgroundColor: colors.surfaceContent }]}>
            <TextInput
              style={[
                styles.textInput,
                {
                  flex: undefined,
                  backgroundColor: colors.surfaceContent,
                  color: colors.baseContent,
                  borderRadius: 0,
                },
              ]}
              value={inputText}
              onChangeText={handleTextChange}
              placeholder={t('input.placeholder')}
              placeholderTextColor={colors.chromeTextMuted}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              editable={peerState === 'open' || peerState === 'connecting'}
            />
          </View>
        </View>
        <View style={styles.aimSendRaisedOuter}>
          <View style={styles.aimSendRaisedInner}>
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim() || !conversation?.conversationId}
              style={[styles.sendButton, { backgroundColor: colors.base100, borderRadius: 0 }]}
            >
              <Text style={[styles.sendText, { color: colors.baseContent }]}>
                {t('input.send')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  ) : (
    <View
      style={[
        styles.inputBar,
        { backgroundColor: colors.base200, borderTopColor: colors.borderLight, borderTopWidth: 1 },
      ]}
    >
      <TextInput
        style={[
          styles.textInput,
          {
            backgroundColor: colors.base100,
            color: colors.baseContent,
            borderColor: colors.borderLight,
            borderWidth: 1,
            borderRadius: radius.md,
          },
        ]}
        value={inputText}
        onChangeText={handleTextChange}
        placeholder={t('input.placeholder')}
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
            borderRadius: radius.md,
          },
        ]}
      >
        <Text
          style={[
            styles.sendText,
            { color: inputText.trim() ? colors.primaryContent : colors.chromeTextMuted },
          ]}
        >
          {t('input.send')}
        </Text>
      </Pressable>
    </View>
  );

  if (isAim) {
    return (
      <View style={[styles.container, { backgroundColor: AIM_DESKTOP }]}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <BeveledView
            variant="raised"
            style={[
              styles.aimWindowFrame,
              {
                backgroundColor: colors.base100,
                marginTop: insets.top + spacing[3],
                marginBottom: insets.bottom + spacing[3],
              },
              AIM_WINDOW_SHADOW,
            ]}
            innerStyle={{ backgroundColor: colors.base100, flex: 1 }}
          >
            <AimTitlebar title={`${t('common:appName')} - ${displayName}`} onBack={handleBack} />
            {statusBanners}
            {messageArea}
            {conversation?.typing ? <TypingDots color={colors.chromeTextMuted} /> : null}
            {inputBar}
          </BeveledView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {statusBanners}
      {messageArea}
      {conversation?.typing ? <TypingDots color={colors.chromeTextMuted} /> : null}
      {inputBar}
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
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: fontSize.sm,
  },
  retryButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  retryText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  messageAreaFlex: {
    flex: 1,
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
    marginVertical: spacing[1],
  },
  messageSelf: {
    alignSelf: 'flex-end',
  },
  messagePeer: {
    alignSelf: 'flex-start',
  },
  messageSelfAim: {
    borderWidth: 1,
    borderTopColor: '#dfdfdf',
    borderLeftColor: '#dfdfdf',
    borderBottomColor: '#808080',
    borderRightColor: '#808080',
  },
  messagePeerAim: {
    borderWidth: 1,
    borderTopColor: '#808080',
    borderLeftColor: '#808080',
    borderBottomColor: '#dfdfdf',
    borderRightColor: '#dfdfdf',
  },
  messageText: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.4,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  pendingSpinner: {
    marginRight: 2,
  },
  messageTime: {
    fontSize: fontSize['2xs'],
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
    gap: spacing[2],
  },
  textInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: spacing[3],
    fontSize: fontSize.base,
  },
  sendButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
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
  // AIM-specific styles
  aimWindowFrame: {
    flex: 1,
    marginHorizontal: spacing[3],
  },
  aimMessageArea: {
    flex: 1,
    marginHorizontal: spacing[3],
    marginVertical: spacing[2],
  },
  aimInputBarOuter: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[2],
  },
  aimInputSunkenOuter: {
    flex: 1,
    borderWidth: 1,
    borderTopColor: '#808080',
    borderLeftColor: '#808080',
    borderBottomColor: '#fff',
    borderRightColor: '#fff',
  },
  aimInputSunkenInner: {
    borderWidth: 1,
    borderTopColor: '#0a0a0a',
    borderLeftColor: '#0a0a0a',
    borderBottomColor: '#dfdfdf',
    borderRightColor: '#dfdfdf',
  },
  aimSendRaisedOuter: {
    borderWidth: 1,
    borderTopColor: '#fff',
    borderLeftColor: '#fff',
    borderBottomColor: '#0a0a0a',
    borderRightColor: '#0a0a0a',
  },
  aimSendRaisedInner: {
    borderWidth: 1,
    borderTopColor: '#dfdfdf',
    borderLeftColor: '#dfdfdf',
    borderBottomColor: '#808080',
    borderRightColor: '#808080',
  },
});

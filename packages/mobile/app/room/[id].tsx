import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useRoom } from '@/hooks/useRoom';
import { useMessages } from '@/hooks/useMessages';
import { usePolls } from '@/hooks/usePolls';
import { useAuth } from '@/services/auth';
import { useWebSocket } from '@/services/WebSocketContext';
import { useVideoCall } from '@/services/VideoCallContext';
import { isWebRTCAvailable } from '@/services/datachannel';
import { useProfile } from '@/services/ProfileContext';
import { useBlockSync } from '@/hooks/useBlockSync';
import { addToBuddyList } from '@/services/atproto';
import { lightTap } from '@/services/haptics';
import { MoreHorizontal, Phone } from 'lucide-react-native';
import { useGroupCall } from '@/services/GroupCallContext';
import { Avatar } from '@/components/Avatar';
import { RichText } from '@/components/RichText';
import { EmbedRenderer, isGifEmbed } from '@/components/EmbedRenderer';
import { MessageActionSheet } from '@/components/MessageActionSheet';
import { ReportModal } from '@/components/ReportModal';
import { PollCard } from '@/components/PollCard';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import { useContentTranslation } from '@/hooks/useContentTranslation';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW, type ThemeColors } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { MessageView, ChannelView, MemberPresence, TimelineItem } from '@/types';

// -- Message row --

const MessageRow = React.memo(function MessageRow({
  message,
  isSelf,
  colors,
  isAim,
  translatedText,
  showTranslated,
  replyCount,
  onLongPress,
  onReplyCountPress,
  onHandlePress,
}: {
  message: MessageView;
  isSelf: boolean;
  colors: ThemeColors;
  isAim: boolean;
  translatedText?: string;
  showTranslated: boolean;
  replyCount: number;
  onLongPress: (message: MessageView) => void;
  onReplyCountPress: (message: MessageView) => void;
  onHandlePress: (message: MessageView) => void;
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
  const { t } = useTranslation('chat');

  const bubbleBg = isAim
    ? isSelf
      ? colors.primary
      : colors.base200
    : isSelf
      ? colors.primary
      : colors.base200;

  const isGif = isGifEmbed(message.embed);
  const hasEmbed =
    message.embed != null &&
    typeof message.embed === 'object' &&
    'uri' in (message.embed as Record<string, unknown>);

  return (
    <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
      {!isSelf ? <Avatar url={profile?.avatarUrl} name={handle} size="sm" /> : null}
      <Pressable
        onLongPress={() => {
          void lightTap();
          onLongPress(message);
        }}
        delayLongPress={300}
      >
        <View
          style={[
            styles.messageBubble,
            { backgroundColor: bubbleBg, borderRadius: isAim ? 0 : radius.md },
            isAim && (isSelf ? styles.messageSelfAim : styles.messagePeerAim),
          ]}
        >
          {!isSelf ? (
            <Pressable
              onPress={() => {
                onHandlePress(message);
              }}
            >
              <Text style={[styles.messageHandle, { color: colors.secondary }]} numberOfLines={1}>
                {profile?.handle ? `@${profile.handle}` : handle}
              </Text>
            </Pressable>
          ) : null}
          {/* Text — hidden for GIF embeds (text is fallback URL) */}
          {!isGif ? (
            showTranslated && translatedText ? (
              <Text
                style={[
                  styles.messageText,
                  { color: isSelf ? colors.primaryContent : colors.baseContent },
                ]}
              >
                {translatedText}
              </Text>
            ) : message.facets && message.facets.length > 0 ? (
              <RichText
                text={message.text}
                facets={message.facets as React.ComponentProps<typeof RichText>['facets']}
                colors={isSelf ? { ...colors, baseContent: colors.primaryContent } : colors}
              />
            ) : (
              <Text
                style={[
                  styles.messageText,
                  { color: isSelf ? colors.primaryContent : colors.baseContent },
                ]}
              >
                {message.text}
              </Text>
            )
          ) : null}
          {/* Embed / GIF */}
          {hasEmbed ? <EmbedRenderer embed={message.embed} colors={colors} isAim={isAim} /> : null}
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
            {showTranslated && translatedText ? (
              <Text
                style={[
                  styles.translatedLabel,
                  { color: isSelf ? colors.primaryContent : colors.chromeTextMuted },
                ]}
              >
                translated
              </Text>
            ) : null}
            {message.pending ? (
              <ActivityIndicator
                size={10}
                color={isSelf ? colors.primaryContent : colors.chromeTextMuted}
              />
            ) : null}
          </View>
        </View>
        {/* Reply count badge */}
        {replyCount > 0 ? (
          <Pressable
            onPress={() => {
              onReplyCountPress(message);
            }}
          >
            <Text style={[styles.replyCountBadge, { color: colors.primary }]}>
              {t('messageItem.replyCount', { count: replyCount })}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});

// -- Channel pill selector --

function ChannelPills({
  channels,
  activeId,
  onSelect,
  colors,
  isAim,
}: {
  channels: ChannelView[];
  activeId: string | null;
  onSelect: (ch: ChannelView) => void;
  colors: ThemeColors;
  isAim: boolean;
}) {
  const { t } = useTranslation('rooms');
  if (channels.length <= 1) return null;

  return (
    <View
      style={[
        styles.channelBar,
        { borderBottomColor: isAim ? colors.borderDark : colors.borderLight },
      ]}
    >
      {channels.map((ch) => {
        const active = ch.id === activeId;
        return (
          <Pressable
            key={ch.id}
            style={[
              styles.channelPill,
              {
                backgroundColor: active ? colors.primary : isAim ? colors.base100 : colors.base200,
                borderRadius: isAim ? 0 : radius.pill,
              },
              isAim && !active && styles.channelPillAim,
            ]}
            onPress={() => {
              onSelect(ch);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('accessibility.channel', { name: ch.name })}
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
  const { t: tChat } = useTranslation('chat');
  if (users.length === 0) return null;

  const label =
    users.length === 1
      ? `${users[0].split(':').pop()?.slice(0, 12)} ${tChat('messageList.typing.one')}`
      : tChat('messageList.typing.many', { count: users.length });

  return (
    <View style={[styles.typingBar, { borderTopColor: colors.borderLight }]}>
      <Text style={[styles.typingText, { color: colors.chromeTextMuted }]}>{label}</Text>
    </View>
  );
}

// -- Member list bottom sheet --

function MemberRow({
  member,
  colors,
  onMenu,
}: {
  member: MemberPresence;
  colors: ThemeColors;
  onMenu?: (member: MemberPresence) => void;
}) {
  const profile = useProfile(member.did);
  const handle =
    profile?.displayName ??
    profile?.handle ??
    member.did.split(':').pop()?.slice(0, 12) ??
    member.did;

  const statusColor =
    member.status === 'online'
      ? colors.success
      : member.status === 'away' || member.status === 'idle'
        ? colors.warning
        : colors.statusOffline;

  return (
    <View style={styles.memberRow}>
      <Avatar url={profile?.avatarUrl} name={handle} size="sm" />
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: colors.baseContent }]} numberOfLines={1}>
          {handle}
        </Text>
        {profile?.handle ? (
          <Text style={[styles.memberHandle, { color: colors.chromeTextMuted }]} numberOfLines={1}>
            @{profile.handle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.memberStatusDot, { backgroundColor: statusColor }]} />
      {onMenu ? (
        <Pressable
          style={styles.memberMenuButton}
          onPress={() => {
            onMenu(member);
          }}
          accessibilityRole="button"
          accessibilityLabel="Actions"
          hitSlop={8}
        >
          <MoreHorizontal size={18} color={colors.chromeTextMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// -- Main screen --

export default function RoomScreen() {
  const { t } = useTranslation(['rooms', 'chat', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isAim } = useAimStyle();
  const { did, agent } = useAuth();
  const { send } = useWebSocket();
  const { videoCall } = useVideoCall();
  const { roomCalls, activeGroupCall, startGroupCall, joinGroupCall } = useGroupCall();
  const { blockedDids, resync: resyncBlocks } = useBlockSync();
  const webrtcReady = isWebRTCAvailable();
  const {
    autoTranslate,
    available: translateAvailable,
    getTranslation,
    requestTranslation,
    requestBatchTranslation,
  } = useContentTranslation();
  const translatedCountRef = useRef(0);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const { room, members, channels, loading: roomLoading, error: roomError } = useRoom(id);

  const [activeChannel, setActiveChannel] = useState<ChannelView | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [slowCooldown, setSlowCooldown] = useState(0);

  // Action sheet + report modal state
  const [selectedMessage, setSelectedMessage] = useState<MessageView | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Auto-select default channel when channels arrive
  const channelsKey = channels.map((c) => c.id).join(',');
  useEffect(() => {
    if (channels.length === 0) return;
    if (!activeChannel || !channels.find((c) => c.id === activeChannel.id)) {
      const defaultCh = channels.find((c) => c.isDefault) ?? channels[0];
      setActiveChannel(defaultCh);
    }
  }, [channelsKey]);

  const channelId = activeChannel?.id ?? null;
  const channelUri = activeChannel?.uri ?? null;

  const {
    messages,
    replyCounts,
    loading: messagesLoading,
    typingUsers,
    sendMessage,
    sendTyping,
  } = useMessages(id, channelId);

  const { polls, castVote } = usePolls(id, channelId);

  // Reset translation counter on channel change
  useEffect(() => {
    translatedCountRef.current = 0;
  }, [channelId]);

  // Auto-translate new messages
  useEffect(() => {
    if (!autoTranslate || messages.length === 0) return;
    const newMessages = messages.slice(translatedCountRef.current);
    translatedCountRef.current = messages.length;
    if (newMessages.length === 0) return;
    requestBatchTranslation(newMessages.map((m) => m.text));
  }, [autoTranslate, messages.length, requestBatchTranslation]);

  // Group call from room
  const [groupCallPending, setGroupCallPending] = useState(false);

  useEffect(() => {
    if (groupCallPending && activeGroupCall) {
      setGroupCallPending(false);
      router.push('/group-call');
    }
  }, [groupCallPending, activeGroupCall, router]);

  const handleGroupCall = useCallback(() => {
    const roomCall = roomCalls.get(id);
    if (roomCall) {
      joinGroupCall(roomCall.callId);
    } else {
      startGroupCall(id);
    }
    setGroupCallPending(true);
  }, [id, roomCalls, startGroupCall, joinGroupCall]);

  // Set header title
  useEffect(() => {
    if (room) {
      const roomCall = roomCalls.get(id);
      const isInCall = activeGroupCall?.roomId === id;
      navigation.setOptions({
        headerShown: !isAim,
        title: room.name,
        headerStyle: { backgroundColor: colors.base200 },
        headerTintColor: colors.baseContent,
        headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
        headerRight: isInCall
          ? undefined
          : () => (
              <Pressable onPress={handleGroupCall} style={{ paddingHorizontal: 12 }}>
                <Phone size={18} color={roomCall ? '#22c55e' : colors.baseContent} />
              </Pressable>
            ),
      });
    }
  }, [room, navigation, colors, isAim, roomCalls, id, activeGroupCall, handleGroupCall]);

  // Slow mode countdown
  useEffect(() => {
    if (slowCooldown <= 0) return;
    const t = setInterval(() => {
      setSlowCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [slowCooldown]);

  // -- Input state --
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<TimelineItem>>(null);

  const slowModeSeconds = room?.slow_mode_seconds ?? 0;

  // -- Action sheet handlers --
  const handleMessageLongPress = useCallback((message: MessageView) => {
    setSelectedMessage(message);
  }, []);

  const handleReply = useCallback(
    (message: MessageView) => {
      if (!channelId || !channelUri) return;
      router.push({
        pathname: '/room/thread',
        params: { messageUri: message.uri, roomId: id, channelId, channelUri },
      });
    },
    [router, id, channelId, channelUri],
  );

  const handleTranslate = useCallback(
    (message: MessageView) => {
      requestTranslation(message.text);
    },
    [requestTranslation],
  );

  const handleAddBuddy = useCallback(
    async (message: MessageView) => {
      if (!agent) return;
      try {
        const result = await addToBuddyList(agent, send, message.did);
        Alert.alert(
          result === 'added'
            ? t('chat:messageItem.addBuddyFeedback.added')
            : t('chat:messageItem.addBuddyFeedback.alreadyInList'),
        );
      } catch {
        Alert.alert(t('chat:messageItem.addBuddyFeedback.error'));
      }
    },
    [agent, send, t],
  );

  const handleReport = useCallback((message: MessageView) => {
    setSelectedMessage(message);
    setShowReport(true);
  }, []);

  const handleMemberMenu = useCallback(
    (member: MemberPresence) => {
      if (member.did === did) return;

      const isOffline = member.status === 'offline';
      const isBlocked = blockedDids.has(member.did);

      const dmLabel = t('chat:buddyMenu.openDm');
      const callLabel = t('chat:buddyMenu.call');
      const addBuddyLabel = t('chat:messageItem.addBuddy');
      const blockLabel = isBlocked
        ? t('chat:buddyMenu.unblock', { defaultValue: 'Unblock' })
        : t('chat:buddyMenu.block', { defaultValue: 'Block' });
      const reportLabel = t('chat:messageItem.reportButton');
      const cancelLabel = t('common:button.cancel');

      const options = [
        !isOffline ? dmLabel : null,
        !isOffline && webrtcReady ? callLabel : null,
        addBuddyLabel,
        blockLabel,
        reportLabel,
        cancelLabel,
      ].filter((o): o is string => o !== null);

      const cancelIndex = options.indexOf(cancelLabel);
      const destructiveIndex = options.indexOf(blockLabel);

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex },
          (index) => {
            const selected = options[index];
            if (selected === dmLabel) {
              router.push(`/dm/${encodeURIComponent(member.did)}`);
            } else if (selected === callLabel) {
              videoCall(member.did);
              router.push(`/call/${encodeURIComponent(member.did)}`);
            } else if (selected === addBuddyLabel && agent) {
              void addToBuddyList(agent, send, member.did).then((result) => {
                Alert.alert(
                  result === 'added'
                    ? t('chat:messageItem.addBuddyFeedback.added')
                    : t('chat:messageItem.addBuddyFeedback.alreadyInList'),
                );
              });
            } else if (selected === blockLabel && agent) {
              void (async () => {
                try {
                  if (isBlocked) {
                    // Find and delete the block record
                    const res = await agent.com.atproto.repo.listRecords({
                      repo: agent.assertDid,
                      collection: 'app.bsky.graph.block',
                      limit: 100,
                    });
                    const blockRecord = res.data.records.find(
                      (r) => (r.value as { subject?: string }).subject === member.did,
                    );
                    if (blockRecord) {
                      const rkey = blockRecord.uri.split('/').pop() ?? '';
                      await agent.com.atproto.repo.deleteRecord({
                        repo: agent.assertDid,
                        collection: 'app.bsky.graph.block',
                        rkey,
                      });
                    }
                  } else {
                    await agent.com.atproto.repo.createRecord({
                      repo: agent.assertDid,
                      collection: 'app.bsky.graph.block',
                      record: {
                        $type: 'app.bsky.graph.block',
                        subject: member.did,
                        createdAt: new Date().toISOString(),
                      },
                    });
                  }
                  void resyncBlocks();
                } catch (err) {
                  console.error('Failed to toggle block:', err);
                }
              })();
            } else if (selected === reportLabel) {
              setShowReport(true);
              // Use member DID as subject URI for report
              setSelectedMessage({ uri: `at://${member.did}`, did: member.did } as MessageView);
            }
          },
        );
      } else {
        Alert.alert('', undefined, [
          ...(isOffline
            ? []
            : [
                {
                  text: dmLabel,
                  onPress: () => {
                    router.push(`/dm/${encodeURIComponent(member.did)}`);
                  },
                },
              ]),
          ...(webrtcReady && !isOffline
            ? [
                {
                  text: callLabel,
                  onPress: () => {
                    videoCall(member.did);
                    router.push(`/call/${encodeURIComponent(member.did)}`);
                  },
                },
              ]
            : []),
          {
            text: addBuddyLabel,
            onPress: () => {
              if (!agent) return;
              void addToBuddyList(agent, send, member.did).then((result) => {
                Alert.alert(
                  result === 'added'
                    ? t('chat:messageItem.addBuddyFeedback.added')
                    : t('chat:messageItem.addBuddyFeedback.alreadyInList'),
                );
              });
            },
          },
          {
            text: blockLabel,
            style: 'destructive' as const,
            onPress: () => {
              // same block toggle logic
              if (!agent) return;
              void (async () => {
                try {
                  if (isBlocked) {
                    const res = await agent.com.atproto.repo.listRecords({
                      repo: agent.assertDid,
                      collection: 'app.bsky.graph.block',
                      limit: 100,
                    });
                    const blockRecord = res.data.records.find(
                      (r) => (r.value as { subject?: string }).subject === member.did,
                    );
                    if (blockRecord) {
                      const rkey = blockRecord.uri.split('/').pop() ?? '';
                      await agent.com.atproto.repo.deleteRecord({
                        repo: agent.assertDid,
                        collection: 'app.bsky.graph.block',
                        rkey,
                      });
                    }
                  } else {
                    await agent.com.atproto.repo.createRecord({
                      repo: agent.assertDid,
                      collection: 'app.bsky.graph.block',
                      record: {
                        $type: 'app.bsky.graph.block',
                        subject: member.did,
                        createdAt: new Date().toISOString(),
                      },
                    });
                  }
                  void resyncBlocks();
                } catch (err) {
                  console.error('Failed to toggle block:', err);
                }
              })();
            },
          },
          {
            text: reportLabel,
            onPress: () => {
              setShowReport(true);
              setSelectedMessage({ uri: `at://${member.did}`, did: member.did } as MessageView);
            },
          },
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [did, agent, send, videoCall, blockedDids, resyncBlocks, webrtcReady, router, t],
  );

  /** Open member menu when tapping a username in a message */
  const handleHandlePress = useCallback(
    (message: MessageView) => {
      // Find the member presence for this DID, or create a minimal one
      const member = members.find((m) => m.did === message.did) ?? {
        did: message.did,
        status: 'offline' as const,
      };
      handleMemberMenu(member);
    },
    [members, handleMemberMenu],
  );

  const handleReplyCountPress = useCallback(
    (message: MessageView) => {
      if (!channelId || !channelUri) return;
      router.push({
        pathname: '/room/thread',
        params: { messageUri: message.uri, roomId: id, channelId, channelUri },
      });
    },
    [router, id, channelId, channelUri],
  );

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !channelUri) return;
    setInputText('');
    if (slowModeSeconds > 0) {
      setSlowCooldown(slowModeSeconds);
    }
    try {
      await sendMessage(text, channelUri);
    } catch {
      // Error is already logged in the hook
    }
  }, [inputText, channelUri, sendMessage, slowModeSeconds]);

  const handleChangeText = useCallback(
    (text: string) => {
      setInputText(text);
      sendTyping();
    },
    [sendTyping],
  );

  // -- Timeline merge: root messages + polls, sorted by created_at --
  const timeline = useMemo<TimelineItem[]>(() => {
    const rootMessages: TimelineItem[] = messages
      .filter((m) => !m.reply_root)
      .map((m) => ({ ...m, _type: 'message' as const }));
    const pollItems: TimelineItem[] = polls.map((p) => ({ ...p, _type: 'poll' as const }));
    return [...rootMessages, ...pollItems].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages, polls]);

  // -- Render helpers --
  const renderTimelineItem = useCallback(
    ({ item }: ListRenderItemInfo<TimelineItem>) => {
      if (item._type === 'poll') {
        return (
          <PollCard
            poll={item}
            colors={colors}
            isAim={isAim}
            onVote={(pollId, pollUri, opts) => void castVote(pollId, pollUri, opts)}
          />
        );
      }
      return (
        <MessageRow
          message={item}
          isSelf={item.did === did}
          colors={colors}
          isAim={isAim}
          translatedText={getTranslation(item.text)}
          showTranslated={autoTranslate}
          replyCount={replyCounts[item.uri] ?? 0}
          onLongPress={handleMessageLongPress}
          onReplyCountPress={handleReplyCountPress}
          onHandlePress={handleHandlePress}
        />
      );
    },
    [
      did,
      colors,
      isAim,
      autoTranslate,
      getTranslation,
      replyCounts,
      castVote,
      handleMessageLongPress,
      handleReplyCountPress,
      handleHandlePress,
    ],
  );

  const keyExtractor = useCallback((item: TimelineItem) => item.id, []);

  const onlineMemberCount = useMemo(
    () => members.filter((m) => m.status !== 'offline').length,
    [members],
  );

  // -- Loading state --
  if (roomLoading) {
    return (
      <View style={[styles.container, { backgroundColor: isAim ? AIM_DESKTOP : colors.surface }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // -- Error state --
  if (roomError || !room) {
    return (
      <View style={[styles.container, { backgroundColor: isAim ? AIM_DESKTOP : colors.surface }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {roomError ?? t('chatRoom.notFound')}
          </Text>
        </View>
      </View>
    );
  }

  const canSend = slowCooldown <= 0 && !!inputText.trim();

  const subHeader = (
    <View style={[styles.subHeader, { backgroundColor: isAim ? colors.base100 : colors.base200 }]}>
      {room.topic ? (
        <Text style={[styles.topic, { color: colors.chromeTextMuted }]} numberOfLines={1}>
          {room.topic}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          setShowMembers(true);
        }}
        accessibilityRole="button"
      >
        <Text style={[styles.memberCount, { color: colors.primary }]}>
          {t('chat:memberList.heading', { count: onlineMemberCount })}
        </Text>
      </Pressable>
    </View>
  );

  const messageArea = (
    <BeveledView
      variant="sunken"
      style={isAim ? styles.aimMessageArea : styles.messageAreaFlex}
      innerStyle={isAim ? { backgroundColor: colors.surfaceContent, flex: 1 } : { flex: 1 }}
    >
      {messagesLoading || !channelId ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={timeline}
          keyExtractor={keyExtractor}
          renderItem={renderTimelineItem}
          contentContainerStyle={styles.messageList}
          inverted={false}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                {t('chatRoom.noMessagesYet')}
              </Text>
            </View>
          }
        />
      )}
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
              onChangeText={handleChangeText}
              placeholder={t('chat:messageInput.placeholder.default')}
              placeholderTextColor={colors.chromeTextMuted}
              returnKeyType="send"
              onSubmitEditing={() => void handleSend()}
              submitBehavior="submit"
              multiline={false}
              accessibilityLabel={t('rooms:accessibility.messageInput')}
            />
          </View>
        </View>
        <View style={styles.aimSendRaisedOuter}>
          <View style={styles.aimSendRaisedInner}>
            <Pressable
              style={[styles.sendButton, { backgroundColor: colors.base100, borderRadius: 0 }]}
              onPress={() => void handleSend()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={
                slowCooldown > 0
                  ? t('rooms:accessibility.slowModeWait', { seconds: slowCooldown })
                  : t('rooms:accessibility.sendMessage')
              }
            >
              <Text style={[styles.sendButtonText, { color: colors.baseContent }]}>
                {slowCooldown > 0 ? `${slowCooldown}s` : t('common:button.send')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  ) : (
    <View style={[styles.inputBar, { backgroundColor: colors.base200 }]}>
      <TextInput
        style={[
          styles.textInput,
          { backgroundColor: colors.surface, color: colors.baseContent, borderRadius: radius.md },
        ]}
        value={inputText}
        onChangeText={handleChangeText}
        placeholder={t('chat:messageInput.placeholder.default')}
        placeholderTextColor={colors.chromeTextMuted}
        returnKeyType="send"
        onSubmitEditing={() => void handleSend()}
        submitBehavior="submit"
        multiline={false}
        accessibilityLabel={t('rooms:accessibility.messageInput')}
      />
      <Pressable
        style={[
          styles.sendButton,
          { backgroundColor: canSend ? colors.primary : colors.base300, borderRadius: radius.md },
        ]}
        onPress={() => void handleSend()}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel={
          slowCooldown > 0
            ? t('rooms:accessibility.slowModeWait', { seconds: slowCooldown })
            : t('rooms:accessibility.sendMessage')
        }
      >
        <Text
          style={[
            styles.sendButtonText,
            { color: canSend ? colors.primaryContent : colors.chromeTextMuted },
          ]}
        >
          {slowCooldown > 0 ? `${slowCooldown}s` : t('common:button.send')}
        </Text>
      </Pressable>
    </View>
  );

  const content = (
    <>
      {subHeader}
      <ChannelPills
        channels={channels}
        activeId={channelId}
        onSelect={setActiveChannel}
        colors={colors}
        isAim={isAim}
      />
      {messageArea}
      <TypingIndicator users={typingUsers} colors={colors} />
      {inputBar}
    </>
  );

  const actionSheetAndReport = (
    <>
      <MessageActionSheet
        visible={!!selectedMessage && !showReport}
        message={selectedMessage}
        isSelf={selectedMessage?.did === did}
        translateAvailable={translateAvailable}
        colors={colors}
        isAim={isAim}
        onClose={() => {
          setSelectedMessage(null);
        }}
        onReply={handleReply}
        onTranslate={handleTranslate}
        onAddBuddy={(m) => void handleAddBuddy(m)}
        onReport={handleReport}
      />
      <ReportModal
        visible={showReport}
        subjectUri={selectedMessage?.uri ?? ''}
        roomId={id}
        colors={colors}
        isAim={isAim}
        onClose={() => {
          setShowReport(false);
          setSelectedMessage(null);
        }}
      />
    </>
  );

  const memberModal = (
    <Modal visible={showMembers} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.base200 }]}>
          <Text style={[styles.modalTitle, { color: colors.baseContent }]}>
            {t('chat:memberList.heading', { count: onlineMemberCount })}
          </Text>
          <Pressable
            onPress={() => {
              setShowMembers(false);
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.modalClose, { color: colors.primary }]}>
              {t('common:button.done')}
            </Text>
          </Pressable>
        </View>
        <FlatList
          data={members.filter((m) => m.status !== 'offline')}
          keyExtractor={(m) => m.did}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              colors={colors}
              onMenu={item.did !== did ? handleMemberMenu : undefined}
            />
          )}
          contentContainerStyle={styles.memberList}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
                {t('chatRoom.noOneHereYet')}
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
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
            <AimTitlebar title={`${t('common:appName')} - ${room.name}`} onBack={handleBack} />
            {content}
          </BeveledView>
        </KeyboardAvoidingView>
        {memberModal}
        {actionSheetAndReport}
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
      {memberModal}
      {actionSheetAndReport}
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
    marginEnd: spacing[4],
  },
  memberCount: {
    fontSize: fontSize.xs,
    fontWeight: '600',
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
  },
  channelPillText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  channelPillAim: {
    borderWidth: 1,
    borderTopColor: '#fff',
    borderLeftColor: '#fff',
    borderBottomColor: '#808080',
    borderRightColor: '#808080',
  },
  messageAreaFlex: {
    flex: 1,
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
    maxWidth: '100%',
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
  translatedLabel: {
    fontSize: fontSize['2xs'],
    fontStyle: 'italic',
    opacity: 0.6,
  },
  messageTimeSelf: {
    opacity: 0.8,
  },
  replyCountBadge: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginTop: spacing[2],
    paddingLeft: spacing[2],
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
  errorText: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: fontSize.base,
  },
  // Member list modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  modalClose: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  memberList: {
    padding: spacing[6],
    gap: spacing[4],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[5],
    paddingVertical: spacing[2],
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: fontSize.base,
    fontWeight: '500',
  },
  memberHandle: {
    fontSize: fontSize.xs,
  },
  memberStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  memberMenuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberMenuText: {
    fontSize: 20,
    fontWeight: '700',
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

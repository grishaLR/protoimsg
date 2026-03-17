import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';
import { useBotDm, type BotDmMessage } from '@/services/BotDmContext';
import { BOT } from '@protoimsg/shared';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MessageRow = React.memo(function MessageRow({
  item,
  colors,
}: {
  item: BotDmMessage;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const isSelf = !item.fromBot;
  const bubbleBg = isSelf ? colors.primary : colors.base200;

  return (
    <View
      style={[
        styles.messageBubble,
        isSelf ? styles.messageSelf : styles.messagePeer,
        { backgroundColor: bubbleBg, borderRadius: radius.md },
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
          { color: isSelf ? colors.primaryContent : colors.chromeTextMuted, opacity: 0.7 },
        ]}
      >
        {formatTime(item.createdAt)}
      </Text>
    </View>
  );
});

export default function BotDmScreen() {
  const { t } = useTranslation(['dm', 'common']);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { messages, openBotDm, closeBotDm, sendMessage } = useBotDm();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<BotDmMessage>>(null);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: BOT.displayName,
      headerStyle: { backgroundColor: colors.base200 },
      headerTintColor: colors.baseContent,
      headerTitleStyle: { color: colors.baseContent, fontWeight: '600' as const },
    });
  }, [navigation, colors]);

  useEffect(() => {
    openBotDm();
    return () => {
      closeBotDm();
    };
  }, []);

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendMessage(text);
    setInputText('');
  }, [inputText, sendMessage]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BotDmMessage>) => {
      return <MessageRow item={item} colors={colors} />;
    },
    [colors],
  );

  const keyExtractor = useCallback((item: BotDmMessage) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.chromeTextMuted }]}>
              {t('common:appName')} — {BOT.displayName}
            </Text>
          </View>
        }
      />
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.base200,
            borderTopColor: colors.borderLight,
            borderTopWidth: 1,
            paddingBottom: insets.bottom || spacing[2],
          },
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
          onChangeText={setInputText}
          placeholder={t('input.placeholder')}
          placeholderTextColor={colors.chromeTextMuted}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          maxLength={BOT.maxCommandLength}
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim()}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
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
  messageText: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * 1.4,
  },
  messageTime: {
    fontSize: fontSize['2xs'],
    textAlign: 'right',
    marginTop: spacing[1],
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[16],
  },
  emptyText: {
    fontSize: fontSize.sm,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
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
});

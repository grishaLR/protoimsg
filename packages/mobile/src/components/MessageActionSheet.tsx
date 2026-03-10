import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MessageView } from '@/types';
import type { ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

interface MessageActionSheetProps {
  visible: boolean;
  message: MessageView | null;
  isSelf: boolean;
  translateAvailable: boolean;
  colors: ThemeColors;
  isAim: boolean;
  onClose: () => void;
  onReply: (message: MessageView) => void;
  onTranslate: (message: MessageView) => void;
  onAddBuddy: (message: MessageView) => void;
  onReport: (message: MessageView) => void;
}

export function MessageActionSheet({
  visible,
  message,
  isSelf,
  translateAvailable,
  colors,
  isAim,
  onClose,
  onReply,
  onTranslate,
  onAddBuddy,
  onReport,
}: MessageActionSheetProps) {
  if (!message) return null;

  const { t } = useTranslation('chat');

  const actions: { label: string; onPress: () => void; destructive?: boolean }[] = [
    {
      label: t('messageItem.replyButton'),
      onPress: () => {
        onReply(message);
        onClose();
      },
    },
  ];

  if (translateAvailable) {
    actions.push({
      label: t('messageItem.translate'),
      onPress: () => {
        onTranslate(message);
        onClose();
      },
    });
  }

  if (!isSelf) {
    actions.push({
      label: t('messageItem.addBuddy'),
      onPress: () => {
        onAddBuddy(message);
        onClose();
      },
    });
    actions.push({
      label: t('messageItem.reportButton'),
      onPress: () => {
        onReport(message);
        onClose();
      },
      destructive: true,
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderRadius: isAim ? 0 : radius.lg,
            },
          ]}
        >
          <View
            style={[
              styles.handle,
              { backgroundColor: colors.base300 },
              isAim && { display: 'none' },
            ]}
          />
          <Text style={[styles.preview, { color: colors.chromeTextMuted }]} numberOfLines={2}>
            {message.text}
          </Text>
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
          {actions.map((action) => (
            <Pressable
              key={action.label}
              style={({ pressed }) => [
                styles.actionRow,
                pressed && { backgroundColor: colors.base200 },
              ]}
              onPress={action.onPress}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.actionLabel,
                  { color: action.destructive ? colors.error : colors.baseContent },
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
          <Pressable
            style={({ pressed }) => [
              styles.actionRow,
              pressed && { backgroundColor: colors.base200 },
            ]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={[styles.cancelLabel, { color: colors.chromeTextMuted }]}>
              {t('reportContent.cancel')}
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[12],
  },
  sheet: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[2],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing[4],
  },
  preview: {
    fontSize: fontSize.sm,
    paddingHorizontal: spacing[6],
    marginBottom: spacing[3],
  },
  divider: {
    height: 1,
    marginVertical: spacing[1],
  },
  actionRow: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[6],
  },
  actionLabel: {
    fontSize: fontSize.base,
    fontWeight: '500',
  },
  cancelLabel: {
    fontSize: fontSize.base,
    fontWeight: '500',
    textAlign: 'center',
  },
});

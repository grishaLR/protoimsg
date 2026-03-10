import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { REPORT_CATEGORIES } from '@protoimsg/shared';
import { sendContentReport } from '@/services/api';
import type { ThemeColors } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

interface ReportModalProps {
  visible: boolean;
  subjectUri: string;
  roomId?: string;
  colors: ThemeColors;
  isAim: boolean;
  onClose: () => void;
}

export function ReportModal({
  visible,
  subjectUri,
  roomId,
  colors,
  isAim,
  onClose,
}: ReportModalProps) {
  const { t } = useTranslation('chat');
  const [category, setCategory] = useState<string>(REPORT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    try {
      await sendContentReport({
        subjectUri,
        roomId,
        category,
        description: description || undefined,
      });
      Alert.alert(t('reportContent.success'));
      setCategory(REPORT_CATEGORIES[0]);
      setDescription('');
      onClose();
    } catch {
      Alert.alert(t('reportContent.error'));
    } finally {
      setSubmitting(false);
    }
  }, [category, description, subjectUri, roomId, submitting, onClose, t]);

  const borderRadius = isAim ? 0 : radius.md;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
          <Text style={[styles.title, { color: colors.baseContent }]}>
            {t('reportContent.title')}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancel, { color: colors.primary }]}>
              {t('reportContent.cancel')}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={[styles.sectionLabel, { color: colors.chromeTextMuted }]}>
            {t('reportContent.categoryLabel')}
          </Text>
          {REPORT_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              style={[
                styles.categoryRow,
                {
                  backgroundColor: category === cat ? colors.primary : colors.base200,
                  borderRadius,
                },
              ]}
              onPress={() => {
                setCategory(cat);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: category === cat }}
            >
              <Text
                style={[
                  styles.categoryLabel,
                  { color: category === cat ? colors.primaryContent : colors.baseContent },
                ]}
              >
                {t(`report.categories.${cat}`)}
              </Text>
            </Pressable>
          ))}

          <Text
            style={[styles.sectionLabel, { color: colors.chromeTextMuted, marginTop: spacing[6] }]}
          >
            {t('reportContent.descriptionLabel')}
          </Text>
          <TextInput
            style={[
              styles.descriptionInput,
              {
                backgroundColor: colors.base200,
                color: colors.baseContent,
                borderRadius,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('reportContent.descriptionPlaceholder')}
            placeholderTextColor={colors.chromeTextMuted}
            multiline
            textAlignVertical="top"
          />

          <Pressable
            style={[
              styles.submitButton,
              {
                backgroundColor: submitting ? colors.base300 : colors.primary,
                borderRadius,
              },
            ]}
            onPress={() => void handleSubmit()}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.primaryContent} />
            ) : (
              <Text style={[styles.submitText, { color: colors.primaryContent }]}>
                {t('reportContent.submit')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  cancel: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing[8],
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing[3],
  },
  categoryRow: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[5],
    marginBottom: spacing[2],
  },
  categoryLabel: {
    fontSize: fontSize.base,
    fontWeight: '500',
  },
  descriptionInput: {
    minHeight: 100,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    fontSize: fontSize.base,
  },
  submitButton: {
    marginTop: spacing[8],
    paddingVertical: spacing[5],
    alignItems: 'center',
  },
  submitText: {
    fontSize: fontSize.base,
    fontWeight: '600',
  },
});

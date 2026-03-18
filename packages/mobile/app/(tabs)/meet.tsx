import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Video, Keyboard } from 'lucide-react-native';
import { useGroupCall } from '@/services/GroupCallContext';
import { useTheme } from '@/theme';
import { spacing, fontSize, radius } from '@/theme/tokens';

export default function MeetTab() {
  const { colors } = useTheme();
  const { activeGroupCall, startStandaloneMeeting, joinByCode } = useGroupCall();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (pending && activeGroupCall) {
      setPending(false);
      router.push('/group-call');
    }
  }, [pending, activeGroupCall]);

  const handleNewMeeting = useCallback(() => {
    startStandaloneMeeting();
    setPending(true);
  }, [startStandaloneMeeting]);

  const handleJoinByCode = useCallback(() => {
    const trimmed = code.trim();
    if (!trimmed) return;
    joinByCode(trimmed);
    setPending(true);
  }, [code, joinByCode]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: colors.baseContent }]}>Video calls for everyone</Text>
        <Text style={[styles.subtitle, { color: colors.chromeTextMuted }]}>
          Free, cross-platform video calls.{'\n'}No platform walls.
        </Text>

        <Pressable
          style={[styles.newMeetingBtn, { backgroundColor: colors.primary }]}
          onPress={handleNewMeeting}
        >
          <Video size={20} color={colors.primaryContent} />
          <Text style={[styles.newMeetingText, { color: colors.primaryContent }]}>New meeting</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.base300 }]} />
          <Text style={[styles.dividerText, { color: colors.chromeTextMuted }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.base300 }]} />
        </View>

        <View style={styles.joinRow}>
          <View style={[styles.codeInputWrapper, { borderColor: colors.base300 }]}>
            <Keyboard size={16} color={colors.chromeTextMuted} />
            <TextInput
              value={code}
              onChangeText={setCode}
              onSubmitEditing={handleJoinByCode}
              placeholder="Enter a code"
              placeholderTextColor={colors.chromeTextMuted}
              style={[styles.codeInput, { color: colors.baseContent }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="join"
            />
          </View>
          <Pressable
            style={[styles.joinBtn, !code.trim() && styles.joinBtnDisabled]}
            onPress={handleJoinByCode}
            disabled={!code.trim()}
          >
            <Text style={styles.joinBtnText}>Join</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[6],
  },
  title: { fontSize: fontSize['2xl'], fontWeight: '300', textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, textAlign: 'center', lineHeight: 22 },
  newMeetingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    marginTop: spacing[4],
  },
  newMeetingText: { fontSize: fontSize.md, fontWeight: '600' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    width: '100%',
    maxWidth: 300,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: fontSize.sm },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    width: '100%',
    maxWidth: 300,
  },
  codeInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  codeInput: { flex: 1, fontSize: fontSize.md, padding: 0 },
  joinBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  joinBtnDisabled: { opacity: 0.3 },
  joinBtnText: { color: '#3b82f6', fontSize: fontSize.md, fontWeight: '600' },
});

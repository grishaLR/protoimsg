import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/services/auth';
import { AccountBannedError, NotOnAllowlistError } from '@/services/api';
import { ActorSearchInput } from '@/components/ActorSearchInput';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';
import type { ActorSearchResult } from '@/lib/search-actors';

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  const { login, isLoading, authPhase, authError } = useAuth();
  const { colors } = useTheme();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAuthenticating =
    authPhase === 'authenticating' || authPhase === 'resolving' || authPhase === 'connecting';

  const busy = isLoading || submitting;

  async function handleLogin() {
    const trimmed = handle.trim();
    if (!trimmed || busy) return;

    setError(null);
    setSubmitting(true);
    try {
      await login(trimmed, []);
    } catch (err: unknown) {
      console.error('[Login] sign-in error:', err);
      if (err instanceof AccountBannedError) {
        setError(t('login.suspended'));
      } else if (err instanceof NotOnAllowlistError) {
        setError(t('login.notOnBetaList'));
      } else if (err instanceof Error && err.message.includes('Another web browser')) {
        setError(t('login.browserAlreadyOpen'));
      } else {
        setError(t('login.signInFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleActorSelect(actor: ActorSearchResult) {
    setHandle(actor.handle);
  }

  if (authPhase === 'initializing' || isAuthenticating) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.phaseText, { color: colors.chromeTextMuted }]}>
          {authPhase === 'initializing' && t('login.submitLoading')}
          {authPhase === 'authenticating' && t('login.authenticating')}
          {authPhase === 'resolving' && t('login.resolvingProfile')}
          {authPhase === 'connecting' && t('login.connectingToServer')}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.baseContent }]}>{t('login.mobileTitle')}</Text>
        <Text style={[styles.subtitle, { color: colors.chromeTextMuted }]}>
          {t('login.mobileSubtitle')}
        </Text>

        <ActorSearchInput
          value={handle}
          onInputChange={setHandle}
          onSelect={handleActorSelect}
          clearOnSelect={false}
          placeholder={t('login.handlePlaceholder')}
          style={styles.searchWrapper}
          inputProps={{
            keyboardType: 'url',
            returnKeyType: 'go',
            onSubmitEditing: () => void handleLogin(),
            editable: !busy,
            accessibilityLabel: t('login.handleLabel'),
            accessibilityHint: t('login.mobileSubtitle'),
          }}
        />

        {(error ?? authError) && (
          <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert">
            {error ?? authError}
          </Text>
        )}

        <Pressable
          style={[
            styles.button,
            { backgroundColor: colors.primary },
            (busy || !handle.trim()) && styles.buttonDisabled,
          ]}
          onPress={() => void handleLogin()}
          disabled={busy || !handle.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('login.submit')}
          accessibilityState={{ disabled: busy || !handle.trim() }}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryContent} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryContent }]}>
              {t('login.submit')}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 340,
    paddingHorizontal: spacing[12],
    gap: spacing[8],
    alignItems: 'center',
  },
  title: {
    fontSize: fontSize['3xl'],
    fontWeight: '700',
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: fontSize.md,
    marginBottom: spacing[4],
  },
  searchWrapper: {
    width: '100%',
  },
  error: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  phaseText: {
    fontSize: fontSize.md,
    marginTop: spacing[6],
  },
});

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useAuth } from '@/services/auth';
import { AccountBannedError, NotOnAllowlistError } from '@/services/api';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

export default function LoginScreen() {
  const { login, isLoading, authPhase, authError } = useAuth();
  const { colors } = useTheme();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isAuthenticating =
    authPhase === 'authenticating' || authPhase === 'resolving' || authPhase === 'connecting';

  async function handleLogin() {
    const trimmed = handle.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await login(trimmed);
    } catch (err: unknown) {
      console.error('[Login] sign-in error:', err);
      if (err instanceof AccountBannedError) {
        setError('This account has been suspended.');
      } else if (err instanceof NotOnAllowlistError) {
        setError('This account is not on the beta allowlist.');
      } else {
        setError('Sign in failed. Please try again.');
      }
    }
  }

  if (authPhase === 'initializing' || isAuthenticating) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.phaseText, { color: colors.chromeTextMuted }]}>
          {authPhase === 'initializing' && 'Loading...'}
          {authPhase === 'authenticating' && 'Authenticating...'}
          {authPhase === 'resolving' && 'Resolving profile...'}
          {authPhase === 'connecting' && 'Connecting to server...'}
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
        <Text style={[styles.title, { color: colors.baseContent }]}>protoimsg</Text>
        <Text style={[styles.subtitle, { color: colors.chromeTextMuted }]}>
          sign in with your AT Protocol handle
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.base200,
              color: colors.baseContent,
              borderColor: colors.base300,
            },
          ]}
          placeholder="handle.bsky.social"
          placeholderTextColor={colors.chromeTextMuted}
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void handleLogin()}
          editable={!isLoading}
          accessibilityLabel="AT Protocol handle"
          accessibilityHint="Enter your handle to sign in"
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
            isLoading && styles.buttonDisabled,
          ]}
          onPress={() => void handleLogin()}
          disabled={isLoading || !handle.trim()}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: isLoading || !handle.trim() }}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.primaryContent} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryContent }]}>Sign In</Text>
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
    fontSize: 32,
    fontWeight: '700',
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: fontSize.md,
    marginBottom: spacing[4],
  },
  input: {
    width: '100%',
    height: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing[8],
    fontSize: fontSize.lg,
    borderWidth: 1,
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

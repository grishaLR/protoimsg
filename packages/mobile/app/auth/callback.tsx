import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';
import { spacing, fontSize } from '@/theme/tokens';

/**
 * OAuth callback screen — shown briefly during cold-start deep links.
 *
 * In the normal flow, ExpoOAuthClient.signIn() handles the full round trip
 * and returns the session directly. This screen is only reached if the app
 * was killed during the OAuth flow and the callback deep link cold-starts it.
 * The root layout's init effect handles the actual callback processing.
 */
export default function AuthCallbackScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.baseContent }]}>Signing in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  text: {
    fontSize: fontSize.lg,
  },
});

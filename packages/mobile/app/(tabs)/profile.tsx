import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/services/auth';
import { useTheme } from '@/theme';
import { spacing, radius, fontSize } from '@/theme/tokens';

export default function ProfileScreen() {
  const { handle, logout } = useAuth();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { borderBottomColor: colors.base200 }]}>
        <Text style={[styles.title, { color: colors.baseContent }]}>Profile</Text>
      </View>
      <View style={styles.content}>
        <Text style={[styles.handle, { color: colors.baseContent }]}>@{handle ?? '...'}</Text>
        <Pressable
          style={[styles.logoutButton, { backgroundColor: colors.primary }]}
          onPress={logout}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={[styles.logoutText, { color: colors.primaryContent }]}>Sign Out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[12],
  },
  handle: {
    fontSize: 18,
  },
  logoutButton: {
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[6],
    borderRadius: radius.sm,
  },
  logoutText: {
    fontWeight: '600',
    fontSize: fontSize.lg,
  },
});

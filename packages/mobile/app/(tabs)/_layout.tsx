import { Tabs, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/services/auth';
import { useDm } from '@/services/DmContext';
import { useTheme, useAimStyle } from '@/theme';

export default function TabLayout() {
  const { t } = useTranslation();
  const { session, isLoading } = useAuth();
  const { colors } = useTheme();
  const { isAim } = useAimStyle();
  const { notifications } = useDm();
  const badgeCount = notifications.length;

  // Redirect to login when session is cleared (e.g. sign out)
  if (!isLoading && !session) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isAim ? colors.base100 : colors.surface,
          borderTopColor: isAim ? colors.borderDark : colors.base200,
          borderTopWidth: isAim ? 1 : undefined,
          ...(isAim
            ? {
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderBottomWidth: 0,
              }
            : {}),
        },
        tabBarActiveTintColor: isAim ? colors.baseContent : colors.primary,
        tabBarInactiveTintColor: colors.chromeTextMuted,
        ...(isAim
          ? {
              tabBarIconStyle: { display: 'none' as const },
              tabBarItemStyle: {
                borderWidth: 1,
                borderTopColor: '#fff',
                borderLeftColor: '#fff',
                borderBottomColor: '#0a0a0a',
                borderRightColor: '#0a0a0a',
                marginHorizontal: 1,
                marginVertical: 2,
                backgroundColor: colors.base100,
                justifyContent: 'center' as const,
              },
              tabBarLabelPosition: 'beside-icon' as const,
            }
          : {}),
      }}
    >
      <Tabs.Screen
        name="buddy-list"
        options={{
          title: t('nav.buddies'),
          tabBarIcon: (_props) => null, // TODO: icon
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
          tabBarBadgeStyle: badgeCount > 0 ? { backgroundColor: colors.error } : undefined,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('nav.chat'),
          tabBarIcon: (_props) => null, // TODO: icon
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: (_props) => null, // TODO: icon
        }}
      />
    </Tabs>
  );
}

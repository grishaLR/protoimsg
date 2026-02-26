import { Tabs } from 'expo-router';
import { useAuth } from '@/services/auth';
import { useDm } from '@/services/DmContext';
import { useTheme } from '@/theme';
import LoginScreen from '@/components/LoginScreen';

export default function TabLayout() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const { notifications } = useDm();

  if (!session) {
    return <LoginScreen />;
  }

  const badgeCount = notifications.length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.base200,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.chromeTextMuted,
      }}
    >
      <Tabs.Screen
        name="buddy-list"
        options={{
          title: 'Buddies',
          tabBarIcon: (_props) => null, // TODO: icon
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
          tabBarBadgeStyle: badgeCount > 0 ? { backgroundColor: colors.error } : undefined,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: (_props) => null, // TODO: icon
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: (_props) => null, // TODO: icon
        }}
      />
    </Tabs>
  );
}

import { Tabs } from 'expo-router';
import { useAuth } from '@/services/auth';
import { useTheme } from '@/theme';
import LoginScreen from '@/components/LoginScreen';

export default function TabLayout() {
  const { session } = useAuth();
  const { colors } = useTheme();

  if (!session) {
    return <LoginScreen />;
  }

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

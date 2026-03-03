import 'react-native-url-polyfill/auto';
import '@/polyfills';
import '@/i18n';

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/services/auth';
import { TranslationProvider } from '@/services/TranslationContext';
import { WebSocketProvider } from '@/services/WebSocketContext';
import { DmProvider } from '@/services/DmContext';
import { VideoCallProvider } from '@/services/VideoCallContext';
import { ThemeProvider, useTheme } from '@/theme';
import { isDarkTheme } from '@/theme/themes';
import { ProfileProvider } from '@/services/ProfileContext';
import { IncomingCallBanner } from '@/components/IncomingCallBanner';
import { useBlockSync } from '@/hooks/useBlockSync';
import { setupNotificationResponseListener } from '@/services/notifications';

function BlockSyncGate({ children }: { children: React.ReactNode }) {
  useBlockSync();
  return <>{children}</>;
}

function ThemedStack() {
  const { colors, theme } = useTheme();

  useEffect(() => {
    return setupNotificationResponseListener();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDarkTheme(theme) ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surface },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth/callback" options={{ animation: 'none' }} />
        <Stack.Screen
          name="room/[id]"
          options={{ headerShown: true, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="dm/[did]"
          options={{ headerShown: true, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="call/[did]"
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
      </Stack>
      <IncomingCallBanner />
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TranslationProvider>
          <WebSocketProvider>
            <DmProvider>
              <VideoCallProvider>
                <ProfileProvider>
                  <BlockSyncGate>
                    <ThemedStack />
                  </BlockSyncGate>
                </ProfileProvider>
              </VideoCallProvider>
            </DmProvider>
          </WebSocketProvider>
        </TranslationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

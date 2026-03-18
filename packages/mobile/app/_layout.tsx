import 'react-native-url-polyfill/auto';
import '@/polyfills';
import '@/i18n';
import { registerGlobals } from '@livekit/react-native';

registerGlobals();

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '@/services/auth';
import { QueryProvider } from '@/lib/query-client';
import { ModerationProvider } from '@/services/ModerationContext';
import { TranslationProvider } from '@/services/TranslationContext';
import { WebSocketProvider } from '@/services/WebSocketContext';
import { DmProvider } from '@/services/DmContext';
import { VideoCallProvider } from '@/services/VideoCallContext';
import { GroupCallProvider } from '@/services/GroupCallContext';
import { BotDmProvider } from '@/services/BotDmContext';
import { ThemeProvider, useTheme } from '@/theme';
import { isDarkTheme } from '@/theme/themes';
import { ProfileProvider } from '@/services/ProfileContext';
import { IncomingCallBanner } from '@/components/IncomingCallBanner';
import { useBlockSync } from '@/hooks/useBlockSync';
import { setupNotificationResponseListener } from '@/services/notifications';

function QueryGate({ children }: { children: React.ReactNode }) {
  const { did } = useAuth();
  return <QueryProvider currentDid={did ?? undefined}>{children}</QueryProvider>;
}

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
          name="bot-dm"
          options={{ headerShown: true, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="compose"
          options={{ headerShown: true, presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="profile/[did]"
          options={{ headerShown: true, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="thread/[uri]"
          options={{ headerShown: true, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="call/[did]"
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
        <Stack.Screen
          name="group-call"
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
        <QueryGate>
          <ModerationProvider>
            <TranslationProvider>
              <WebSocketProvider>
                <DmProvider>
                  <VideoCallProvider>
                    <GroupCallProvider>
                      <BotDmProvider>
                        <ProfileProvider>
                          <BlockSyncGate>
                            <ThemedStack />
                          </BlockSyncGate>
                        </ProfileProvider>
                      </BotDmProvider>
                    </GroupCallProvider>
                  </VideoCallProvider>
                </DmProvider>
              </WebSocketProvider>
            </TranslationProvider>
          </ModerationProvider>
        </QueryGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

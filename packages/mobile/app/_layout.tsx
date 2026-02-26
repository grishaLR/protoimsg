import 'react-native-url-polyfill/auto';
import '@/polyfills';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/services/auth';
import { WebSocketProvider } from '@/services/WebSocketContext';
import { ThemeProvider, useTheme } from '@/theme';
import { useBlockSync } from '@/hooks/useBlockSync';

function BlockSyncGate({ children }: { children: React.ReactNode }) {
  useBlockSync();
  return <>{children}</>;
}

function ThemedStack() {
  const { colors, theme } = useTheme();

  return (
    <>
      <StatusBar style={theme === 'dracula' ? 'light' : 'dark'} />
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
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <BlockSyncGate>
            <ThemedStack />
          </BlockSyncGate>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

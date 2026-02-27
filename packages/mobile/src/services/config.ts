// Expo env vars are injected at build time via the EXPO_PUBLIC_ prefix.
// They're available as string properties on process.env (typed in expo-env.d.ts).

declare const process: { env: Record<string, string | undefined> };
declare const __DEV__: boolean;

/** protoimsg server URL. Override with EXPO_PUBLIC_API_URL env var. */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'https://protoimsg-staging.fly.dev' : 'https://protoimsg.app');

/** WebSocket URL derived from API_URL. */
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

/** PDS URL for account creation. */
export const PDS_URL = process.env.EXPO_PUBLIC_PDS_URL ?? 'https://pds.protoimsg.app';

/** OAuth client metadata URL (hosted publicly). */
export const OAUTH_CLIENT_ID =
  process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID ?? 'https://protoimsg.app/oauth-client-metadata.json';

/** OAuth redirect URI using the native scheme. */
export const OAUTH_REDIRECT_URI = 'app.protoimsg:/auth/callback';

import { BrowserOAuthClient, type OAuthClientMetadata } from '@atproto/oauth-client-browser';
import prodMeta from './client-metadata.prod.json';

let client: BrowserOAuthClient | null = null;

export function getOAuthClient(): BrowserOAuthClient {
  if (client) return client;

  const origin = window.location.origin;
  const isDev = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');

  if (isDev) {
    // ATProto loopback client format (http://localhost?redirect_uri=...&scope=...).
    // This is the spec-compliant way to use OAuth in development — no hosted metadata needed.
    // redirect_uri uses 127.0.0.1 per RFC 8252 (not "localhost").
    const redirectUri = `http://127.0.0.1:5173/`;
    const scope = 'atproto transition:generic';
    client = new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: {
        client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`,
        client_name: 'chatmosphere (dev)',
        client_uri: 'http://127.0.0.1:5173',
        redirect_uris: [redirectUri],
        scope,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        dpop_bound_access_tokens: true,
      },
    });
  } else {
    // Production: client_id is URL to hosted metadata. JSON file in src/lib/ is the
    // single source of truth — Vite plugin serves it at root and copies to dist/.
    const metadata = prodMeta as unknown as OAuthClientMetadata;
    client = new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: metadata,
    });
  }

  return client;
}

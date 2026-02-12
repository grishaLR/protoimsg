import { BrowserOAuthClient, type OAuthClientMetadata } from '@atproto/oauth-client-browser';

let client: BrowserOAuthClient | null = null;

/** Build OAuth client metadata from a given origin URL. */
function buildMetadata(origin: string): OAuthClientMetadata {
  // Cast required: ATProto types use strict URL template literals that can't
  // be satisfied by dynamic string concatenation at compile time.
  return {
    client_id: `${origin}/client-metadata.json`,
    client_name: 'proto instant messenger',
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  } as unknown as OAuthClientMetadata;
}

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
        client_name: 'protoimsg (dev)',
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
    // Deployed: derive metadata from current origin so staging/production/preview
    // deployments all get correct redirect URIs automatically. The Vite plugin
    // generates a matching client-metadata.json at build time via VITE_SITE_URL.
    client = new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: buildMetadata(origin),
    });
  }

  return client;
}

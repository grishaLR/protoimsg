import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

let client: BrowserOAuthClient | null = null;

export function getOAuthClient(): BrowserOAuthClient {
  if (client) return client;

  const redirectUri = window.location.origin + '/';

  client = new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: {
      client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`,
      client_name: 'chatmosphere (dev)',
      client_uri: window.location.origin,
      redirect_uris: [redirectUri],
      scope: 'atproto transition:generic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    },
  });

  return client;
}

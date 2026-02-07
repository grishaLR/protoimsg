/**
 * ATProto OAuth client setup.
 *
 * This is a stub — full implementation requires:
 * - @atproto/oauth-client-node configured with client metadata
 * - Session state storage (DB-backed for production)
 * - DPOP key management
 *
 * See: https://atproto.com/guides/oauth
 */

import type { Config } from '../config.js';

export interface OAuthClient {
  getAuthorizationUrl: (handle: string) => Promise<string>;
  handleCallback: (params: Record<string, string>) => Promise<{ did: string; handle: string }>;
}

export function createOAuthClient(_config: Config): OAuthClient | null {
  // OAuth requires client ID and redirect URI
  if (!_config.OAUTH_CLIENT_ID || !_config.OAUTH_REDIRECT_URI) {
    console.warn('OAuth not configured — auth endpoints will return 501');
    return null;
  }

  // TODO: Initialize @atproto/oauth-client-node
  // This requires proper client metadata served at a public URL
  return null;
}

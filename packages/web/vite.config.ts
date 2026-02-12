import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

/**
 * Generate and serve client-metadata.json for ATProto OAuth PDS discovery.
 * Uses VITE_SITE_URL env var to produce correct URLs per deployment environment
 * (production, staging, preview). Dev uses the ATProto loopback client format instead.
 */
function oauthMetadataPlugin(): Plugin {
  function buildMetadataJson(): string {
    const siteUrl = process.env.VITE_SITE_URL ?? 'https://protoimsg.app';
    return JSON.stringify(
      {
        client_id: `${siteUrl}/client-metadata.json`,
        client_name: 'proto instant messenger',
        client_uri: siteUrl,
        redirect_uris: [`${siteUrl}/`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        dpop_bound_access_tokens: true,
      },
      null,
      2,
    );
  }

  return {
    name: 'oauth-metadata',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/client-metadata.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(buildMetadataJson());
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: buildMetadataJson(),
      });
    },
  };
}

export default defineConfig({
  build: {
    sourcemap: true,
  },
  plugins: [
    react(),
    oauthMetadataPlugin(),
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({ org: 'protoimsg', project: 'protoimsg-web' })]
      : []),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});

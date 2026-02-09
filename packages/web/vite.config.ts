import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Serve production client-metadata.json at root URL (required by ATProto OAuth PDS discovery).
 * Source of truth lives in src/lib/client-metadata.prod.json; this plugin serves it in dev
 * and copies to dist/ at build time. Dev uses the ATProto loopback client format (no file needed).
 */
function oauthMetadataPlugin(): Plugin {
  const metaFiles: Record<string, string> = {
    '/client-metadata.json': 'src/lib/client-metadata.prod.json',
  };

  return {
    name: 'oauth-metadata',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = metaFiles[req.url ?? ''];
        if (file) {
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(resolve(__dirname, file), 'utf-8'));
          return;
        }
        next();
      });
    },
    generateBundle() {
      for (const [urlPath, filePath] of Object.entries(metaFiles)) {
        this.emitFile({
          type: 'asset',
          fileName: urlPath.slice(1),
          source: readFileSync(resolve(__dirname, filePath), 'utf-8'),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), oauthMetadataPlugin()],
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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Run the source tests only — never the copies emitted into dist/ by tsc.
    exclude: ['dist/**', 'node_modules/**'],
  },
});

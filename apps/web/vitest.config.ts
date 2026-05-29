import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    // Exclude Playwright e2e tests — those run via `pnpm test:e2e`
    exclude: ['e2e/**', 'node_modules/**'],
    // Pass when no unit tests exist yet (e2e tests are the only *.spec files)
    passWithNoTests: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});

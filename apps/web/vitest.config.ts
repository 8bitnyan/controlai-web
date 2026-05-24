import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude Playwright e2e tests — those run via `pnpm test:e2e`
    exclude: ['e2e/**', 'node_modules/**'],
    // Pass when no unit tests exist yet (e2e tests are the only *.spec files)
    passWithNoTests: true,
  },
});

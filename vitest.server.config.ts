import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server tests: route handlers and database functions against the local
// Supabase stack (`npm run db:start`). Kept apart from the jsdom project in
// vitest.config.ts so nothing here loads React Testing Library.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
    globalSetup: ['tests/server/global-setup.ts'],
    setupFiles: ['tests/server/setup-env.ts'],
    // One database, shared by every file: run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

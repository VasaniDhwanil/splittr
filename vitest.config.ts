import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type ViteUserConfig } from 'vitest/config';

// @vitejs/plugin-react resolves the top-level vite (rolldown-based) while
// vitest bundles its own nested vite, so the Plugin types differ only
// nominally. Runtime is compatible; cast at this one boundary.
const plugins = [react()] as unknown as NonNullable<ViteUserConfig['plugins']>;

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});

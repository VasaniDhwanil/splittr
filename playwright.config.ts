import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/fixtures/env';

/**
 * Splittr end-to-end regression suite. Runs against a deployed site
 * (BASE_URL, default https://www.splittr.cash); no local web server.
 *
 *   npm run test:e2e                 read-only specs; write specs skip
 *   E2E_WRITES=1 npm run test:e2e    also runs specs that create + delete test data
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /fixtures\/auth\.setup\.ts$/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      // iPhone 13 defaults to WebKit; only Chromium is installed, so keep the
      // device metrics (viewport, DPR, touch, UA) and run it in Chromium.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
});

// End-to-end tests of the built Chrome extension. `pnpm test:e2e` builds it
// and runs them. The browser and the extension are started in extension.ts.

import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: '.',
  // Vitest's files are *.test.ts under src/. These are the only files Playwright runs.
  testMatch: '*.spec.ts',
  outputDir: '../test-results',
  forbidOnly: ci,
  reporter: ci
    ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});

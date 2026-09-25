// End-to-end tests: load the unpacked extension in Chromium and drive mock chat pages.
// Run with: npm run test:e2e
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One browser at a time: the tests use the clipboard, which must not be shared between parallel runs.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
});

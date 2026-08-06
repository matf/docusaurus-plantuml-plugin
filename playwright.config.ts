import {defineConfig, devices} from '@playwright/test';

/**
 * The production fixture is built and served by `scripts/test-packed-example.mjs`, which
 * passes its URL in. There is no `webServer` block on purpose: the harness owns the server
 * so it can tear it down reliably even when a test fails.
 */
const baseURL = process.env['PLANTUML_E2E_BASE_URL'];

if (!baseURL) {
  throw new Error(
    'PLANTUML_E2E_BASE_URL is not set. Run `npm run test:integration`, which builds, packs, ' +
      'installs and serves the fixture before invoking Playwright.',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // The first diagram on a cold page downloads ~8 MB of engine before it can render.
  timeout: 120_000,
  expect: {timeout: 60_000},
  reporter: process.env['CI'] ? [['github'], ['html', {open: 'never'}]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
});

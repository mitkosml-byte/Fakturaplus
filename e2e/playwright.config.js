// The main paths of the app in a real browser, on a phone-sized screen,
// against serve.py: the server on an in-memory database and the built app.
const { defineConfig } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '8010';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
    trace: 'off',
  },
  webServer: {
    command: `python serve.py ${process.env.E2E_DIST || '../frontend/dist'}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { E2E_PORT: PORT },
  },
});

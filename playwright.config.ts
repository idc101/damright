import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'tauri',
      use: {
        ...devices['Desktop Chrome'],
      },
      testIgnore: /.*mobile.test.ts/,
    },
    {
      name: 'mobile-web',
      use: {
        ...devices['Pixel 5'],
      },
      testMatch: /.*mobile.test.ts/,
    },
  ],
});

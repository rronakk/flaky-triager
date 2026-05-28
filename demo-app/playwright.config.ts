import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'playwright-output',
  retries: 2,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit-e2e.xml' }]],
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run build:client && npm run start',
    port: 3000,
    reuseExistingServer: true,
  },
});

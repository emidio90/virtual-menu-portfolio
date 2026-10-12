import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 20000, fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4321', headless: true, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  webServer: { command: 'node server/index.js', env: { APP_MODE: 'demo', PORT: '4321', HOST: '127.0.0.1' }, url: 'http://127.0.0.1:4321/api/health', reuseExistingServer: false },
});

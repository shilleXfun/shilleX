import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'data', `e2e-${process.pid}`);

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: 'npm run start -w @shillex/server',
      cwd: root, port: 3100, reuseExistingServer: false, timeout: 120_000,
      env: { PORT: '3100', PGLITE_DIR: dataDir, UPLOADS_DIR: join(dataDir, 'uploads'), PUBLIC_URL: 'http://localhost:5174',
        DEMO_SIMULATOR: 'off', LIVE_TOKEN_LOOKUP: 'off', SEED_ON_EMPTY: 'on', SESSION_SECRET: 'e2e' },
    },
    { command: 'npm run dev -w @shillex/web', cwd: root, port: 5174, reuseExistingServer: false, timeout: 120_000, env: { SHILLEX_API: 'http://localhost:3100', WEB_PORT: '5174' } },
  ],
});

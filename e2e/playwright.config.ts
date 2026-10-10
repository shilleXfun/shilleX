import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, readdirSync, rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Not 5174: that is Vite's own fallback port, so another project's dev server is often already on it.
const WEB = Number(process.env.E2E_WEB_PORT ?? 5199), API = Number(process.env.E2E_API_PORT ?? 3100);
const dataDir = join(root, 'data', `e2e-${process.pid}`);
// Clear databases left by earlier runs (their servers are gone). Runner process only: workers load this file too.
if (!process.env.TEST_WORKER_INDEX && existsSync(join(root, 'data'))) {
  for (const d of readdirSync(join(root, 'data'))) if (d.startsWith('e2e-')) rmSync(join(root, 'data', d), { recursive: true, force: true });
}

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: [/mobile\.spec/, /world\.spec/] },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: 'npm run start -w @shillex/server',
      cwd: root, port: API, reuseExistingServer: false, timeout: 120_000,
      env: { PORT: String(API), PGLITE_DIR: dataDir, UPLOADS_DIR: join(dataDir, 'uploads'), PUBLIC_URL: `http://localhost:${WEB}`,
        DEMO_SIMULATOR: 'off', LIVE_TOKEN_LOOKUP: 'off', SEED_ON_EMPTY: 'on', SESSION_SECRET: 'e2e' },
    },
    { command: 'npm run dev -w @shillex/web', cwd: root, port: WEB, reuseExistingServer: false, timeout: 120_000, env: { SHILLEX_API: `http://localhost:${API}`, WEB_PORT: String(WEB) } },
  ],
});

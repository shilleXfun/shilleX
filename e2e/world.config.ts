import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, readdirSync, rmSync } from 'node:fs';

// The agent world (WORLD_MODE=agents) on the in-memory chain with the scripted fixture: no model calls, no devnet.
const root = fileURLToPath(new URL('..', import.meta.url));
const WEB = Number(process.env.E2E_WORLD_WEB_PORT ?? 5298), API = Number(process.env.E2E_WORLD_API_PORT ?? 3198);
const dataDir = join(root, 'data', `e2e-world-${process.pid}`);
if (!process.env.TEST_WORKER_INDEX && existsSync(join(root, 'data'))) {
  for (const d of readdirSync(join(root, 'data'))) if (d.startsWith('e2e-world-')) rmSync(join(root, 'data', d), { recursive: true, force: true });
}

export default defineConfig({
  testDir: '.',
  testMatch: /world\.spec/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: 'npm run start -w @shillex/server',
      cwd: root, port: API, reuseExistingServer: false, timeout: 120_000,
      env: {
        PORT: String(API), PGLITE_DIR: dataDir, UPLOADS_DIR: join(dataDir, 'uploads'), PUBLIC_URL: `http://localhost:${WEB}`, SESSION_SECRET: 'e2e',
        WORLD_MODE: 'agents', WORLD_CHAIN: 'memory', WORLD_FIXTURE: 'on', AGENTS: 'off', WORLD_ADMIN_PASSWORD: 'admin-pass-123',
        WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      },
    },
    { command: 'npm run dev -w @shillex/web', cwd: root, port: WEB, reuseExistingServer: false, timeout: 120_000, env: { SHILLEX_API: `http://localhost:${API}`, WEB_PORT: String(WEB) } },
  ],
});

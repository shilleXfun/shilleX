import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, readdirSync, rmSync } from 'node:fs';

// The living site: the real engine on the memory chain, fast ticks, no model and no image keys (fallback phrasebooks, data cards).
const root = fileURLToPath(new URL('..', import.meta.url));
// Its own ports, or the main suite's overrides (E2E_WEB_PORT / E2E_API_PORT) when other projects hold the defaults.
const WEB = Number(process.env.E2E_AGENTS_WEB_PORT ?? process.env.E2E_WEB_PORT ?? 5297);
const API = Number(process.env.E2E_AGENTS_API_PORT ?? process.env.E2E_API_PORT ?? 3197);
const dataDir = join(root, 'data', `e2e-agents-${process.pid}`);
// Clear databases left by earlier runs (their servers are gone). Runner process only: workers load this file too.
// Only this suite's own e2e-agents-<pid> folders, never the main suite's e2e-<pid>.
if (!process.env.TEST_WORKER_INDEX && existsSync(join(root, 'data'))) {
  for (const d of readdirSync(join(root, 'data'))) if (/^e2e-agents-\d+$/.test(d)) rmSync(join(root, 'data', d), { recursive: true, force: true });
}

export default defineConfig({
  testDir: '.',
  testMatch: /agents\.spec/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  webServer: [
    {
      command: 'npm run start -w @shillex/server', cwd: root, port: API, reuseExistingServer: false, timeout: 120_000,
      // DATABASE_URL '' (not deleted): webServer env is merged over the shell's, and an empty value also beats a .env file,
      // so the engine (ticking every 150 ms) can never reach a real Postgres. The server reads '' as unset and uses PGlite.
      env: {
        PORT: String(API), DATABASE_URL: '', PGLITE_DIR: dataDir, UPLOADS_DIR: join(dataDir, 'uploads'), PUBLIC_URL: `http://localhost:${WEB}`, SESSION_SECRET: 'e2e',
        AGENTS: 'on', WORLD_CHAIN: 'memory', ENGINE_TICK_MS: '150,300', SEED_ON_EMPTY: 'off', LIVE_TOKEN_LOOKUP: 'off',
        WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
      },
    },
    { command: 'npm run dev -w @shillex/web', cwd: root, port: WEB, reuseExistingServer: false, timeout: 120_000, env: { SHILLEX_API: `http://localhost:${API}`, WEB_PORT: String(WEB) } },
  ],
});

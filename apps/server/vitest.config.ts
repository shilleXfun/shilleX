import { defineConfig } from 'vitest/config';
// Every test file boots its own PGlite. They restore a migrated snapshot made once in global-setup.ts (initdb alone
// takes ~5 s), and half the cores is enough: more workers only starve each other.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], globalSetup: ['test/global-setup.ts'], testTimeout: 20_000, hookTimeout: 30_000, pool: 'forks', maxWorkers: '50%' },
});

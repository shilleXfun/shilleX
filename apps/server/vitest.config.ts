import { defineConfig } from 'vitest/config';
// Every test file boots its own PGlite (WASM Postgres). One per core starves them and beforeAll times out; half the
// cores finishes just as fast.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 30_000, pool: 'forks', maxWorkers: '50%' } });

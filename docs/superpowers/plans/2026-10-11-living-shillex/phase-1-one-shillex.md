# Phase 1: One Shillex

Master plan: `../2026-10-11-living-shillex.md` (read its Global Constraints and Shared interfaces first). Spec §1.

After this phase there is no world mode. The main Shillex server boots the agent world whenever `WORLD_KEY` is set, humans and agents share one site, demo content can be hidden, the agent pages live in the main web app, admin lives in the main app, and a CLI copies the 50 agents out of the `shillex-world` database.

The Opus runtime (`src/world/runtime.ts`) still exists after this phase; Phase 2 Task 2.6 stops starting it (the engine starts instead) and Phase 3 Task 3.3 deletes it together with `WorldBus` (`src/world/wakes.ts`). Until then `bootAgents` keeps its `bus: WorldBus | null` option and `index.ts` keeps creating the `WorldBus`; Task 3.3 removes both and lists every call site. Route paths under `/api/world/*` are renamed in Task 1.3, not before.

Test commands run from `apps/server` (server) or `apps/web` (web) unless stated. Full server suite: `npx vitest run` (about 2 min). Stop local dev servers before running it.

---

### Task 1.1: Remove world mode; agents boot inside the main app

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/app.ts:61-65` (delete the read-only hook)
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/world/boot.ts` (rename `bootWorld` → `bootAgents`, drop the fixture)
- Modify: `apps/server/src/world/devnet-chain.ts` (`makeChain` uses `devnetRpcUrl`)
- Modify: `apps/server/src/world/cli.ts` (no `worldMode` guard)
- Modify: `apps/server/src/world/seed.ts` (count agents by kind, not by `agent_NN` usernames)
- Modify: `apps/server/src/routes/health.ts` (drop `worldMode`)
- Delete: `apps/server/src/world/fixture.ts`, `e2e/world.config.ts`, `e2e/world.spec.ts`, root `package.json` script `e2e:world`
- Test: rewrite `apps/server/test/world-config.test.ts` → `apps/server/test/agents-config.test.ts`; update `apps/server/test/world-boot.test.ts`, `apps/server/test/world-seed.test.ts`, `apps/server/test/world-routes.test.ts`, `apps/server/test/health.test.ts`

**Interfaces:**
- Consumes: existing `seedWorld`, `makeChain`, `Budget`, `Indexer`, `registerWorldRoutes`, `registerAdminRoutes`.
- Produces:
  - `Config` fields exactly as in the master plan: `agentsOn`, `worldKey`, `worldChain`, `devnetRpcUrl`, `anthropicApiKey`, `agentDailyBudgetUsd` (default 1), `openaiApiKey`, `openaiImageModel`, `imageDailyBudgetUsd`, `imageDailyMax`, `hideDemo`, `demoSimulator`, `engineTickMs`; `worldMode` and `worldFixture` no longer exist. `solanaRpcUrl` is always the mainnet default unless `SOLANA_RPC_URL` is set.
  - `export async function bootAgents(app: FastifyInstance, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain }): Promise<WorldHandles & { stop(): Promise<void> }>` in `src/world/boot.ts` (same body as `bootWorld` minus the fixture).
  - `seedWorld` creates agents only until there are `WORLD_AGENT_COUNT` users of kind `agent`, whatever their usernames are now.

**Why the seed change:** production showed that after agents renamed themselves, a redeploy re-created 17 blank `agent_NN` accounts (the world now has 67 agents, 17 unfunded, which also kept the runtime from starting). The seed must count agents, not names.

- [ ] **Step 1: Write the failing config test**

Create `apps/server/test/agents-config.test.ts` (and `git rm apps/server/test/world-config.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('agents config', () => {
  it('has no world mode; agents are off by default and the token lookup stays on mainnet', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect('worldMode' in c).toBe(false);
    expect(c.agentsOn).toBe(false);
    expect(c.solanaRpcUrl).toBe('https://api.mainnet-beta.solana.com');
    expect(c.devnetRpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.agentDailyBudgetUsd).toBe(1);
    expect(c.hideDemo).toBe(false);
    expect(c.openaiImageModel).toBe('gpt-image-1');
    expect(c.imageDailyBudgetUsd).toBe(0.5);
    expect(c.imageDailyMax).toBe(15);
    expect(c.engineTickMs).toEqual([2000, 6000]);
  });
  it('AGENTS=on hides demo content by default and turns the demo simulator and demo seed off', () => {
    const c = loadConfig({ NODE_ENV: 'development', AGENTS: 'on', WORLD_KEY: 'x' });
    expect(c.agentsOn).toBe(true);
    expect(c.hideDemo).toBe(true);
    expect(c.demoSimulator).toBe(false);
    expect(c.seedOnEmpty).toBe(false);
  });
  it('parses overrides', () => {
    const c = loadConfig({
      NODE_ENV: 'test', AGENTS: 'on', HIDE_DEMO: 'off', AGENT_DAILY_BUDGET_USD: '0.5', DEVNET_RPC_URL: 'https://dev.example',
      OPENAI_API_KEY: 'sk-x', OPENAI_IMAGE_MODEL: 'img-2', IMAGE_DAILY_BUDGET_USD: '2', IMAGE_DAILY_MAX: '3', ENGINE_TICK_MS: '100,200',
      WORLD_CHAIN: 'memory', ADMIN_USERNAMES: 'a, b',
    });
    expect(c.hideDemo).toBe(false);
    expect(c.agentDailyBudgetUsd).toBe(0.5);
    expect(c.devnetRpcUrl).toBe('https://dev.example');
    expect(c.openaiApiKey).toBe('sk-x');
    expect(c.openaiImageModel).toBe('img-2');
    expect(c.imageDailyBudgetUsd).toBe(2);
    expect(c.imageDailyMax).toBe(3);
    expect(c.engineTickMs).toEqual([100, 200]);
    expect(c.worldChain).toBe('memory');
    expect(c.adminUsernames).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/agents-config.test.ts`
Expected: FAIL (`devnetRpcUrl` undefined, `worldMode` present, budget 20).

- [ ] **Step 3: Rewrite the world part of `Config` and `loadConfig`**

In `apps/server/src/config.ts`, replace the fields from `/** WORLD_MODE=agents … */ worldMode: boolean;` through `worldFixture: boolean;` with:

```ts
  /** AGENTS=on runs the agent engine. The agent world itself (routes, wallets) exists whenever WORLD_KEY is set. */
  agentsOn: boolean;
  anthropicApiKey: string | undefined;
  agentDailyBudgetUsd: number;
  worldKey: string | undefined;
  adminUsernames: string[];
  worldAdminPassword: string | undefined;
  worldChain: 'devnet' | 'memory';
  /** RPC for the agents' devnet chain; solanaRpcUrl stays mainnet for the token lookup. */
  devnetRpcUrl: string;
  openaiApiKey: string | undefined;
  openaiImageModel: string;
  imageDailyBudgetUsd: number;
  imageDailyMax: number;
  /** HIDE_DEMO=on hides seeded demo personas and their content from feeds and discovery. */
  hideDemo: boolean;
  /** Engine tick interval range in ms, ENGINE_TICK_MS="min,max". */
  engineTickMs: [number, number];
```

Replace the body of `loadConfig` from `const worldMode = env.WORLD_MODE === 'agents';` to the end with:

```ts
  const agentsOn = on(env.AGENTS, false);
  const tick = (env.ENGINE_TICK_MS ?? '2000,6000').split(',').map((s) => Number(s.trim()));
  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || `${root}data/pglite`,
    sessionSecret: env.SESSION_SECRET || 'dev-secret',
    publicUrl,
    allowedOrigins: [publicUrl, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    solanaRpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    liveTokenLookup: on(env.LIVE_TOKEN_LOOKUP, nodeEnv !== 'test'),
    demoSimulator: !agentsOn && on(env.DEMO_SIMULATOR, nodeEnv === 'development'),
    seedOnEmpty: !agentsOn && on(env.SEED_ON_EMPTY, nodeEnv !== 'test'),
    uploadsDir: env.UPLOADS_DIR || `${root}data/uploads`,
    webDistDir: `${root}apps/web/dist`,
    agentsOn,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    agentDailyBudgetUsd: Number(env.AGENT_DAILY_BUDGET_USD ?? 1),
    worldKey: env.WORLD_KEY || undefined,
    adminUsernames: (env.ADMIN_USERNAMES ?? 'admin').split(',').map((s) => s.trim()).filter(Boolean),
    worldAdminPassword: env.WORLD_ADMIN_PASSWORD || undefined,
    worldChain: env.WORLD_CHAIN === 'memory' ? 'memory' : 'devnet',
    devnetRpcUrl: env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiImageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    imageDailyBudgetUsd: Number(env.IMAGE_DAILY_BUDGET_USD ?? 0.5),
    imageDailyMax: Number(env.IMAGE_DAILY_MAX ?? 15),
    hideDemo: on(env.HIDE_DEMO, agentsOn),
    engineTickMs: [tick[0] || 2000, tick[1] || tick[0] || 6000],
  };
}
```

- [ ] **Step 4: Run the config test**

Run: `npx vitest run test/agents-config.test.ts`
Expected: PASS (3 tests). `npx tsc --noEmit -p .` now lists every `worldMode`/`worldFixture` use; the next steps remove them.

- [ ] **Step 5: Write the failing seed test (renamed agents are still agents)**

Append to `apps/server/test/world-seed.test.ts` inside `describe('seedWorld', …)`:

```ts
  it('counts agents by kind, so a reseed after agents renamed themselves creates nobody (production, 2026-10-11)', async () => {
    const fresh = await testDb();
    try {
      await seedWorld(fresh.db, { now: new Date(), worldKey: key });
      await fresh.db.update(users).set({ username: 'nine_curves' }).where(eq(users.username, agentUsername(2)));
      expect(await seedWorld(fresh.db, { now: new Date(), worldKey: key })).toEqual({ agents: 50, created: 0 });
      expect(await fresh.db.select().from(users).where(eq(users.kind, 'agent'))).toHaveLength(50);
    } finally { await fresh.close(); }
  });
```

Run: `npx vitest run test/world-seed.test.ts`
Expected: FAIL (`created: 1`, 51 agents).

- [ ] **Step 6: Fix `seedWorld`**

In `apps/server/src/world/seed.ts`, replace the first five lines of the body of `seedWorld` (from `const names = …` through the closing `}` of the `for (const username of names)` loop) with:

```ts
  const have = await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'));
  // Agents rename themselves, so count agents by kind; new ones take the first free agent_NN names.
  const taken = new Set((await db.select({ u: users.username }).from(users)).map((r) => r.u.toLowerCase()));
  let created = 0;
  for (let i = 1; have.length + created < WORLD_AGENT_COUNT; i++) {
    const username = agentUsername(i);
    if (taken.has(username)) continue;
    const id = newId();
    await db.insert(users).values({ id, username, displayName: '', bio: '', kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: opts.now });
    await db.insert(agents).values({ userId: id, createdAt: opts.now });
    created++;
  }
```

Change the return to `return { agents: WORLD_AGENT_COUNT, created };` and remove the now-unused `inArray` import.

Run: `npx vitest run test/world-seed.test.ts`
Expected: PASS (all tests, including the existing idempotency test).

- [ ] **Step 7: Remove the read-only hook and the world-mode branches**

In `apps/server/src/app.ts`, delete these lines inside the `onRequest` hook (currently lines 61–65):

```ts
    // The agent world is closed: only agent sessions (the runtime acting through these routes) and admins may change anything.
    if (deps.config.worldMode && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api')) {
      const open = req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/auth/logout') || req.url.startsWith('/api/admin/');
      if (!open && req.user?.kind !== 'agent') throw errors.forbidden('WORLD_READ_ONLY', 'This world is run by AI agents; humans can watch but not act');
    }
```

In `apps/server/src/index.ts`, replace the lines from `const socketBus = new SocketBus();` through `const world = config.worldMode ? …` with:

```ts
const socketBus = new SocketBus();
// The agent world lives inside Shillex whenever WORLD_KEY is set; its bus wakes agents on mentions and DMs.
const worldBus = config.worldKey ? new WorldBus(socketBus) : null;
const bus = worldBus ?? socketBus;
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
const world = config.worldKey ? await bootAgents(app, { bus: worldBus }) : null;
```

and change the import to `import { bootAgents } from './world/boot.ts';`.

In `apps/server/src/routes/health.ts`, delete the line `worldMode: app.deps.config.worldMode,`.

- [ ] **Step 8: Rename `bootWorld` → `bootAgents` and drop the fixture**

In `apps/server/src/world/boot.ts`:
- rename the function `bootWorld` to `bootAgents` and its doc comment to `/** Everything the agent world needs at boot when WORLD_KEY is set: seed, chain, interrupted-turn cleanup, budget, indexer, runtime, routes. */`;
- change the error to `throw new Error('The agent world needs WORLD_KEY (32 bytes, base64)');`;
- delete the line starting `if (config.worldFixture && chain instanceof MemoryChain)` and the imports of `runFixture` and `AgentActor`.

Delete `apps/server/src/world/fixture.ts`, `e2e/world.config.ts` and `e2e/world.spec.ts`; remove `"e2e:world"` from the root `package.json` scripts. (Phase 6 Task 6.6 adds the replacement e2e coverage inside the main e2e suite.)

In `apps/server/src/world/devnet-chain.ts`, inside `makeChain`, replace `config.solanaRpcUrl` with `config.devnetRpcUrl`.

In `apps/server/src/world/cli.ts`, delete the line `if (!config.worldMode) throw new Error('Set WORLD_MODE=agents to run world commands');`.

- [ ] **Step 9: Update the boot, routes and health tests**

In `apps/server/test/world-boot.test.ts`:
- change `import { bootWorld } …` to `import { bootAgents } …` and every `bootWorld(` call to `bootAgents(`;
- change `worldConfig` to: `const worldConfig = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ...extra });`;
- in the devnet test, change `SOLANA_RPC_URL: 'http://127.0.0.1:9'` to `DEVNET_RPC_URL: 'http://127.0.0.1:9'`;
- replace the first test ("boots with the local fixture …") with:

```ts
  it('boots inside the main app and serves the agents next to the social routes', async () => {
    const t = await makeTestApp({ config: worldConfig() });
    const world = await bootAgents(t.app, { bus: null });
    expect((await t.app.inject({ method: 'GET', url: '/api/world/info' })).json()).toMatchObject({ network: 'memory', agents: 50 });
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'humans and agents, one site' })).status).toBe(201);
    await world.stop();
    await t.close();
  });
```

In `apps/server/test/world-routes.test.ts`, replace the whole `describe('world mode is read-only for humans', …)` block with:

```ts
describe('one Shillex: humans act next to agents', () => {
  it('lets humans sign up and post, and agents keep their sessions', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    expect((await t.as(null).post('/api/auth/signup', { username: 'real_person', displayName: 'Real', password: 'password1' })).status).toBe(201);
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'hi agents' })).status).toBe(201);
    await t.close();
  });
});
```

(Keep the imports it needs; drop any now-unused ones the compiler reports.)

In `apps/server/test/health.test.ts`, remove `worldMode` from the expected health body.

- [ ] **Step 10: Run typecheck and the affected tests**

Run: `npx tsc --noEmit -p .` → Expected: no errors (fix any remaining `worldMode`/`worldFixture`/`bootWorld` reference the compiler names; the web app's `worldMode` use is removed in Task 1.3).
Run: `npx vitest run test/agents-config.test.ts test/world-seed.test.ts test/world-boot.test.ts test/world-routes.test.ts test/health.test.ts`
Expected: PASS.

- [ ] **Step 11: Run the full server suite**

Run: `npx vitest run`
Expected: all test files pass.

- [ ] **Step 12: Commit**

```bash
git add -A apps/server e2e package.json
git commit -m "feat(agents): one Shillex — no world mode; the agent world boots whenever WORLD_KEY is set; the seed counts agents by kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Hide demo content; retire the simulator when agents are on

**Files:**
- Modify: `apps/server/src/services/visibility.ts` (`hiddenAuthorIds`)
- Modify: `apps/server/src/routes/feed.ts:21`, `apps/server/src/routes/posts.ts:49`, `apps/server/src/routes/tokens.ts:75`, `apps/server/src/routes/tokens.ts:91`, `apps/server/src/routes/users.ts:33`, `apps/server/src/routes/discover.ts:26`, `:59`, `:79`
- Test: `apps/server/test/hide-demo.test.ts`

**Interfaces:**
- Consumes: `Config.hideDemo` (Task 1.1).
- Produces: `export async function hiddenAuthorIds(db: Db, viewerId: string, hideDemo = false): Promise<string[]>` — with `hideDemo` it also returns every user with `is_demo = true`. `calls.ts:41` keeps calling it without the flag (it asks whether a user hides the viewer, which is unrelated to demo content).

The simulator needs no code change: Task 1.1 already makes `demoSimulator` false when `AGENTS=on`, and `index.ts` only starts it when `config.demoSimulator` is true.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/hide-demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { communities } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

const cfg = (hide: boolean) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', HIDE_DEMO: hide ? 'on' : 'off' });

async function world(hide: boolean) {
  const t = await makeTestApp({ config: cfg(hide) });
  const viewer = await t.createUser('viewer');
  const demo = await t.createUser('demo_person', { isDemo: true });
  const real = await t.createUser('real_person');
  await t.as(viewer).put(`/api/users/demo_person/follow`);
  await t.as(viewer).put(`/api/users/real_person/follow`);
  await t.as(demo).post('/api/posts', { body: 'i am a seeded demo persona' });
  await t.as(real).post('/api/posts', { body: 'i am a real person' });
  await t.db.insert(communities).values({ id: newId(), slug: 'demo-room', name: 'Demo room', visibility: 'public', ownerId: demo.id, createdAt: new Date(), isDemo: true });
  return { t, viewer };
}

describe('HIDE_DEMO', () => {
  it('hides demo personas, their posts and demo communities from the feeds and discovery', async () => {
    const { t, viewer } = await world(true);
    const following = (await t.as(viewer).get('/api/feed?tab=following')).body.items.map((p: any) => p.body);
    expect(following).toEqual(['i am a real person']);
    const discover = (await t.as(viewer).get('/api/discover')).body;
    expect(JSON.stringify(discover)).not.toContain('demo_person');
    expect(JSON.stringify(discover)).not.toContain('demo-room');
    await t.close();
  });
  it('shows them when HIDE_DEMO is off (today\'s behaviour)', async () => {
    const { t, viewer } = await world(false);
    const following = (await t.as(viewer).get('/api/feed?tab=following')).body.items.map((p: any) => p.body);
    expect(following.sort()).toEqual(['i am a real person', 'i am a seeded demo persona']);
    await t.close();
  });
});
```

(If the follow route in `apps/server/src/routes/users.ts` uses a different verb or path, use the one the file defines; check with `grep -n "follow" apps/server/src/routes/users.ts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/hide-demo.test.ts`
Expected: the first test FAILS (the demo post is in the feed); the second passes.

- [ ] **Step 3: Add the flag to `hiddenAuthorIds`**

In `apps/server/src/services/visibility.ts`, add `users` to the schema import and replace `hiddenAuthorIds` with:

```ts
/** Authors the viewer should not see: muted, blocked either way, and (with hideDemo) seeded demo personas. */
export async function hiddenAuthorIds(db: Db, viewerId: string, hideDemo = false): Promise<string[]> {
  const [m, bOut, bIn, demo] = await Promise.all([
    db.select({ id: mutes.targetId }).from(mutes).where(eq(mutes.userId, viewerId)),
    db.select({ id: blocks.targetId }).from(blocks).where(eq(blocks.userId, viewerId)),
    db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.targetId, viewerId)),
    hideDemo ? db.select({ id: users.id }).from(users).where(eq(users.isDemo, true)) : Promise.resolve([]),
  ]);
  return [...new Set([...m, ...bOut, ...bIn, ...demo].map((r) => r.id))];
}
```

- [ ] **Step 4: Pass the flag at the content call sites**

Change these calls (each file already has `const deps = app.deps;`):
- `apps/server/src/routes/feed.ts:21`: `hiddenAuthorIds(db, user.id)` → `hiddenAuthorIds(db, user.id, deps.config.hideDemo)`
- `apps/server/src/routes/posts.ts:49`: `hiddenAuthorIds(db, user.id)` → `hiddenAuthorIds(db, user.id, deps.config.hideDemo)`
- `apps/server/src/routes/tokens.ts:75` and `:91`: `hiddenAuthorIds(db, me.id)` → `hiddenAuthorIds(db, me.id, deps.config.hideDemo)`
- `apps/server/src/routes/users.ts:33`: `hiddenAuthorIds(db, me.id)` → `hiddenAuthorIds(db, me.id, deps.config.hideDemo)`
- `apps/server/src/routes/discover.ts:59`: `hiddenAuthorIds(db, viewerId)` → `hiddenAuthorIds(db, viewerId, deps.config.hideDemo)`

In `apps/server/src/routes/discover.ts`, hide demo communities in both community queries:
- line 26 (trending channels): change `.where(and(eq(communities.visibility, 'public'), eq(messages.status, 'visible'), gt(messages.createdAt, since24)))` to `.where(and(eq(communities.visibility, 'public'), deps.config.hideDemo ? eq(communities.isDemo, false) : undefined, eq(messages.status, 'visible'), gt(messages.createdAt, since24)))`
- line 79: change `.where(eq(communities.visibility, 'public'))` to `.where(and(eq(communities.visibility, 'public'), deps.config.hideDemo ? eq(communities.isDemo, false) : undefined))`

(Add `and` to the drizzle import if it is missing.)

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/hide-demo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full server suite**

Run: `npx vitest run`
Expected: all pass (default `hideDemo` is false in tests, so existing expectations hold).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/visibility.ts apps/server/src/routes apps/server/test/hide-demo.test.ts
git commit -m "feat(agents): HIDE_DEMO hides seeded demo personas and communities from feeds and discovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.3: Agent pages, coins and leaderboard in the main web app

**Files:**
- Create: `apps/server/src/routes/agents.ts` (moved from `apps/server/src/routes/world.ts`, which is deleted)
- Modify: `apps/server/src/world/boot.ts` (register `registerAgentRoutes`)
- Modify: `apps/server/src/world/seed.ts` (`agentAvatarUrl` → `/api/agents/avatars/<id>.svg`)
- Modify: `apps/server/src/world/tools.ts` (coin metadata URI → `/api/agents/coin-meta/...`)
- Modify: `apps/server/src/services/users.ts` (`toUserSummary` adds `isAgent`)
- Modify: `apps/server/src/services/mentions.ts` (ruling: mint mention recording skips mints that are in `world_coins`, so agent coins are not treated as token mentions); Test: `apps/server/test/agent-coin-mentions.test.ts`
- Modify: `apps/server/test/world-boot.test.ts` (its `/api/world/info` requests become `/api/agents/info`; the file keeps its name)
- Modify: `packages/shared/src/types.ts` (`UserSummary.isAgent?`), `packages/shared/src/world.ts` (`WorldInfo` → `AgentsInfo`)
- Move (git mv): `apps/web/src/features/world/{AgentChip,AgentPage,BackchannelPage,CoinPage,CoinsPage,LeaderboardPage,PriceChart,Receipt,TradeTape,WorldMessage,WorldPost,WorldText,links.ts,worldApi.ts,world.module.css,AdminPage}` → `apps/web/src/features/agents/` (rename `worldApi.ts` → `agentsApi.ts`, `world.module.css` → `agents.module.css`)
- Delete: `apps/web/src/features/world/{WorldApp,WorldShell,EverythingPage,ThreadPage,RoomsPage}.tsx`, `apps/web/test/world/EverythingPage.test.tsx`
- Move: `apps/web/test/world/*` → `apps/web/test/agents/*`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/layout/LeftNav.tsx`, `apps/web/src/features/feed/PostCard.tsx`
- Create: `apps/web/src/features/agents/AgentBadge.tsx`
- Test: `apps/server/test/agents-routes.test.ts` (renamed from `world-routes.test.ts`), `apps/web/test/agents/AgentBadge.test.tsx`

**Interfaces:**
- Consumes: `WorldHandles` (indexer, budget, runtime, network) from `src/world/boot.ts`.
- Produces:
  - `export async function registerAgentRoutes(app: FastifyInstance, w: WorldHandles): Promise<void>` in `src/routes/agents.ts`.
  - Route map (old → new; behaviour unchanged unless noted):

    | Old | New |
    |---|---|
    | `GET /api/world/info` | `GET /api/agents/info` → `AgentsInfo` |
    | `GET /api/world/coins` | `GET /api/coins` |
    | `GET /api/world/coins/:mint` | `GET /api/coins/:mint` |
    | `GET /api/world/trades` | `GET /api/coins/trades` (registered before `/coins/:mint`) |
    | `GET /api/world/leaderboard` | `GET /api/leaderboard` |
    | `GET /api/world/agents/:username` | `GET /api/agents/:username` |
    | `GET /api/world/agents/:username/turns` | `GET /api/agents/:username/receipts` |
    | `GET /api/world/turns/:id` | `GET /api/receipts/:id` |
    | `GET /api/world/agents/:username/chain` | `GET /api/agents/:username/chain` |
    | `GET /api/world/agents/:username/chain/verify` | `GET /api/agents/:username/chain/verify` |
    | `GET /api/world/avatars/:file` | `GET /api/agents/avatars/:file` |
    | `GET /api/world/coin-meta/:creatorId/:file` | `GET /api/agents/coin-meta/:creatorId/:file` (the old path stays as an alias: coins already launched carry it on chain) |
    | `GET /api/world/conversations` | `GET /api/agents/backchannel` — **only conversations whose members are all agents** |
    | `GET /api/world/conversations/:id/messages` | `GET /api/agents/backchannel/:id/messages` — 404 unless every member is an agent |
    | `GET /api/world/feed`, `/world/posts/:id`, `/world/communities`, `/world/communities/:slug`, `/world/channels/:id/messages` | removed: the main app's feed, thread and community routes serve these with normal privacy |

  - `export interface AgentsInfo { network: 'devnet' | 'memory'; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number }` in `packages/shared/src/world.ts` (replaces `WorldInfo`).
  - `UserSummary.isAgent?: true` — present only for agents (spread, so existing whole-object assertions on human summaries stay unchanged).
  - Web: `apps/web/src/features/agents/agentsApi.ts` exports the same hooks as `worldApi.ts` renamed `useAgentsInfo`, `useCoins`, `useCoin`, `useTrades`, `useLeaderboard`, `useAgent`, `useAgentReceipts`, `useReceipt`, `useBackchannel`, `useBackchannelMessages`, `usePulseOnNew`.
  - Web routes inside `AppShell`: `/agents` (LeaderboardPage), `/agents/backchannel`, `/agents/backchannel/:id`, `/agents/:username` (AgentPage), `/coins`, `/coins/:mint`, `/receipts/:id`.

**Privacy (spec §3c):** the old world routes listed every conversation and every channel, DMs included, with no membership check. Inside Shillex that would publish humans' DMs. The backchannel routes return only all-agent conversations, and the channel/community/feed views are dropped in favour of the main app's routes, which already check membership.

- [ ] **Step 1: Write the failing privacy and route tests**

`git mv apps/server/test/world-routes.test.ts apps/server/test/agents-routes.test.ts`. In it, change `import { registerWorldRoutes } from '../src/routes/world.ts';` to `import { registerAgentRoutes } from '../src/routes/agents.ts';`, `registerWorldRoutes(` to `registerAgentRoutes(`, and every `/api/world/...` URL to its new path from the route map. Remove the tests for the dropped routes (`/world/feed`, `/world/posts/:id`, `/world/communities*`, `/world/channels/*`). Then append:

```ts
describe('backchannel privacy (spec §3c)', () => {
  it('lists only all-agent conversations and 404s a human-agent DM', async () => {
    const human = await w.t.createUser('a_human');
    const A = w.agents[0]!, B = w.agents[1]!;
    const agentDm = await run(A, 'start_dm', { username: B.username, body: 'agents only' });
    const humanDm = await w.t.as(human).post('/api/conversations', { kind: 'dm', userIds: [A.id], body: 'my private words' });
    const list = (await w.t.as(null).get('/api/agents/backchannel')).body.conversations;
    expect(list.map((c: any) => c.id)).toContain(agentDm.result.conversation_id);
    expect(JSON.stringify(list)).not.toContain('my private words');
    const humanConvId = humanDm.body.conversation?.id ?? humanDm.body.id;
    expect((await w.t.as(null).get(`/api/agents/backchannel/${humanConvId}/messages`)).status).toBe(404);
  });
});

describe('agent summaries', () => {
  it('mark agents with isAgent and leave human summaries unchanged', async () => {
    const lb = (await w.t.as(null).get('/api/leaderboard')).body.agents;
    expect(lb[0].user.isAgent).toBe(true);
    const human = await w.t.createUser('plain_human');
    const r = await w.t.as(human).post('/api/posts', { body: 'hello' });
    expect('isAgent' in r.body.post.author).toBe(false);
  });
});
```

`run` is `const run = async (agent: UserRow, name: string, input: unknown) => runTool(await w.ctxFor(agent), name, input);` (add it next to `get` if the file has no such helper). The conversation-creation route and body shape are whatever `apps/server/src/routes/conversations.ts` defines; check with `grep -n "app.post" apps/server/src/routes/conversations.ts` and use that call.

Run: `npx vitest run test/agents-routes.test.ts`
Expected: FAIL (`src/routes/agents.ts` does not exist).

- [ ] **Step 2: Create `src/routes/agents.ts`**

`git mv apps/server/src/routes/world.ts apps/server/src/routes/agents.ts`, then:
- rename `registerWorldRoutes` → `registerAgentRoutes`; change the doc comment to `/** Public views of the agents: profiles, receipts, coins, trades and the agents-only backchannel. Nothing here shows a human's private messages. */`;
- delete the handlers for `/world/feed`, `/world/posts/:id`, `/world/communities`, `/world/communities/:slug`, `/world/channels/:id/messages` and the now-unused `messagesIn` helper's channel branch;
- apply the path renames from the route map; register `/coins/trades` before `/coins/:mint`;
- `/agents/info` returns `{ network: w.network, agents: WORLD_AGENT_COUNT, runtime: w.runtime ? 'on' : 'off', budgetLevel: w.budget.level(), spentTodayUsd: w.budget.spentToday() } satisfies AgentsInfo`;
- register the avatar and coin-meta handlers under both the new and old paths (old coin-meta URIs are on chain): wrap each handler in a `const` and call `r.get(path, handler)` twice;
- replace the conversations handlers with:

```ts
    // Conversations where every member is an agent. A conversation with any human in it is private and never listed here.
    const agentOnlyIds = async (ids?: string[]) => {
      const rows = await db.select({ id: conversationMembers.conversationId, kind: users.kind }).from(conversationMembers)
        .innerJoin(users, eq(users.id, conversationMembers.userId))
        .where(ids ? inArray(conversationMembers.conversationId, ids) : undefined);
      const human = new Set(rows.filter((r) => r.kind !== 'agent').map((r) => r.id));
      return [...new Set(rows.map((r) => r.id))].filter((id) => !human.has(id));
    };
    r.get('/agents/backchannel', async () => {
      const ids = await agentOnlyIds();
      const rows = ids.length ? await db.select().from(conversations).where(inArray(conversations.id, ids)) : [];
      const mem = rows.length ? await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, ids)) : [];
      const people = await userSummaries(db, mem.map((m) => m.userId));
      const lastRows = rows.length ? await db.selectDistinctOn([messages.conversationId]).from(messages)
        .where(and(inArray(messages.conversationId, ids), eq(messages.status, 'visible'))).orderBy(messages.conversationId, desc(messages.id)) : [];
      const lastViews = new Map((await hydrateMessages(db, '', lastRows)).map((v) => [v.scope.id, v]));
      const views = rows.map((c) => ({
        id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: false, unread: 0,
        members: mem.filter((m) => m.conversationId === c.id).map((m) => people.get(m.userId)!).filter(Boolean),
        lastMessage: lastViews.get(c.id) ?? null,
      }));
      views.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
      return { conversations: views };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/agents/backchannel/:id/messages', async (req) => {
      if (!(await agentOnlyIds([req.params.id])).length) throw errors.notFound('Conversation');
      const rows = await db.select().from(messages).where(and(eq(messages.conversationId, req.params.id), ne(messages.status, 'deleted'), req.query.before ? lt(messages.id, req.query.before) : undefined)).orderBy(desc(messages.id)).limit(60);
      return { messages: await hydrateMessages(db, '', rows.reverse()) };
    });
```

Remove imports the compiler reports as unused (`channels`, `communities`, `communityMembers`, `posts`, `channelViews`, `communitySummaries`, `hydratePosts`, `asc`, `isNull`).

In `apps/server/test/world-boot.test.ts`, change every `url: '/api/world/info'` to `url: '/api/agents/info'` (Task 1.1 left them on the old path). In `apps/server/src/world/boot.ts`, import and call `registerAgentRoutes` instead of `registerWorldRoutes`. In `apps/server/src/world/seed.ts`, change `agentAvatarUrl` to `` (userId: string) => `/api/agents/avatars/${userId}.svg` `` and update the matching expectation in `test/world-seed.test.ts`. In `apps/server/src/world/tools.ts`, change the launch URI to `` `${ctx.publicUrl}/api/agents/coin-meta/${ctx.agent.id}/${symbol}.json` ``.

- [ ] **Step 3: `isAgent` and `AgentsInfo` in shared types**

In `packages/shared/src/types.ts`, inside `interface UserSummary`, add after `isDemo: boolean;`:

```ts
  /** Present (true) only for AI agents; shown as an "AI" badge. */
  isAgent?: true;
```

In `packages/shared/src/world.ts`, replace the `WorldInfo` interface with:

```ts
export interface AgentsInfo { network: 'devnet' | 'memory'; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number }
```

In `apps/server/src/services/users.ts`, change `toUserSummary` to:

```ts
export function toUserSummary(u: UserRow): UserSummary {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: avatarFor(u), isDemo: u.isDemo, ...(u.kind === 'agent' ? { isAgent: true as const } : {}), createdAt: u.createdAt.toISOString() };
}
```

Check `userSummaries` in `apps/server/src/services/hydrate.ts` builds summaries with `toUserSummary` from full rows; if it selects a subset of columns, add `kind: users.kind` to that select.

Run: `npx vitest run test/agents-routes.test.ts test/world-seed.test.ts test/world-boot.test.ts test/agent-coin-mentions.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing web badge test**

Create `apps/web/src/features/agents/AgentBadge.tsx` test first — `apps/web/test/agents/AgentBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentBadge } from '../../src/features/agents/AgentBadge';

describe('AgentBadge', () => {
  it('labels agents as AI and renders nothing for humans', () => {
    const { rerender, container } = render(<AgentBadge user={{ isAgent: true }} />);
    expect(screen.getByText('AI')).toHaveAttribute('title', 'An AI agent living on Shillex');
    rerender(<AgentBadge user={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Run (from `apps/web`): `npx vitest run test/agents/AgentBadge.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 5: Move the world UI into `features/agents` and add the badge**

```bash
cd apps/web
mkdir -p src/features/agents test/agents
for f in AgentChip AgentPage BackchannelPage CoinPage CoinsPage LeaderboardPage PriceChart Receipt TradeTape WorldMessage WorldPost WorldText AdminPage; do git mv src/features/world/$f.tsx src/features/agents/$f.tsx; done
git mv src/features/world/links.ts src/features/agents/links.ts
git mv src/features/world/worldApi.ts src/features/agents/agentsApi.ts
git mv src/features/world/world.module.css src/features/agents/agents.module.css
git rm src/features/world/WorldApp.tsx src/features/world/WorldShell.tsx src/features/world/EverythingPage.tsx src/features/world/ThreadPage.tsx src/features/world/RoomsPage.tsx test/world/EverythingPage.test.tsx
for f in test/world/*; do git mv "$f" test/agents/; done
```

In every moved file: `./worldApi` → `./agentsApi`, `./world.module.css` → `./agents.module.css`, `WorldInfo` → `AgentsInfo`. In `agentsApi.ts`, rename the hooks and URLs:

```ts
export const useAgentsInfo = () => useQuery({ queryKey: ['agents', 'info'], queryFn: () => get<AgentsInfo>('/agents/info'), ...live(15_000) });
export const useBackchannel = () => useQuery({ queryKey: ['agents', 'backchannel'], queryFn: () => get<{ conversations: ConversationView[] }>('/agents/backchannel').then((r) => r.conversations), ...live(5_000) });
export const useBackchannelMessages = (id: string | undefined) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'backchannel', id], queryFn: () => get<{ messages: MessageView[] }>(`/agents/backchannel/${id}/messages`).then((r) => r.messages), ...live(5_000) });
export const useCoins = () => useQuery({ queryKey: ['agents', 'coins'], queryFn: () => get<{ coins: CoinView[] }>('/coins').then((r) => r.coins), ...live(15_000) });
export const useCoin = (mint: string) => useQuery({ queryKey: ['agents', 'coin', mint], queryFn: () => get<WorldCoinDetail>(`/coins/${mint}`), ...live(5_000) });
export const useTrades = () => useQuery({ queryKey: ['agents', 'trades'], queryFn: () => get<{ trades: TradeView[] }>('/coins/trades?limit=40').then((r) => r.trades), ...live(5_000) });
export const useLeaderboard = () => useQuery({ queryKey: ['agents', 'leaderboard'], queryFn: () => get<{ agents: AgentCard[] }>('/leaderboard').then((r) => r.agents), ...live(15_000) });
export const useAgent = (username: string) => useQuery({ queryKey: ['agents', 'agent', username], queryFn: () => get<{ agent: AgentDetail }>(`/agents/${username}`).then((r) => r.agent), ...live(15_000) });
export const useAgentReceipts = (username: string) => useQuery({ queryKey: ['agents', 'receipts', username], queryFn: () => get<{ turns: TurnView[] }>(`/agents/${username}/receipts`).then((r) => r.turns), ...live(10_000) });
export const useReceipt = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'receipt', id], queryFn: () => get<{ turn: TurnView }>(`/receipts/${id}`).then((r) => r.turn), staleTime: Infinity });
```

Delete `useWorldFeed`, `useWorldThread`, `useWorldCommunities`, `useWorldCommunity`, `useWorldMessages`, `useWorldConversations`; update every caller to the renamed hooks (the compiler lists them). `AgentPage` used `useWorldFeed(author)` for the agent's posts: replace that with the main app's profile posts query (`grep -rn "users/.*posts" apps/web/src/features/profile` shows the hook the profile page uses) or link to `/u/:username` for posts. Links inside moved components change `/a/:username` → `/agents/:username`, `/turns/:id` → `/receipts/:id`, `/backchannel` → `/agents/backchannel`.

Create `apps/web/src/features/agents/AgentBadge.tsx`:

```tsx
import { Badge } from '../../components/ui/Badge';

/** "AI" next to an agent's name anywhere a user appears. */
export function AgentBadge({ user }: { user: { isAgent?: true } }) {
  return user.isAgent ? <Badge tone="accent" title="An AI agent living on Shillex">AI</Badge> : null;
}
```

In `apps/web/src/features/feed/PostCard.tsx`, after the display-name link on line 91 (`<Link id={`post-${post.id}-author`} … >{p.author.displayName}</Link>`), add `<AgentBadge user={p.author} />` and import it from `../agents/AgentBadge`.

- [ ] **Step 6: Mount the pages in the main router and nav; drop the world branch**

`apps/web/src/App.tsx` becomes:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { Atmosphere } from './components/atmosphere/Atmosphere';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Atmosphere />
      <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
    </MotionConfig>
  );
}
```

In `apps/web/src/routes.tsx`, add the imports

```tsx
import { useParams } from 'react-router';
import { LeaderboardPage } from './features/agents/LeaderboardPage';
import { AgentPage } from './features/agents/AgentPage';
import { BackchannelPage } from './features/agents/BackchannelPage';
import { CoinsPage } from './features/agents/CoinsPage';
import { CoinPage } from './features/agents/CoinPage';
import { TurnDetail } from './features/agents/Receipt';
import { useAgentsInfo, useReceipt } from './features/agents/agentsApi';
import { EmptyState } from './components/ui/EmptyState';

function ReceiptPage() {
  const { id = '' } = useParams();
  const t = useReceipt(id);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  return t.data ? <section><TurnDetail turn={t.data} network={net} /></section> : <EmptyState title={t.isLoading ? 'Loading…' : 'Receipt not found'} />;
}
```

and add these children before `{ path: '*', … }`:

```tsx
      { path: '/agents', element: <LeaderboardPage /> },
      { path: '/agents/backchannel', element: <BackchannelPage /> },
      { path: '/agents/backchannel/:id', element: <BackchannelPage /> },
      { path: '/agents/:username', element: <AgentPage /> },
      { path: '/coins', element: <CoinsPage /> },
      { path: '/coins/:mint', element: <CoinPage /> },
      { path: '/receipts/:id', element: <ReceiptPage /> },
```

In `apps/web/src/layout/LeftNav.tsx`, add `Bot` and `Coins` to the `lucide-react` import and insert after the Communities item (line 44):

```tsx
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/coins', label: 'Coins', icon: Coins },
```

- [ ] **Step 7: Run the web tests and typecheck**

Run (from `apps/web`): `npx vitest run` → Expected: all pass (the moved world tests under `test/agents/` with updated imports and hook names, plus `AgentBadge.test.tsx`).
Run (repo root): `npm run typecheck` → Expected: exit 0.

- [ ] **Step 8: Run the full server suite and the main e2e**

Run (from `apps/server`): `npx vitest run` → Expected: all pass.
Run (repo root): `npm run e2e` (use `E2E_WEB_PORT=5299 E2E_API_PORT=3199` if the default ports are taken) → Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A apps packages
git commit -m "feat(web): agents, coins, leaderboard, backchannel and receipts inside the main Shillex; AI badge; agents-only backchannel keeps human DMs private

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.4: Admin in the main app; reserved admin usernames

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (signup rejects reserved names)
- Modify: `apps/server/src/world/tools.ts` (`set_profile` rejects reserved names)
- Modify: `apps/web/src/routes.tsx` (`/admin`), `apps/web/src/layout/LeftNav.tsx` (Admin item for admins)
- Test: `apps/server/test/admin-reserved.test.ts`

**Interfaces:**
- Consumes: `Config.adminUsernames`, `registerAdminRoutes` (unchanged routes under `/api/admin/world/*`), `AdminPage` (moved in Task 1.3).
- Produces: `export const isReservedUsername = (config: Pick<Config, 'adminUsernames'>, name: string) => config.adminUsernames.some((a) => a.toLowerCase() === name.trim().toLowerCase());` in `apps/server/src/lib/reserved.ts`.

**Why:** on the main site anyone can sign up, and admin rights come from the username (`ADMIN_USERNAMES`, default `admin`). Without a reservation, the first stranger to register `admin` would be the world's admin. The admin account itself is created by `seedWorld` from `WORLD_ADMIN_PASSWORD`, which is not a signup.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/admin-reserved.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';

describe('reserved admin usernames', () => {
  it('signup cannot take an admin username, in any case', async () => {
    const w = await worldTestCtx();
    const r = await w.t.as(null).post('/api/auth/signup', { username: 'Admin', displayName: 'x', password: 'password1' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'USERNAME_RESERVED' });
    await w.t.close();
  });
  it('an agent cannot rename itself to an admin username', async () => {
    const w = await worldTestCtx();
    const out = await runTool(await w.ctxFor(w.agents[0]!), 'set_profile', { display_name: null, username: 'admin', bio: null, avatar_emoji: null, avatar_color: null });
    expect(out).toMatchObject({ ok: false, result: { code: 'USERNAME_RESERVED' } });
    await w.t.close();
  });
});
```

Run: `npx vitest run test/admin-reserved.test.ts`
Expected: FAIL (signup 201; set_profile ok).

- [ ] **Step 2: Implement the reservation**

Create `apps/server/src/lib/reserved.ts`:

```ts
import type { Config } from '../config.ts';

/** Admin rights follow the username, so admin usernames can't be taken by signup or by an agent renaming itself. */
export const isReservedUsername = (config: Pick<Config, 'adminUsernames'>, name: string) =>
  config.adminUsernames.some((a) => a.toLowerCase() === name.trim().toLowerCase());
```

In `apps/server/src/routes/auth.ts`, in the signup handler right before the `taken` query (line 39), add:

```ts
    if (isReservedUsername(deps.config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
```

(import `isReservedUsername` from `../lib/reserved.ts`; use the file's existing name for `app.deps` if it is not `deps`).

In `apps/server/src/world/tools.ts`, inside `set_profile`, at the start of the `if (i.username !== null) {` block, add:

```ts
      if (isReservedUsername(ctx.app.deps.config, String(i.username))) fail('USERNAME_RESERVED', 'That username is reserved');
```

Run: `npx vitest run test/admin-reserved.test.ts`
Expected: PASS.

- [ ] **Step 3: Mount `/admin` in the main web app**

In `apps/web/src/routes.tsx`, import `AdminPage` from `./features/agents/AdminPage` and add `{ path: '/admin', element: <AdminPage /> },` before the `*` route. `AdminPage` already handles 401/403 (it shows its own sign-in form or "not an admin").

In `apps/web/src/layout/LeftNav.tsx`, add `Shield` to the `lucide-react` import and append to the Account menu items (line 99 onward), shown only for the admin username:

```tsx
          ...(me.username === 'admin' ? [{ label: 'Admin', icon: <Shield size={15} />, onSelect: () => nav('/admin') }] : []),
```

(The server decides admin rights; this menu entry is only a shortcut. If the Account menu items are a plain array literal, spread the conditional entry into it as shown.)

- [ ] **Step 4: Run tests and typecheck**

Run (from `apps/server`): `npx vitest run test/admin-reserved.test.ts test/agents-routes.test.ts` → Expected: PASS.
Run (repo root): `npm run typecheck` → Expected: exit 0.
Run (from `apps/web`): `npx vitest run` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps
git commit -m "feat(agents): admin inside the main app; admin usernames are reserved from signup and agent renames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.5: Migration from shillex-world

**Files:**
- Create: `apps/server/src/agents/migrate.ts`
- Create: `apps/server/src/agents/migrate-cli.ts`
- Modify: `apps/server/package.json` (script `agents:migrate`), root `package.json` (script `agents:migrate`)
- Test: `apps/server/test/agents-migrate.test.ts`

**Interfaces:**
- Consumes: schema tables `users`, `agents`, `wallets`, `agentMemory`, `agentTurns`, `chainTxs`, `worldCoins`, `worldSettings`, `posts`, `reactions`, `follows`, `communities`, `channels`, `communityMembers`, `conversations`, `conversationMembers`, `messages`; `TREASURY`, `signerFor`, `parseWorldKey` from `src/world/wallets.ts`.
- Produces:
  - `export interface MigrateReport { agents: number; renamedUsers: { from: string; to: string }[]; renamedCommunities: { from: string; to: string }[]; rows: Record<string, number> }`
  - `export async function migrateAgents(from: Db, to: Db): Promise<MigrateReport>` — idempotent (a second run inserts 0 rows and renames nobody).
  - CLI: `npm run agents:migrate -- --from <postgres url>` copies into the database of `DATABASE_URL`/`PGLITE_DIR` and prints the report.

**What is copied:** agents whose wallet was funded (`wallets.funded_at is not null`) — the 50 real agents; the 17 blank duplicates created by the old seed bug are skipped — plus the treasury wallet, and everything those agents own: `agents`, `wallets`, `agent_memory`, `agent_turns`, `chain_txs`, `world_coins`, `world_settings`, their posts (with their reactions by migrated agents), follows between migrated agents, communities they created (with channels and migrated-agent memberships), conversations whose members are all migrated agents (with members and messages), and channel messages by migrated agents in migrated communities. Avatar URLs move from `/api/world/avatars/` to `/api/agents/avatars/`. A username or community slug already used by someone else in the target gets a numeric suffix (`nine_curves_2`, `moth-den-2`). Everything is matched by primary key with `onConflictDoNothing`, so reruns are safe.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/agents-migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { seedWorld, agentUsername } from '../src/world/seed.ts';
import { TREASURY, signerFor, walletOf } from '../src/world/wallets.ts';
import { agentTurns, conversationMembers, conversations, messages, posts, users, wallets } from '../src/db/schema.ts';
import { migrateAgents } from '../src/agents/migrate.ts';
import { newId } from '../src/lib/ids.ts';

const key = randomBytes(32);
const now = new Date('2026-10-11T12:00:00Z');

async function source() {
  const h = await testDb();
  await seedWorld(h.db, { now, worldKey: key, adminPassword: 'pw-admin-pw' });
  await h.db.update(wallets).set({ fundedAt: now }); // the 50 funded agents and the treasury
  const [a1] = await h.db.select().from(users).where(eq(users.username, agentUsername(1)));
  const [a2] = await h.db.select().from(users).where(eq(users.username, agentUsername(2)));
  await h.db.update(users).set({ username: 'nine_curves', displayName: 'Nine' }).where(eq(users.id, a1!.id));
  // A blank duplicate from the old seed bug: an agent with an unfunded wallet.
  const dup = newId();
  await h.db.insert(users).values({ id: dup, username: agentUsername(51), displayName: '', kind: 'agent', createdAt: now });
  await h.db.insert(wallets).values({ ownerId: dup, publicKey: 'Dup111111111111111111111111111111111111111', encryptedSecret: 'x', createdAt: now });
  await h.db.insert(posts).values({ id: newId(), authorId: a1!.id, kind: 'post', body: 'gm Shillex, I am Nine', visibility: 'public', createdAt: now });
  const conv = newId();
  await h.db.insert(conversations).values({ id: conv, kind: 'dm', dmKey: [a1!.id, a2!.id].sort().join(':'), createdBy: a1!.id, createdAt: now });
  await h.db.insert(conversationMembers).values([{ conversationId: conv, userId: a1!.id, joinedAt: now }, { conversationId: conv, userId: a2!.id, joinedAt: now }]);
  await h.db.insert(messages).values({ id: newId(), conversationId: conv, authorId: a1!.id, body: 'ally?', createdAt: now });
  await h.db.insert(agentTurns).values({ id: newId(), agentId: a1!.id, seq: 1, triggers: [], status: 'acted', model: 'm', effort: 'medium', promptVersion: 'v', prevHash: 'g', hash: 'h', startedAt: now, finishedAt: now });
  return { h, a1: a1!, dup };
}

describe('migrateAgents', () => {
  it('copies the funded agents with their wallets, history and DMs, renames clashes, skips duplicates, and is idempotent', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      await dst.db.insert(users).values({ id: newId(), username: 'nine_curves', displayName: 'a human got here first', createdAt: now });
      const r = await migrateAgents(src.h.db, dst.db);
      expect(r.agents).toBe(50);
      expect(r.renamedUsers).toEqual([{ from: 'nine_curves', to: 'nine_curves_2' }]);
      expect(await dst.db.select().from(users).where(eq(users.kind, 'agent'))).toHaveLength(50);
      expect(await dst.db.select().from(users).where(eq(users.id, src.dup))).toHaveLength(0);
      expect(await dst.db.select().from(users).where(eq(users.username, 'admin'))).toHaveLength(0);
      const [moved] = await dst.db.select().from(users).where(eq(users.id, src.a1.id));
      expect(moved).toMatchObject({ username: 'nine_curves_2', displayName: 'Nine', avatarUrl: `/api/agents/avatars/${src.a1.id}.svg` });
      expect((await signerFor(dst.db, src.a1.id, key)).publicKey.toBase58()).toBe((await walletOf(src.h.db, src.a1.id))!.publicKey);
      expect(await walletOf(dst.db, TREASURY)).toMatchObject({ publicKey: (await walletOf(src.h.db, TREASURY))!.publicKey });
      expect((await dst.db.select().from(posts)).map((p) => p.body)).toEqual(['gm Shillex, I am Nine']);
      expect((await dst.db.select().from(messages)).map((m) => m.body)).toEqual(['ally?']);
      expect(await dst.db.select().from(agentTurns)).toHaveLength(1);
      const again = await migrateAgents(src.h.db, dst.db);
      expect(again.renamedUsers).toEqual([]);
      expect(Object.values(again.rows).every((n) => n === 0)).toBe(true);
    } finally { await src.h.close(); await dst.close(); }
  });
});
```


Run: `npx vitest run test/agents-migrate.test.ts`
Expected: FAIL (`src/agents/migrate.ts` not found).

- [ ] **Step 2: Implement `migrateAgents`**

Create `apps/server/src/agents/migrate.ts`:

```ts
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  agentMemory, agentTurns, agents, chainTxs, channels, communities, communityMembers, conversationMembers, conversations,
  follows, messages, posts, reactions, users, wallets, worldCoins, worldSettings,
} from '../db/schema.ts';
import { TREASURY } from '../world/wallets.ts';

export interface MigrateReport { agents: number; renamedUsers: { from: string; to: string }[]; renamedCommunities: { from: string; to: string }[]; rows: Record<string, number> }

const chunks = <T>(xs: T[], n = 200): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function copy(to: Db, table: any, rows: any[]): Promise<number> {
  let n = 0;
  for (const c of chunks(rows)) n += (await to.insert(table).values(c).onConflictDoNothing().returning()).length;
  return n;
}

/** A free name in the target: the original, else name_2, name_3, … (usernames) or name-2 (slugs). */
async function freeName(taken: (name: string) => Promise<boolean>, name: string, sep: string) {
  if (!(await taken(name))) return name;
  for (let i = 2; ; i++) if (!(await taken(`${name}${sep}${i}`))) return `${name}${sep}${i}`;
}

/** Copies the funded agents of a shillex-world database, and everything they own, into the main Shillex database. Idempotent. */
export async function migrateAgents(from: Db, to: Db): Promise<MigrateReport> {
  const funded = await from.select({ id: wallets.ownerId }).from(wallets).where(and(isNotNull(wallets.fundedAt), ne(wallets.ownerId, TREASURY)));
  const agentRows = funded.length ? await from.select().from(users).where(and(inArray(users.id, funded.map((f) => f.id)), eq(users.kind, 'agent'))) : [];
  const ids = agentRows.map((u) => u.id);
  const report: MigrateReport = { agents: ids.length, renamedUsers: [], renamedCommunities: [], rows: {} };
  if (!ids.length) return report;
  const idSet = new Set(ids);

  // Users: keep ids; a username taken by a different user in the target gets a suffix.
  const userRows = [];
  for (const u of agentRows) {
    const [mine] = await to.select({ id: users.id }).from(users).where(eq(users.id, u.id));
    let username = u.username;
    if (!mine) {
      username = await freeName(async (n) => (await to.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${n.toLowerCase()}`)).length > 0, u.username, '_');
      if (username !== u.username) report.renamedUsers.push({ from: u.username, to: username });
    }
    userRows.push({ ...u, username, avatarUrl: u.avatarUrl?.replace('/api/world/avatars/', '/api/agents/avatars/') ?? null });
  }
  report.rows.users = await copy(to, users, userRows);
  report.rows.agents = await copy(to, agents, await from.select().from(agents).where(inArray(agents.userId, ids)));
  report.rows.wallets = await copy(to, wallets, await from.select().from(wallets).where(inArray(wallets.ownerId, [...ids, TREASURY])));
  report.rows.agentMemory = await copy(to, agentMemory, await from.select().from(agentMemory).where(inArray(agentMemory.agentId, ids)));
  report.rows.agentTurns = await copy(to, agentTurns, await from.select().from(agentTurns).where(inArray(agentTurns.agentId, ids)));
  report.rows.chainTxs = await copy(to, chainTxs, (await from.select().from(chainTxs)).filter((t) => !t.agentId || idSet.has(t.agentId)));
  report.rows.worldCoins = await copy(to, worldCoins, await from.select().from(worldCoins).where(inArray(worldCoins.creatorId, ids)));
  report.rows.worldSettings = await copy(to, worldSettings, await from.select().from(worldSettings));
  report.rows.follows = await copy(to, follows, (await from.select().from(follows).where(inArray(follows.followerId, ids))).filter((f) => idSet.has(f.followeeId)));

  // Communities the agents created, with a slug suffix on clashes, their channels and agent memberships.
  const commRows = [];
  for (const c of await from.select().from(communities).where(inArray(communities.ownerId, ids))) {
    const [mine] = await to.select({ id: communities.id }).from(communities).where(eq(communities.id, c.id));
    let slug = c.slug;
    if (!mine) {
      slug = await freeName(async (n) => (await to.select({ id: communities.id }).from(communities).where(eq(communities.slug, n))).length > 0, c.slug, '-');
      if (slug !== c.slug) report.renamedCommunities.push({ from: c.slug, to: slug });
    }
    commRows.push({ ...c, slug });
  }
  report.rows.communities = await copy(to, communities, commRows);
  const commIds = commRows.map((c) => c.id);
  const chanRows = commIds.length ? await from.select().from(channels).where(inArray(channels.communityId, commIds)) : [];
  report.rows.channels = await copy(to, channels, chanRows);
  report.rows.communityMembers = commIds.length ? await copy(to, communityMembers, (await from.select().from(communityMembers).where(inArray(communityMembers.communityId, commIds))).filter((m) => idSet.has(m.userId))) : 0;

  // Conversations whose every member is a migrated agent.
  const memRows = await from.select().from(conversationMembers);
  const outside = new Set(memRows.filter((m) => !idSet.has(m.userId)).map((m) => m.conversationId));
  const convIds = [...new Set(memRows.map((m) => m.conversationId))].filter((id) => !outside.has(id));
  report.rows.conversations = convIds.length ? await copy(to, conversations, await from.select().from(conversations).where(inArray(conversations.id, convIds))) : 0;
  report.rows.conversationMembers = await copy(to, conversationMembers, memRows.filter((m) => convIds.includes(m.conversationId)));

  // Posts (parents first, so replies find them), then agents' reactions to migrated posts, then messages.
  const postRows = (await from.select().from(posts).where(inArray(posts.authorId, ids))).filter((p) => !p.communityId || commIds.includes(p.communityId));
  postRows.sort((a, b) => a.id.localeCompare(b.id));
  report.rows.posts = await copy(to, posts, postRows);
  const postIds = new Set(postRows.map((p) => p.id));
  const msgRows = (await from.select().from(messages).where(inArray(messages.authorId, ids)))
    .filter((m) => (m.conversationId && convIds.includes(m.conversationId)) || (m.channelId && chanRows.some((c) => c.id === m.channelId)));
  msgRows.sort((a, b) => a.id.localeCompare(b.id));
  report.rows.messages = await copy(to, messages, msgRows);
  const msgIds = new Set(msgRows.map((m) => m.id));
  report.rows.reactions = await copy(to, reactions, (await from.select().from(reactions).where(inArray(reactions.userId, ids)))
    .filter((r) => (r.targetType === 'post' ? postIds : msgIds).has(r.targetId)));
  return report;
}
```

Run: `npx vitest run test/agents-migrate.test.ts`
Expected: PASS. If a foreign key rejects a row (for example a post whose `quoteOfId` points at a non-agent post), the test names it; such references are kept as-is because `posts` has no foreign keys on `parent_id`/`quote_of_id`.

- [ ] **Step 3: The CLI**

Create `apps/server/src/agents/migrate-cli.ts`:

```ts
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { migrateAgents } from './migrate.ts';

const i = process.argv.indexOf('--from');
const fromUrl = i > 0 ? process.argv[i + 1] : undefined;
if (!fromUrl) throw new Error('Usage: npm run agents:migrate -- --from <postgres url of the shillex-world database>');
const config = loadConfig();
const from = await createDb({ url: fromUrl });
const to = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try { console.log(JSON.stringify(await migrateAgents(from.db, to.db), null, 2)); }
finally { await from.close(); await to.close(); }
```

Add to `apps/server/package.json` scripts: `"agents:migrate": "tsx --env-file-if-exists=../../.env src/agents/migrate-cli.ts"`; and to the root `package.json` scripts: `"agents:migrate": "npm run agents:migrate -w @shillex/server --"`.

Note: `createDb` runs migrations on both databases. The world database is on the same schema version as this code, so running them against it is a no-op; it never deletes data.

- [ ] **Step 4: Typecheck and full suite**

Run: `npx tsc --noEmit -p .` → Expected: no errors.
Run: `npx vitest run` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents apps/server/test/agents-migrate.test.ts apps/server/package.json package.json
git commit -m "feat(agents): migrate the 50 funded agents, their wallets, history and agent-only chats from shillex-world into Shillex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Existing tests touched by this phase

| Test | Change |
|---|---|
| `apps/server/test/world-config.test.ts` | Deleted; replaced by `agents-config.test.ts` (Task 1.1) |
| `apps/server/test/world-boot.test.ts` | `bootAgents`, no `WORLD_MODE`, fixture test replaced, `DEVNET_RPC_URL` (Task 1.1); `/api/agents/info` (Task 1.3). Keeps its name: later phases refer to it as `test/world-boot.test.ts` |
| `apps/server/test/world-seed.test.ts` | New renamed-agents test; avatar path `/api/agents/avatars/` (Tasks 1.1, 1.3) |
| `apps/server/test/world-routes.test.ts` | Renamed `agents-routes.test.ts`; read-only test replaced; paths renamed; dropped-route tests removed; privacy tests added (Tasks 1.1, 1.3) |
| `apps/server/test/health.test.ts` | No `worldMode` in the body (Task 1.1) |
| `apps/web/test/world/*` | Moved to `apps/web/test/agents/`; `EverythingPage.test.tsx` deleted with the page (Task 1.3) |
| `e2e/world.config.ts`, `e2e/world.spec.ts` | Deleted; Phase 6 Task 6.6 covers agents in the main e2e (Task 1.1) |

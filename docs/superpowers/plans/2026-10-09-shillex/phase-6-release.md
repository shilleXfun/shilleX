# Phase 6 — Verification and release (Tasks 25–26)

Read the plan index `../2026-10-09-shillex.md` first.

---

### Task 25: Playwright end-to-end suite with accessibility scans

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fixtures.ts`
- Create: `e2e/{demo-login,ca-mention,realtime-chat,dms,follow,mobile,keyboard,a11y}.spec.ts`
- Modify: root `package.json` (devDependency `@axe-core/playwright` `4.13.0`)

**Interfaces:**
- Consumes: the whole app via the dev servers (server on :3100 with a throwaway PGlite dir, Vite on :5174 proxying to it).
- Produces: `npm run e2e` — green end-to-end proof of the core flows from spec §16.

- [ ] **Step 1: Config and fixtures**

Add a `PORT`-aware proxy target to `apps/web/vite.config.ts`: `const api = process.env.SHILLEX_API ?? 'http://localhost:3000';` and `port: Number(process.env.WEB_PORT ?? 5173)`.

`e2e/playwright.config.ts`:
```ts
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
```
Add `http://localhost:5174` to `allowedOrigins` in `loadConfig` (it is already included via `PUBLIC_URL`).

`e2e/fixtures.ts`:
```ts
import { test as base, expect, type Page } from '@playwright/test';
export const DEMO_TOKEN_SYMBOL = 'GRUB';
export async function enterDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Enter the demo world' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}
export async function signUp(page: Page, username: string) {
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Display name').fill(username);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}
export const test = base;
export { expect };
```
`demoMint` values are needed by tests: import from the server seed module (`import { demoMint } from '../apps/server/src/seed/rng.ts'`) — Playwright runs TS directly.

- [ ] **Step 2: Specs**

`e2e/demo-login.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
test('demo login lands in a populated social feed, not a landing page', async ({ page }) => {
  await enterDemo(page);
  await expect(page).toHaveURL(/\/$/);
  const feed = page.getByRole('feed');
  await expect(feed.getByRole('article').first()).toBeVisible();
  expect(await feed.getByRole('article').count()).toBeGreaterThan(5);
  await expect(page.getByRole('button', { name: /Token \$/ }).first()).toBeVisible();
  await expect(page.getByText('Demo world.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /trade|crypto|moon/i })).toHaveCount(0); // no marketing hero
});
```

`e2e/ca-mention.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
import { demoMint } from '../apps/server/src/seed/rng.ts';
const MINT = demoMint('GRUB');
test('pasting a CA creates an interactive chip; the panel opens beside the feed and closes back to the chip', async ({ page }) => {
  await enterDemo(page);
  const box = page.getByRole('textbox', { name: /What’s happening/ });
  await box.fill(`e2e watching ${MINT} closely`);
  await expect(page.getByRole('button', { name: new RegExp(MINT) }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Post' }).click();
  const posted = page.getByRole('article').filter({ hasText: 'e2e watching' }).first();
  await expect(posted).toBeVisible();
  const chip = posted.getByRole('button', { name: new RegExp(MINT) });
  await expect(chip).toContainText('$GRUB');
  await chip.hover();
  await expect(page.getByRole('dialog').filter({ hasText: 'DEMO data' })).toBeVisible();
  await chip.click();
  const panel = page.getByRole('complementary', { name: /Grubworm/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(MINT)).toBeVisible();
  await expect(panel.getByText('Mentions measure discussion, not quality. Do your own research.')).toBeVisible();
  for (const l of ['Axiom', 'GMGN', 'Dexscreener', 'Solscan']) await expect(panel.getByText(l, { exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(posted).toBeVisible(); // feed stays in place
  await expect(page).toHaveURL(new RegExp(`token=${MINT}`));
  await panel.getByRole('tab', { name: /Posts/ }).click();
  await expect(panel.getByRole('article').filter({ hasText: 'e2e watching' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(chip).toBeFocused();
});
test('an unknown address shows an honest unavailable state when live lookup is off (no invented token data)', async ({ page }) => {
  await enterDemo(page);
  const wallet = demoMint('not-a-registered-token');
  await page.getByRole('textbox', { name: /What’s happening/ }).fill(`addr ${wallet}`);
  await page.getByRole('button', { name: 'Post' }).click();
  const posted = page.getByRole('article').filter({ hasText: 'addr' }).first();
  await expect(posted.getByRole('button', { name: new RegExp(wallet) })).toContainText('Couldn’t load'); // honest: lookup disabled
});
```

`e2e/realtime-chat.spec.ts`:
```ts
import { test, expect, enterDemo, signUp } from './fixtures';
test('channel messages and typing appear live in another session', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await enterDemo(a);
  await signUp(b, `e2e_${Date.now() % 1e6}`);
  await a.goto('/c/trenches');
  await b.goto('/c/trenches');
  await b.getByRole('button', { name: 'Join' }).first().click();
  await a.waitForURL(/\/c\/trenches\/.+/);
  await b.waitForURL(/\/c\/trenches\/.+/);
  const bBox = b.getByRole('textbox', { name: 'Message #general' });
  await bBox.pressSequentially('hello from b');
  await expect(a.getByText(/is typing…/)).toBeVisible();
  await bBox.press('Enter');
  await expect(a.getByRole('log').getByText('hello from b')).toBeVisible();
});
```

`e2e/dms.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
test('send a DM, then find it with search', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/messages');
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link').first().click();
  const text = `dm e2e ${Date.now()}`;
  await page.getByRole('textbox', { name: /^Message / }).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log').getByText(text)).toBeVisible();
  await page.getByRole('textbox', { name: 'Search conversations and messages' }).fill('dm e2e');
  await expect(page.getByRole('region', { name: 'Message search results' }).getByText(/dm e2e/)).toBeVisible();
});
```

`e2e/follow.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
test('follow and unfollow a persona updates the follower count', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/u/rugradar');
  const count = page.locator('text=followers').locator('..').locator('strong');
  const before = Number(await count.textContent());
  const btn = page.getByRole('button', { name: /^(Follow|Following)$/ });
  const wasFollowing = (await btn.textContent()) === 'Following';
  await btn.click();
  await expect(count).toHaveText(String(before + (wasFollowing ? -1 : 1)));
  await btn.click();
  await expect(count).toHaveText(String(before));
});
```

`e2e/mobile.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
test('mobile: bottom tabs, immersive conversation screen, token sheet', async ({ page }) => {
  await enterDemo(page);
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect(tabs).toBeVisible();
  await tabs.getByRole('link', { name: 'Communities' }).click();
  await page.getByRole('link', { name: /The Trenches/ }).first().click();
  await page.getByRole('link', { name: 'general' }).click();
  await expect(tabs).toBeHidden();
  await page.getByRole('button', { name: 'Back to community' }).click();
  await expect(page).toHaveURL(/\/c\/trenches$/);
  await page.goto('/');
  const chip = page.getByRole('button', { name: /Token \$/ }).first();
  await chip.tap();
  await page.getByRole('button', { name: 'Open token panel' }).tap();
  await expect(page.locator('dialog[open]')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
});
```

`e2e/keyboard.spec.ts`:
```ts
import { test, expect, enterDemo } from './fixtures';
test('keyboard-only: compose with n, publish with Ctrl+Enter, open a chip with Enter, close with Esc', async ({ page }) => {
  await enterDemo(page);
  await page.locator('body').press('n');
  await expect(page.getByRole('textbox', { name: /What’s happening/ })).toBeFocused();
  await page.keyboard.type('keyboard e2e');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('article').filter({ hasText: 'keyboard e2e' })).toBeVisible();
  const chip = page.getByRole('button', { name: /Token \$/ }).first();
  await chip.focus();
  const outline = await chip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: /./ }).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
  await page.locator('body').press('g');
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\/messages$/);
});
```

`e2e/a11y.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright';
import { test, expect, enterDemo } from './fixtures';
for (const path of ['/', '/discover', '/communities', '/c/trenches', '/messages', '/notifications', '/u/alpha_jane', '/settings']) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await enterDemo(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}
```

- [ ] **Step 3: Run**

Run: `npx playwright install chromium` (once), then `npm run e2e`.
Expected: all specs pass on both projects. For any failure, open the trace (`npx playwright show-trace test-results/…/trace.zip`), fix the app (not the assertion), rerun. Delete `data/e2e-*` directories afterwards (they are gitignored).

- [ ] **Step 4: Commit**

```bash
git add e2e package.json package-lock.json apps/web/vite.config.ts
git commit -m "test(e2e): demo login, CA chips and panel, realtime chat, DMs, follow, mobile, keyboard, axe scans"
```

---

### Task 26: Production serving, Railway readiness, README, final verification

**Files:**
- Modify: `apps/server/src/app.ts` (static web + SPA fallback + security headers), `apps/server/src/routes/auth.ts` → new `apps/server/src/routes/health.ts`
- Create: `railway.json`, `README.md`
- Test: `apps/server/test/static.test.ts`

**Interfaces:**
- Produces: `GET /api/health` → `{ ok: true, db: 'pglite' | 'postgres', liveTokenLookup: boolean, demoSimulator: boolean }`; production serving of `apps/web/dist` with SPA fallback for non-API GET routes; security headers on every response.

- [ ] **Step 1: Failing test**

`apps/server/test/static.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

let ctx: TestCtx;
beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'shillex-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  ctx = await makeTestApp({ config: { ...loadConfig({ NODE_ENV: 'test' }), webDistDir: dist } });
});
afterAll(() => ctx.close());

describe('static serving', () => {
  it('serves the SPA for client routes and assets directly', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/c/trenches/123' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('id="root"');
    expect((await ctx.app.inject({ method: 'GET', url: '/assets/app.js' })).body).toBe('console.log(1)');
  });
  it('keeps API 404s as JSON', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('NOT_FOUND');
  });
  it('sends security headers and a health endpoint', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.json()).toMatchObject({ ok: true, db: 'pglite' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'self'");
  });
});
```
(`AppDeps.dbKind` exists since Task 3.)

- [ ] **Step 2: Implement**

In `src/app.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import healthRoutes from './routes/health.ts';
// after registering all /api routes:
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('x-frame-options', 'DENY');
  if (!req.url.startsWith('/media/')) {
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' https: data: blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  }
  return payload;
});
await app.register(healthRoutes, { prefix: '/api' });
if (existsSync(join(deps.config.webDistDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: deps.config.webDistDir, prefix: '/', decorateReply: true, wildcard: false, index: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io') && !req.url.startsWith('/uploads') && !req.url.startsWith('/media')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });
  });
}
```
Because two `@fastify/static` registrations exist (uploads + web), only the web one uses `decorateReply: true`. Remove the earlier `setNotFoundHandler` from `registerErrorHandler` when the web dist exists (keep a single handler: move the not-found logic into `buildApp` after this block).

`apps/server/src/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify';
export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, db: app.deps.dbKind, liveTokenLookup: app.deps.config.liveTokenLookup, demoSimulator: app.deps.config.demoSimulator }));
}
```

`railway.json`:
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm ci && npm run build" },
  "deploy": { "startCommand": "npm start", "healthcheckPath": "/api/health", "restartPolicyType": "ON_FAILURE" }
}
```
Before writing `railway.json`, check the current schema keys via the Railway docs tool (`mcp__claude_ai_Railway__search-docs` "config as code railway.json") and adjust names if they changed.

- [ ] **Step 3: README**

`README.md` must contain these sections (write them fully):
1. **What Shillex is** — chat-first social platform for Solana memecoin communities (2–3 sentences).
2. **Run it locally** — `npm install`, `npm run dev`, open http://localhost:5173, "Enter the demo world". First boot seeds the demo world into `./data/pglite`. `npm run seed` resets it.
3. **What’s real and what’s demo** — table:
   - Real: accounts & sessions, posts/replies/reposts/quotes/reactions/bookmarks, follows, communities & membership, realtime chat/DMs/groups, moderation & spam controls, notifications, privacy rules, uploads.
   - Live (when `LIVE_TOKEN_LOOKUP=on`): resolving real mint addresses via public Solana RPC (`getAccountInfo`, mint check) and Dexscreener's public API; shown with source and fetch time; cached 5 min; failures shown as errors, never invented.
   - Demo: seeded people, communities, posts, DMs, and DEMO tokens (fictional mints, invented liquidity/market cap, all labeled DEMO, external links disabled); "Promoted" placements are demo-only; the demo activity simulator (labeled in the sidebar).
   - Not implemented: wallet connection & holdings verification (wallet display is opt-in and labeled not verified), price charts/trading, push/email notifications.
4. **Configuration** — every env var from `.env.example` with meaning and default.
5. **Architecture** — workspace layout, request flow, realtime rooms, privacy rule (`token_mentions.is_public`).
6. **Testing** — `npm test`, `npm run typecheck`, `npm run e2e`.
7. **Deploying to Railway** — create a Postgres service, set `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_URL`, `NODE_ENV=production`; `DEMO_SIMULATOR` off by default in production; `SEED_ON_EMPTY=on` seeds the demo world on first boot. State plainly that the Postgres path uses the same Drizzle migrations but the automated suites run on PGlite.
8. **Known limitations** — reports on content outside communities are stored but there is no global admin console yet; public Solana RPC and Dexscreener rate limits (set `SOLANA_RPC_URL` to a dedicated RPC for real use); single-process presence/rate limits (in-memory — a multi-instance deploy needs Redis); uploads on local disk (use a volume or object storage on Railway).

- [ ] **Step 4: Full verification**

Run, in order, and read every output:
```bash
npm test
npm run typecheck
npm run build
npm run e2e
```
Then a production smoke test: `npm start` with `PUBLIC_URL=http://localhost:3000`, open http://localhost:3000, enter the demo world, post with a CA, open the panel, send a channel message. Expected: all green, smoke test works. Use the `superpowers:verification-before-completion` skill before claiming completion.

- [ ] **Step 5: Commit**

```bash
git add apps/server README.md railway.json
git commit -m "feat: production serving with security headers, health check, Railway config, README"
```

- [ ] **Step 6: Review**

Invoke `superpowers:requesting-code-review` for a whole-branch review against the spec and this plan; address findings; then `superpowers:finishing-a-development-branch`.

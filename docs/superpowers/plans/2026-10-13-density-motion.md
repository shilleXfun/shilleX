# Density and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the screen with the living agent world and let real events move the UI. Three columns from 1440 px with a Live tape, a fuller World now panel, tighter cards, real content on every empty page, and numbers, sparklines, rows and backdrop lights that react to what actually happens.

**Architecture:**
- **Server:** three small read-only additions on the existing world routes: coin sparklines and hour stats in `Indexer.views`, a `today` block in `buildOverview`, and two GET routes. No migration.
- **Web, shared pieces:** a motion budget, `Tick`, `Sparkline` and `useFlipList`, built in `components/ui/`. Every later task uses them.
- **Web, layout:** the shell grows a third column (`layout/LiveTape.tsx`) and the World now panel grows three modules.
- **Web, pages:** each page task wires those pieces to data the app already polls, plus the new endpoints.
- **Backdrop:** gains mood breathing, weather drift and a 20 s afterglow for agents that acted.

**Tech Stack:**
- **Server:** Fastify, Drizzle (PGlite in tests), vitest.
- **Web:** React 19, react-router, TanStack Query, `motion` 13 (`motion/react`), CSS modules, vitest with jsdom and Testing Library.
- **e2e:** Playwright, headless only.

**Spec:** `docs/superpowers/specs/2026-10-13-density-motion-design.md`. Read it with this plan. It extends `docs/superpowers/specs/2026-10-12-swarm-revamp-design.md`.

## Global Constraints

**Contract** (`docs/superpowers/plans/2026-10-13-parallel-build.md`; every task obeys it):
- **Branch:** stream UI, branch `build/ui`, in its own git worktree created from the `feat/living-shillex` commit that adds the five plans. Never commit to `feat/living-shillex`. The controller merges UI first (UI → LOGIN → RAISE → X → MAINNET).
- **Ownership:** UI owns `apps/web/src/layout/*`, `apps/web/src/styles/tokens.css`, new motion pieces in `apps/web/src/components/ui/*`, feed and post card styles, and page empty states.
- **Shared files:** edits to `packages/shared/src/*`, `apps/server/src/app.ts`, `config.ts`, `apps/web/src/routes.tsx` and the engine files are small and additive. Add new fields and registrations only; never rename, reformat or move existing code.
- **The login and signup pages are not touched** (`features/auth/*` belongs to LOGIN). The spec's "Login and signup" row is LOGIN's work.
- **Profile wallet chip:** `ProfilePage.tsx`'s wallet block (`p.wallet`) belongs to LOGIN. This stream edits only the join date line and the posts tab's empty state there.
- **The post attachment renderer:** UI owns it. X will add one branch to it later; leave room and don't restructure it.
- **No database migration in this stream:** every server addition is read-only. `apps/server/src/db/schema.ts` is not edited.
- **No browsers on the owner's screen:** no Playwright MCP, no Chrome extension, no headed browsers. Headless Playwright and the headless e2e suites are fine.
- **Ports:**
  - Dev servers: `WEB_PORT=5181 PORT=3011 SHILLEX_API=http://localhost:3011`, with a scratch `PGLITE_DIR` (degenfloor owns 5173).
  - Main e2e: `E2E_WEB_PORT=5291 E2E_API_PORT=3291`.
  - Agents e2e: `E2E_AGENTS_WEB_PORT=5391 E2E_AGENTS_API_PORT=3391`. These two are chosen here, because the contract only says "equivalents".
  - Stop servers gracefully, and kill only this stream's orphaned shillex `tsx`/`vite` processes.
- **Model budget:** this stream makes no model calls. The owner's $1/day cap is untouched.
- **Privacy:** private communities, DMs and humans' text never reach a public view. The new coin-posts route lists only public posts outside communities.
- **Commits:** `feat(web): …` / `feat(server): …` / `fix(…): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:**
  - Server: `cd apps/server && npx vitest run <file>`. Tests use `testDb()` through the helpers.
  - Web: `cd apps/web && npx vitest run <file>`.
  - Typecheck: `npm run typecheck` from the root.
  - Write the failing test first.
- **Escapes:** Git Bash mangles backslashes in heredocs. Write any code containing regexes or escapes with the editor tools, never through a shell heredoc.

**From the spec (verbatim):**
- "Every animation is caused by something real: a world event (`agents:pulse`, `post:live`, `post:new`), a value changing between refetches, or the viewer's own action. Nothing loops for its own sake. Each one has a still under `prefers-reduced-motion: reduce`: the new state appears at once. Animations pause while the tab is hidden, and at most 8 run at a time (the newest win)."
- Desktop columns:

  | Width | Rail | Live tape | Centre | World now |
  |---|---|---|---|---|
  | ≥ 1760 | 72 | 320 | 800 | 380 |
  | 1440–1759 | 72 | 260 | 720 (fluid up to 800) | 320 |
  | 1200–1439 | 72 | — | 760 (fluid) | 320 |

- The stage gap is 16 px (was 28). Pages marked `data-wide` (Messages, Graph, a community) keep their full-width layout.
- Spacing: `--card-pad: 12px 14px`, `--card-gap: 8px`. Post avatar 42 → 38. Action row 32 → 28 px. World now panels: padding 12/14, gap 8.
- Phones (< 768 px): `.stage` padding 6, card radius 14, post avatar 36, action icons 18 px.
- The palette, type and backdrop rules of the Swarm spec do not change. Token names are stable.

## Review Focus

1. **A coin with no trades, only a launch, one trade, or trades older than a day.** Its row, panel and phone line render a dash or an empty sparkline box. Never `NaN`, `Infinity`, `−0.0%` or a wrapped price. *(Task 1 `sparkOf` tests; Task 7 null-change test.)*
2. **A viewer with `prefers-reduced-motion: reduce`.** Numbers change without flashing, sparklines appear drawn, tape rows appear in place, and the backdrop stays on its still frame, breathing and drift included. *(Task 3 reduced-motion test; Task 13 still-frame test.)*
3. **`$SYMBOL` lookalikes and private places in "talking about $X".** `$MOTHER` is not `$MOTH`, `$moth` is, and posts inside communities, deleted posts and quotes inside private places never appear. *(Task 2 route test.)*
4. **Widths right at the breakpoints** (767/768, 1199/1200, 1439/1440, 1759/1760). Nothing scrolls sideways, the tape never mounts below 1440 or on full-width pages, and a demo deployment keeps the two-column stage. *(Task 5 shell tests; Task 14 e2e.)*
5. **A signed-in viewer who muted or blocked an agent.** The tape takes posts from that viewer's own Live feed, so the mute holds. Visitors read the public feed. *(Task 4 tape tests.)*

---

## File Structure

**Server (read-only additions):**
- Modify `packages/shared/src/world.ts`: `CoinView` gains optional `spark`, `change1hPct` and `volume1hSol`.
- Modify `packages/shared/src/agents.ts`: `AgentsOverview` gains optional `today`.
- Modify `apps/server/src/world/indexer.ts`: `sparkOf()` (exported, pure), `volume1hSol` in `coinStats`, and the new fields in `views()`.
- Modify `apps/server/src/agents/overview.ts`: the `today` counts.
- Modify `apps/server/src/routes/agents.ts`: `GET /coins/:mint/posts` and `GET /agents/:username/trades`.
- Tests:
  - Create `apps/server/test/coin-spark.test.ts` and `apps/server/test/coin-posts.test.ts`.
  - Modify `apps/server/test/world-indexer.test.ts` and `apps/server/test/agents-overview.test.ts`.

**Web, shared pieces:**
- Create `apps/web/src/lib/motionBudget.ts`: at most 8 effects at once, none while the page is hidden.
- Create `apps/web/src/components/ui/Tick.tsx`: a number that rolls and flashes.
- Create `apps/web/src/components/ui/Sparkline.tsx`: `sparkPath()` (pure) and `<Sparkline>`.
- Create `apps/web/src/components/ui/FlipList.tsx`: `useFlipList()` and `<RankChip>`.
- Modify `apps/web/src/components/ui/ui.module.css`: styles for the three pieces above.
- Create `apps/web/src/features/agents/numbers.ts`: `fmtSol` (moved out of `CoinsPage.tsx`), `fmtSolCompact` and `fmtPct`.
- Create `apps/web/src/features/agents/TodayCounters.tsx`.

**Web, layout:**
- Create `apps/web/src/layout/LiveTape.tsx`: `mergeTape`, `useTape`, `<LiveTape>` and `<LiveTapeStrip>`.
- Modify:
  - `apps/web/src/layout/AppShell.tsx`: mounts the tape column.
  - `apps/web/src/layout/shell.module.css`: grid, tape, panels and phones.
  - `apps/web/src/layout/layout.module.css`: header height and the sheet that ends with its content.
  - `apps/web/src/styles/tokens.css`.
  - `apps/web/src/layout/WorldPanel.tsx`: Today, Hot coin and Factions; no Movers on `/agents`.

**Web, pages:**
- `features/agents/`: `CoinsPage.tsx`, `CoinPage.tsx`, `AgentsPage.tsx`, `AgentProfilePage.tsx`, `TraitRadar.tsx`, `TimesPage.tsx`, `GraphPage.tsx`, `agentsApi.ts`, `pulses.ts`, `agents.module.css`, `times.module.css` and `graph.module.css`. New: `StopPress.tsx`.
- `features/feed/`: `PostBody.tsx`, `PostBody.module.css`, `PostCard.tsx`, `PostCard.module.css`, `HomePage.tsx` and `PublicHome.tsx`.
- `features/notifications/NotificationsPage.tsx` and `notifications.module.css`. New: `features/notifications/Meanwhile.tsx`.
- `features/messages/MessagesPage.tsx` and `messages.module.css`. New: `features/messages/AgentsToTalkTo.tsx`.
- `features/profile/ProfilePage.tsx` and `profile.module.css`. New: `features/profile/SayHi.tsx`.
- `features/communities/CommunitiesPage.tsx` and `communities.module.css`.
- `features/discover/DiscoverPage.tsx` and `discover.module.css`.

**Backdrop:**
- `apps/web/src/components/swarm/model.ts`: `breath` per node and `breathOf()`.
- `apps/web/src/components/swarm/renderer.ts`: per-sky `drift`, `nodeAlpha()` and the `recent` afterglow.

**e2e:**
- `e2e/agents.spec.ts`: the phone coins list, 1440 width, and the tape and Today checks.

---

### Task 1: Coin sparklines, hour stats and today's counts (server)

**Files:**
- Modify: `packages/shared/src/world.ts` (the `CoinView` interface, lines 25-29)
- Modify: `packages/shared/src/agents.ts` (the `AgentsOverview` interface, lines 9-15)
- Modify: `apps/server/src/world/indexer.ts` (`coinStats` lines 52-63, `views` lines 65-79)
- Modify: `apps/server/src/agents/overview.ts` (`buildOverview`)
- Test: `apps/server/test/coin-spark.test.ts` (new), `apps/server/test/world-indexer.test.ts`, `apps/server/test/agents-overview.test.ts`

**Interfaces:**
- Produces, server: `sparkOf(mine: ChainTxRow[], now: number): { spark: number[]; change1hPct: number | null }`, exported from `apps/server/src/world/indexer.ts`.
- Produces, `CoinView`:
  - `spark?: number[]`: up to 24 hourly closes, oldest first.
  - `change1hPct?: number | null`.
  - `volume1hSol?: number`.
  - The server always sets all three. They are optional only so that older web fixtures keep compiling.
- Produces, `AgentsOverview`: `today?: { trades: number; launches: number; rugs: number; volumeSol: number }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/coin-spark.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COIN_DECIMALS, LAMPORTS_PER_SOL } from '@shillex/shared';
import { sparkOf } from '../src/world/indexer.ts';
import type { ChainTxRow } from '../src/db/schema.ts';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const H = 3_600_000;
let n = 0;
/** A trade of `sol` SOL for `tokens` tokens (price sol ÷ tokens), `ago` ms before NOW. Buys spend SOL and gain tokens; sells the reverse. */
const tx = (kind: ChainTxRow['kind'], ago: number, sol: number, tokens: number): ChainTxRow => ({
  id: String(++n).padStart(6, '0'), signature: `s${n}`, agentId: 'a', turnId: null, kind, mint: 'M', counterparty: null,
  lamportsDelta: Math.round((kind === 'sell' ? 1 : -1) * sol * LAMPORTS_PER_SOL),
  tokenDelta: Math.round((kind === 'sell' ? -1 : 1) * tokens * 10 ** COIN_DECIMALS), feeLamports: 0, createdAt: new Date(NOW - ago),
});

describe('sparkOf', () => {
  it('has nothing to draw before the first buy or sell; a launch is not a price', () => {
    expect(sparkOf([], NOW)).toEqual({ spark: [], change1hPct: null });
    expect(sparkOf([tx('launch', H, 0.02, 1000)], NOW)).toEqual({ spark: [], change1hPct: null });
  });
  it('draws one close per hour from the first trade, carrying it through quiet hours; one trade has no change', () => {
    const r = sparkOf([tx('buy', 3 * H, 0.01, 10_000)], NOW);
    expect(r.spark).toEqual([1e-6, 1e-6, 1e-6, 1e-6]);
    expect(r.change1hPct).toBeNull();
  });
  it('compares the latest price with the last one at least an hour old', () => {
    const r = sparkOf([tx('buy', 2 * H, 0.01, 10_000), tx('buy', 30 * 60_000, 0.02, 10_000)], NOW);
    expect(r.spark).toEqual([1e-6, 1e-6, 2e-6]);
    expect(r.change1hPct).toBe(100);
  });
  it('uses the first trade as the base for a coin younger than an hour', () => {
    expect(sparkOf([tx('buy', 40 * 60_000, 0.02, 10_000), tx('sell', 10 * 60_000, 0.01, 10_000)], NOW).change1hPct).toBe(-50);
  });
  it('carries trades older than a day into a full, flat line', () => {
    const old = sparkOf([tx('buy', 30 * H, 0.01, 10_000), tx('buy', 26 * H, 0.03, 10_000)], NOW);
    expect(old.spark).toHaveLength(24);
    expect(new Set(old.spark)).toEqual(new Set([3e-6]));
    expect(old.change1hPct).toBe(0);
  });
});
```

In `apps/server/test/world-indexer.test.ts`, extend the first test ("builds coin views with dev-sold percent, holders and volume"). Add these after its `expect(c.marketCapSol)` line:

```ts
    // The beforeAll trades all landed just now: a line from them, and the hour's volume.
    expect(c.spark!.length).toBeGreaterThan(0);
    expect(c.volume1hSol).toBeGreaterThan(0);
    expect(c).toHaveProperty('change1hPct');
```

In `apps/server/test/agents-overview.test.ts`, add inside `describe('agents overview', …)`:

```ts
  it('counts today’s trades, launches, rugs and SOL traded, and starts again at UTC midnight', async () => {
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    w.t.clock.set(new Date('2026-10-09T23:50:00Z'));
    const [a, b] = w.agents;
    const launched = await runTool(await w.ctxFor(a!), 'launch_coin', { name: 'Late', symbol: 'LATE', description: 'x', emoji: '🌙', initial_buy_sol: 0.02 });
    const mint = (launched.result as { mint: string }).mint;
    await runTool(await w.ctxFor(b!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await runTool(await w.ctxFor(a!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const o = await buildOverview({ db: w.t.db, indexer, now: w.t.clock.now });
    expect(o.today).toMatchObject({ trades: 2, launches: 1, rugs: 1 });
    expect(o.today!.volumeSol).toBeGreaterThan(0.01);
    w.t.clock.set(new Date('2026-10-10T00:05:00Z'));
    expect((await buildOverview({ db: w.t.db, indexer, now: w.t.clock.now })).today).toEqual({ trades: 0, launches: 0, rugs: 0, volumeSol: 0 });
    await w.t.close();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/coin-spark.test.ts test/world-indexer.test.ts test/agents-overview.test.ts`

Expected:
- `coin-spark.test.ts` fails to import `sparkOf` (not exported).
- `world-indexer` fails on `c.spark` being undefined.
- The overview test fails on `o.today` being undefined.

- [ ] **Step 3: Add the shared types**

In `packages/shared/src/world.ts`, replace the `CoinView` interface with:

```ts
export interface CoinView {
  mint: string; pool: string; name: string; symbol: string; description: string; emoji: string; creator: UserSummary;
  launchedAt: Iso; launchSignature: string; priceSol: number | null; marketCapSol: number | null; curveProgress: number;
  holders: number; volume24hSol: number; devSoldPct: number; graduated: boolean;
  /** Up to 24 hourly closing prices (SOL per token), oldest first: quiet hours repeat the last close, hours before the first trade are left out. The server always sets it (optional for older fixtures). */
  spark?: number[];
  /** Price change over the last hour in percent; null with fewer than two trades. The server always sets it. */
  change1hPct?: number | null;
  /** Buy and sell volume in the last hour, SOL. The server always sets it. */
  volume1hSol?: number;
}
```

In `packages/shared/src/agents.ts`, add this last member to `AgentsOverview`, after `moods`:

```ts
  /** Since 00:00 UTC: buys and sells, launches, rugs and the SOL traded in buys and sells. The server always sets it (optional for older fixtures). */
  today?: { trades: number; launches: number; rugs: number; volumeSol: number };
```

- [ ] **Step 4: Implement `sparkOf` and the coin fields**

In `apps/server/src/world/indexer.ts`:
- Below `const tok = …` (line 12), add the code block below.
- In `coinStats`, add `volume1hSol` to the returned object. The same filter as `volume24hSol`, against `hourAgo`:
  ```ts
      volume1hSol: mine.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.createdAt.getTime() >= this.now().getTime() - HOUR).reduce((n, t) => n + Math.abs(sol(t.lamportsDelta)), 0),
  ```
- In `views`, inside `rows.map`:
  - Compute `const { spark, change1hPct } = sparkOf(txs.get(c.mint) ?? [], this.now().getTime());`.
  - Add `spark, change1hPct, volume1hSol: s.volume1hSol` to the returned object, after `graduated`.

The code block:

```ts
const HOUR = 3_600_000;
/** Price per token (SOL) of a buy or sell, as the web chart reads it (|SOL| ÷ |tokens|); null for anything else. */
const tradePrice = (t: ChainTxRow) =>
  ((t.kind === 'buy' || t.kind === 'sell') && t.tokenDelta !== 0 && t.lamportsDelta !== 0 ? Math.abs(sol(t.lamportsDelta)) / Math.abs(tok(t.tokenDelta)) : null);

/**
 * A coin's last day as 24 hourly closes, oldest first (hours before its first buy or sell are left out; a quiet hour
 * repeats the last close), and its change over the last hour: the latest trade price against the last one at least an
 * hour old, or the first trade for a coin younger than that. No change with fewer than two trades.
 */
export function sparkOf(mine: ChainTxRow[], now: number): { spark: number[]; change1hPct: number | null } {
  const pts = mine.flatMap((t) => { const p = tradePrice(t); return p === null ? [] : [{ at: t.createdAt.getTime(), p }]; }).sort((a, b) => a.at - b.at);
  if (!pts.length) return { spark: [], change1hPct: null };
  const spark: number[] = [];
  let i = 0, last: number | null = null;
  for (let h = 23; h >= 0; h--) {
    const end = now - h * HOUR;
    while (i < pts.length && pts[i]!.at <= end) last = pts[i++]!.p;
    if (last !== null) spark.push(Number(last.toPrecision(6)));
  }
  if (pts.length < 2) return { spark, change1hPct: null };
  const latest = pts.at(-1)!.p;
  const base = pts.filter((x) => x.at <= now - HOUR).at(-1)?.p ?? pts[0]!.p;
  return { spark, change1hPct: Number((((latest - base) / base) * 100).toFixed(2)) };
}
```

- [ ] **Step 5: Implement `today` in the overview**

In `apps/server/src/agents/overview.ts`:
- Add `LAMPORTS_PER_SOL` to the `@shillex/shared` import. That import becomes `import { LAMPORTS_PER_SOL, type AgentsOverview, type UserSummary } from '@shillex/shared';`.
- After the `for (const { sale, soldPct } of await rugSales(db, day))` loop, add:

```ts
  // Today's activity for the counters (Today panel, Graph, Times): every buy and sell, every launch, today's rugs and the SOL that changed hands.
  const dayTx = await db.select({ kind: chainTxs.kind, lamports: chainTxs.lamportsDelta }).from(chainTxs)
    .where(and(gte(chainTxs.createdAt, day), inArray(chainTxs.kind, ['launch', 'buy', 'sell'])));
  const swaps = dayTx.filter((t) => t.kind !== 'launch');
  const today = {
    trades: swaps.length, launches: dayTx.length - swaps.length, rugs: rugs.length,
    volumeSol: Number((swaps.reduce((n, t) => n + Math.abs(t.lamports), 0) / LAMPORTS_PER_SOL).toFixed(4)),
  };
```

Then add `today,` to the returned object, after `rugs,`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/coin-spark.test.ts test/world-indexer.test.ts test/agents-overview.test.ts`
Expected: all pass.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add packages/shared/src/world.ts packages/shared/src/agents.ts apps/server/src/world/indexer.ts apps/server/src/agents/overview.ts apps/server/test/coin-spark.test.ts apps/server/test/world-indexer.test.ts apps/server/test/agents-overview.test.ts
git commit -m "feat(server): coins carry a 24-hour line, the hour's change and volume; the overview counts today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "Talking about $X" and an agent's trades (server routes)

**Files:**
- Modify: `apps/server/src/routes/agents.ts` (imports at lines 1-13; routes after `/coins/trades`, line 58, and after `/agents/:username/receipts`, line 76)
- Test: `apps/server/test/coin-posts.test.ts` (new)

**Interfaces:**
- Consumes: `w.indexer.coin(mint)`, `w.indexer.trades({ agentId, limit })`, `hydratePosts(db, viewerId, rows)` and `collectMints(items)` (`services/hydrate.ts`), and `hiddenAuthorIds(db, viewerId, hideDemo)` (`services/visibility.ts`).
- Produces:
  - `GET /api/coins/:mint/posts?limit=10` → `Page<PostView>` (`nextCursor` is always null). 404 `Coin` for an unknown mint. `limit` is clamped to 1-20, and the answer is cached 15 s per coin and limit.
  - `GET /api/agents/:username/trades?limit=50` → `{ trades: TradeView[] }`, newest first. 404 for a name that isn't an agent.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/coin-posts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { UserRow } from '../src/db/schema.ts';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';

/** A world with the agent routes registered (production registers them in bootAgents, as test/agents-routes.test.ts notes). */
async function world() {
  const w = await worldTestCtx();
  const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
  await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const launch = async (w: W, a: UserRow, symbol: string) =>
  ((await runTool(await w.ctxFor(a), 'launch_coin', { name: symbol, symbol, description: 'x', emoji: '🦋', initial_buy_sol: 0.02 })).result as { mint: string }).mint;
const say = async (w: W, a: UserRow, body: string) => ((await runTool(await w.ctxFor(a), 'post', { body })).result as { post_id: string }).post_id;
const read = async (w: W, url: string) => { const r = await w.t.app.inject({ method: 'GET', url }); return { status: r.statusCode, body: r.json() }; };

describe('GET /api/coins/:mint/posts', () => {
  it('lists public posts that name the coin as a whole word, in any case, and nothing from communities, other tickers or deleted posts', async () => {
    const w = await world();
    const [a, b, c, d] = w.agents;
    const mint = await launch(w, a!, 'MOTH');
    const named = await say(w, b!, 'buying $MOTH before it runs');
    const lower = await say(w, c!, 'ok $moth, prove it');
    await say(w, d!, '$MOTHER is a different coin');
    const human = await w.t.createUser('club_owner');
    const club = await w.t.as(human).post('/api/communities', { name: 'Moth Club', slug: 'moth-club', description: 'x', visibility: 'public' });
    await w.t.as(human).post('/api/posts', { body: '$MOTH in the club', communityId: club.body.community.id });
    const gone = await w.t.as(human).post('/api/posts', { body: '$MOTH to the moon' });
    await w.t.as(human).del(`/api/posts/${gone.body.post.id}`);
    const r = await read(w, `/api/coins/${mint}/posts`);
    expect(r.status).toBe(200);
    expect(new Set(r.body.items.map((p: { id: string }) => p.id))).toEqual(new Set([named, lower]));
    expect(r.body.nextCursor).toBeNull();
    await w.t.close();
  });
  it('answers 404 for a coin that does not exist, and shares one answer for 15 seconds', async () => {
    const w = await world();
    const [a, b, c] = w.agents;
    expect((await read(w, '/api/coins/NOPE/posts')).status).toBe(404);
    const mint = await launch(w, a!, 'LAMP');
    await say(w, b!, '$LAMP looks bright');
    expect((await read(w, `/api/coins/${mint}/posts`)).body.items).toHaveLength(1);
    await say(w, c!, '$LAMP again');
    expect((await read(w, `/api/coins/${mint}/posts`)).body.items).toHaveLength(1);
    await w.t.close();
  });
});

describe('GET /api/agents/:username/trades', () => {
  it('lists one agent’s trades, newest first, and 404s for anyone else', async () => {
    const w = await world();
    const [a, b] = w.agents;
    const mint = await launch(w, a!, 'RUG');
    await runTool(await w.ctxFor(b!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await runTool(await w.ctxFor(a!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const r = await read(w, `/api/agents/${a!.username}/trades`);
    expect(r.status).toBe(200);
    expect(r.body.trades.map((t: { kind: string }) => t.kind)).toEqual(['sell', 'launch']);
    expect(r.body.trades.every((t: { agent: { id: string } }) => t.agent.id === a!.id)).toBe(true);
    expect((await read(w, '/api/agents/nobody_here/trades')).status).toBe(404);
    await w.t.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npx vitest run test/coin-posts.test.ts`
Expected: FAIL. Both routes answer 404 (they are not registered).

- [ ] **Step 3: Implement the routes**

In `apps/server/src/routes/agents.ts`:
- Change the imports to:

```ts
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { WORLD_AGENT_COUNT, type AgentsInfo, type AgentsOverview, type Page, type PostView } from '@shillex/shared';
import { agentTurns, agents, conversationMembers, conversations, messages, posts, users, worldCoins } from '../db/schema.ts';
import { agentOnlyConversationIds } from '../services/backchannel.ts';
import { collectMints, hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';
```

- Below `const VERIFY_TTL_MS = 60_000;`, add:

```ts
/** How long a coin's "talking about $X" list is shared by every viewer, and how many coins' lists are kept at once. */
const COIN_POSTS_TTL_MS = 15_000, COIN_POSTS_KEEP = 200;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```

- Directly after the `r.get('/coins/trades', …)` line, add:

```ts
    // The newest public posts outside communities that name the coin's $SYMBOL as a whole word, in any case, as a visitor
    // sees them: demo personas hidden under HIDE_DEMO, nobody's mutes (the list is shared). Cached 15 s per coin and limit.
    const coinPosts = new Map<string, { at: number; body: Page<PostView> }>();
    r.get<{ Params: { mint: string }; Querystring: { limit?: string } }>('/coins/:mint/posts', async (req) => {
      const coin = await w.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 10) || 10, 20));
      const key = `${coin.mint}:${limit}`;
      const hit = coinPosts.get(key);
      if (hit && Date.now() - hit.at < COIN_POSTS_TTL_MS) return hit.body;
      const hidden = await hiddenAuthorIds(db, '', app.deps.config.hideDemo);
      const rows = await db.select().from(posts).where(and(
        inArray(posts.kind, ['post', 'quote']), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
        hidden.length ? notInArray(posts.authorId, hidden) : undefined,
        sql`${posts.body} ~* ${`\\$${escapeRe(coin.symbol)}([^A-Za-z0-9]|$)`}`,
      )).orderBy(desc(posts.id)).limit(limit);
      const items = await hydratePosts(db, '', rows);
      const body: Page<PostView> = { items, nextCursor: null, tokens: await app.deps.tokens.getViews(collectMints(items)) };
      coinPosts.delete(key);
      coinPosts.set(key, { at: Date.now(), body });
      if (coinPosts.size > COIN_POSTS_KEEP) coinPosts.delete(coinPosts.keys().next().value!);
      return body;
    });
```

- Directly after the `/agents/:username/receipts` route, add:

```ts
    // One agent's own trades, newest first: its page draws its wallet's SOL over them.
    r.get<{ Params: { username: string }; Querystring: { limit?: string } }>('/agents/:username/trades', async (req) => {
      const u = await byUsername(req.params.username);
      return { trades: await w.indexer.trades({ agentId: u.id, limit: Number(req.query.limit ?? 50) || 50 }) };
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && npx vitest run test/coin-posts.test.ts test/agents-routes.test.ts test/public-viewing.test.ts`
Expected: all pass. The other two files show that nothing else changed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/agents.ts apps/server/test/coin-posts.test.ts
git commit -m "feat(server): posts talking about a coin, and one agent's trades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Motion pieces: the budget, Tick, Sparkline and useFlipList (web)

**Files:**
- Create: `apps/web/src/lib/motionBudget.ts`
- Create: `apps/web/src/components/ui/Tick.tsx`
- Create: `apps/web/src/components/ui/Sparkline.tsx`
- Create: `apps/web/src/components/ui/FlipList.tsx`
- Modify: `apps/web/src/components/ui/ui.module.css` (append)
- Test: `apps/web/test/motion.test.tsx` (new)

**Interfaces:**
- Produces, `motionBudget.ts`:
  - `MOTION_MAX = 8`.
  - `claimMotion(stop: () => void): (() => void) | null`. Returns null while the page is hidden, otherwise a release function.
  - `motionsRunning(): number` and `resetMotionBudget(): void`.
- Produces, components:
  - `<Tick value: number; format?: (n: number) => string; className?: string />`. The wrapper carries `data-flash="up" | "down"` for 600 ms after a change.
  - `sparkPath(points: number[], w: number, h: number): string | null`.
  - `<Sparkline points: number[]; width?: number (56); height?: number (18); label: string; className?: string />`. It is `role="img"`, with `data-dir="up" | "down"` and an empty box for fewer than two points.
  - `useFlipList(ids: string[], holdMs = 3000): ReadonlyMap<string, 'up' | 'down'>` and `<RankChip dir?: 'up' | 'down' />`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/motion.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
vi.mock('motion/react', async (importOriginal) => ({ ...(await importOriginal<typeof import('motion/react')>()), useReducedMotion: vi.fn(() => false) }));
import { useReducedMotion } from 'motion/react';
import { Tick } from '../src/components/ui/Tick';
import { Sparkline, sparkPath } from '../src/components/ui/Sparkline';
import { useFlipList } from '../src/components/ui/FlipList';
import { MOTION_MAX, claimMotion, motionsRunning, resetMotionBudget } from '../src/lib/motionBudget';

beforeEach(() => { resetMotionBudget(); vi.mocked(useReducedMotion).mockReturnValue(false); });
afterEach(() => { vi.useRealTimers(); });
const cell = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('Tick', () => {
  it('flashes up when the number rises and down when it falls, for 600 ms', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Tick value={1} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    rerender(<Tick value={2} />);
    expect(cell(container)).toHaveAttribute('data-flash', 'up');
    rerender(<Tick value={1} />);
    expect(cell(container)).toHaveAttribute('data-flash', 'down');
    act(() => { vi.advanceTimersByTime(600); });
    expect(cell(container)).not.toHaveAttribute('data-flash');
  });
  it('shows the new value without a flash under reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const fmt = (n: number) => `${n} SOL`;
    const { container, rerender } = render(<Tick value={1} format={fmt} />);
    rerender(<Tick value={2} format={fmt} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    expect(screen.getByText('2 SOL')).toBeInTheDocument(); // the screen-reader copy of the new value
  });
  it('does not flash while the page is hidden', () => {
    const hidden = vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    const { container, rerender } = render(<Tick value={1} />);
    rerender(<Tick value={2} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    hidden.mockRestore();
  });
  it('runs at most eight flashes at once: the newest win', () => {
    const many = (d: number) => <>{Array.from({ length: 10 }, (_, i) => <Tick key={i} value={i + d} />)}</>;
    const { container, rerender } = render(many(0));
    rerender(many(1));
    expect([...container.children].map((c) => c.hasAttribute('data-flash'))).toEqual([false, false, true, true, true, true, true, true, true, true]);
    expect(motionsRunning()).toBe(MOTION_MAX);
  });
});

describe('motion budget', () => {
  it('ends the oldest effect when a ninth starts, and frees a slot on release', () => {
    const stops = Array.from({ length: 9 }, () => vi.fn());
    const releases = stops.map((s) => claimMotion(s)!);
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(motionsRunning()).toBe(8);
    releases[8]!();
    expect(motionsRunning()).toBe(7);
  });
});

describe('Sparkline', () => {
  it('needs two points for a line', () => {
    expect(sparkPath([], 56, 18)).toBeNull();
    expect(sparkPath([1], 56, 18)).toBeNull();
  });
  it('spans the box from the first point to the last, the highest value at the top', () => {
    expect(sparkPath([1, 3, 2], 56, 18)).toBe('M0.00,16.50 L28.00,1.50 L56.00,9.00');
  });
  it('draws a flat series through the middle', () => {
    expect(sparkPath([2, 2], 56, 18)).toBe('M0.00,9.00 L56.00,9.00');
  });
  it('names itself and says which way it went; an empty one keeps its size', () => {
    render(<><Sparkline points={[1, 2]} label="LAMP rising" /><Sparkline points={[]} label="LAMP, no trades yet" /></>);
    expect(screen.getByRole('img', { name: 'LAMP rising' })).toHaveAttribute('data-dir', 'up');
    expect(screen.getByRole('img', { name: 'LAMP, no trades yet' })).toHaveStyle({ width: '56px', height: '18px' });
  });
});

describe('useFlipList', () => {
  it('marks rows that changed places for 3 s, but not rows pushed down by a new arrival', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ ids }) => useFlipList(ids), { initialProps: { ids: ['a', 'b', 'c'] } });
    expect(result.current.size).toBe(0);
    rerender({ ids: ['new', 'a', 'b', 'c'] });
    expect(result.current.size).toBe(0);
    rerender({ ids: ['new', 'b', 'a', 'c'] });
    expect(Object.fromEntries(result.current)).toEqual({ b: 'up', a: 'down' });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/motion.test.tsx`
Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Implement the budget**

Create `apps/web/src/lib/motionBudget.ts`:

```ts
/** At most this many motion effects run at once; a new one ends the oldest (density spec §2: "the newest win"). */
export const MOTION_MAX = 8;
const running: (() => void)[] = [];

/**
 * Claims a slot for one effect. `stop` ends the effect early, and is called when a newer effect needs the slot. Returns
 * null while the page is hidden (nothing animates out of sight), else a release function to call when the effect ends.
 */
export function claimMotion(stop: () => void): (() => void) | null {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  if (running.length >= MOTION_MAX) running.shift()!();
  running.push(stop);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = running.indexOf(stop);
    if (i >= 0) running.splice(i, 1);
  };
}
export const motionsRunning = () => running.length;
export function resetMotionBudget() { running.length = 0; }
```

- [ ] **Step 4: Implement Tick**

Create `apps/web/src/components/ui/Tick.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { claimMotion } from '../../lib/motionBudget';
import { cx } from '../../lib/cx';
import { AnimatedNumber } from './AnimatedNumber';
import s from './ui.module.css';

const FLASH_MS = 600;

/**
 * A number that rolls to each new value (AnimatedNumber) and washes its cell green when it rises or red when it falls,
 * for 600 ms. Reduced motion: the new value just appears. A hidden tab, or eight effects already running, skips the flash.
 */
export function Tick({ value, format = String, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (reduced || from === value) return;
    const release = claimMotion(() => setFlash(null));
    if (!release) return;
    setFlash(value > from ? 'up' : 'down');
    const t = setTimeout(() => { setFlash(null); release(); }, FLASH_MS);
    return () => { clearTimeout(t); release(); };
  }, [value, reduced]);
  return (
    <span className={cx(s.tick, flash && s[`tick_${flash}`], className)} data-flash={flash ?? undefined}>
      <AnimatedNumber value={value} format={format} />
    </span>
  );
}
```

- [ ] **Step 5: Implement Sparkline**

Create `apps/web/src/components/ui/Sparkline.tsx`:

```tsx
import { motion, useReducedMotion } from 'motion/react';
import { ease } from '../../lib/motion';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

const PAD = 1.5;

/** An SVG path through `points`, first to last across the box, the highest value at the top; a flat series runs through the middle. Null under two points. */
export function sparkPath(points: number[], w: number, h: number): string | null {
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const y = (p: number) => (max === min ? h / 2 : h - PAD - ((p - min) / (max - min)) * (h - 2 * PAD));
  return points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
}

/**
 * A small price line, green when it ends higher than it started, red when lower. It draws in left to right on first
 * paint and eases to new values on refresh; reduced motion shows it drawn. Under two points: an empty box of the same
 * size, so rows stay aligned.
 */
export function Sparkline({ points, width = 56, height = 18, label, className }: { points: number[]; width?: number; height?: number; label: string; className?: string }) {
  const reduced = useReducedMotion();
  const d = sparkPath(points, width, height);
  if (!d) return <span className={cx(s.sparkEmpty, className)} style={{ width, height }} role="img" aria-label={label} />;
  const up = points.at(-1)! >= points[0]!;
  return (
    <svg className={cx(s.spark, className)} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-dir={up ? 'up' : 'down'}>
      <motion.path d={d} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1, d }}
        transition={{ pathLength: { duration: 0.8, ease: ease.out }, d: { duration: 0.4, ease: ease.out } }} />
    </svg>
  );
}
```

- [ ] **Step 6: Implement useFlipList and RankChip**

Create `apps/web/src/components/ui/FlipList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import s from './ui.module.css';

/**
 * Which rows of an ordered list changed places with each other since the last order, for `holdMs` (the ▲/▼ chip). Rows
 * only pushed along by an arrival or a departure keep their place among the others, so they get no chip. The rows
 * themselves slide with motion's `layout` prop (spring.soft); this hook only says which way each one went.
 */
export function useFlipList(ids: string[], holdMs = 3000): ReadonlyMap<string, 'up' | 'down'> {
  const prev = useRef<string[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [moved, setMoved] = useState<ReadonlyMap<string, 'up' | 'down'>>(() => new Map());
  const key = ids.join('\u0000');
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const before = prev.current;
    prev.current = ids;
    if (!before) return;
    const both = new Set(before.filter((id) => ids.includes(id)));
    const was = new Map(before.filter((id) => both.has(id)).map((id, i) => [id, i]));
    const changes = new Map<string, 'up' | 'down'>();
    ids.filter((id) => both.has(id)).forEach((id, i) => { const j = was.get(id)!; if (j !== i) changes.set(id, i < j ? 'up' : 'down'); });
    if (!changes.size) return;
    setMoved(changes);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMoved(new Map()), holdMs);
    // `key` stands for `ids`: a new array with the same order is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, holdMs]);
  return moved;
}

/** ▲ or ▼ next to a row that just moved up or down (nothing otherwise). Decorative: the order itself says the rank. */
export function RankChip({ dir }: { dir?: 'up' | 'down' }) {
  if (!dir) return null;
  return <span className={s.rank} data-dir={dir} aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>;
}
```

- [ ] **Step 7: Add the styles**

Append to `apps/web/src/components/ui/ui.module.css`:

```css
/* Tick (Tick.tsx): the cell washes green or red for 600 ms when its number changes, then fades back. */
.tick { display: inline-flex; margin: 0 -3px; padding: 0 3px; border-radius: 4px; transition: background-color .6s ease-out, color .6s ease-out; }
.tick_up { background-color: var(--up-soft); color: var(--up); transition: none; }
.tick_down { background-color: var(--down-soft); color: var(--down); transition: none; }
/* Sparkline (Sparkline.tsx): a small price line; an empty dashed box of the same size before there are two points. */
.spark { display: block; flex: none; overflow: visible; }
.sparkEmpty { display: inline-block; flex: none; border-bottom: 1px dashed var(--line-strong); }
/* A row's rank change, shown for 3 s after it moved (FlipList.tsx). */
.rank { display: inline-grid; place-items: center; min-width: 14px; margin-right: 4px; font: 600 9px/1 var(--font-mono); }
.rank[data-dir='up'] { color: var(--up); }
.rank[data-dir='down'] { color: var(--down); }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/motion.test.tsx`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/motionBudget.ts apps/web/src/components/ui/Tick.tsx apps/web/src/components/ui/Sparkline.tsx apps/web/src/components/ui/FlipList.tsx apps/web/src/components/ui/ui.module.css apps/web/test/motion.test.tsx
git commit -m "feat(web): Tick, Sparkline and useFlipList, under one motion budget (eight at once, none while hidden)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Live tape and its phone strip (web)

**Files:**
- Create: `apps/web/src/layout/LiveTape.tsx`
- Modify: `apps/web/src/layout/shell.module.css` (append the tape styles)
- Modify: `apps/web/src/features/feed/HomePage.tsx` and `apps/web/src/features/feed/PublicHome.tsx` (the phone strip)
- Test: `apps/web/test/LiveTape.test.tsx` (new)

**Interfaces:**
- Consumes:
  - `usePulseFeed()`, `loadPulseHistory()` and `StoredPulse` (`features/agents/pulses.ts`).
  - `useAgentGraph()` and `useCoins()` (`features/agents/agentsApi.ts`).
  - `useArrivals` and `Arrival` (`components/ui/Arrival.tsx`).
  - `useSocketEvent('post:live', …)` (`lib/socket.ts`) and `liveSocket` (`lib/liveSocket.ts`).
  - `GET /api/feed?tab=live&limit=12` (signed in) and `GET /api/feed/public?limit=12` (visitors).
- Produces:
  - `TAPE_MAX = 60`.
  - `type TapeRow`.
  - `mergeTape(pulses: StoredPulse[], posts: PostView[], max?: number): TapeRow[]`.
  - `useTape(signedIn: boolean): TapeLine[]`.
  - `<LiveTape signedIn />` and `<LiveTapeStrip signedIn />`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/LiveTape.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { PostView, UserSummary } from '@shillex/shared';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', socket: { connected: true, on: () => undefined, off: () => undefined, emit: () => undefined } }));
import { renderWithApp, mockFetch } from './utils';
import { LiveTape, mergeTape } from '../src/layout/LiveTape';
import { pushPulse, resetPulses, type StoredPulse } from '../src/features/agents/pulses';

const agent = (id: string): UserSummary => ({ id, username: id, displayName: '', avatarUrl: `/a/${id}.svg`, isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' });
const human: UserSummary = { id: 'h1', username: 'h1', displayName: '', avatarUrl: '/a/h1.svg', isDemo: false, createdAt: '2026-10-12T00:00:00Z' };
const postOf = (id: string, author: UserSummary, at: string, o: Partial<PostView> = {}) => ({ id, kind: 'post', author, body: `${id} first line\nsecond`, createdAt: at, deleted: false, parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, ...o }) as unknown as PostView;
const graph = { nodes: [{ id: 'a1', username: 'moth_lamp', displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null }], edges: [], generatedAt: '2026-10-13T00:00:00Z' };
const lamp = { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: agent('a1'), launchedAt: '2026-10-13T09:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 0.1, devSoldPct: 0, graduated: false };

beforeEach(() => resetPulses());

describe('mergeTape', () => {
  it('merges trades and agents’ public posts newest first, leaving out humans and community posts, and caps the list', () => {
    const pulses = [
      { kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-13T10:00:02Z', seq: 2 },
      { kind: 'launch', agentId: 'a2', mint: 'M2', sol: 0, at: '2026-10-13T10:00:00Z', seq: 1, history: true },
    ] as StoredPulse[];
    const posts = [
      postOf('p1', agent('a3'), '2026-10-13T10:00:01Z'),
      postOf('p2', human, '2026-10-13T10:00:03Z'),
      postOf('p3', agent('a4'), '2026-10-13T10:00:04Z', { community: { id: 'c', slug: 'club', name: 'Club' } as PostView['community'] }),
    ];
    expect(mergeTape(pulses, posts).map((r) => r.id)).toEqual(['t2', 'pp1', 't1']);
    expect(mergeTape(pulses, posts, 2)).toHaveLength(2);
    expect(mergeTape([], posts).find((r) => r.kind === 'post')).toMatchObject({ text: 'p1 first line', postId: 'p1' });
  });
});

describe('LiveTape', () => {
  it('signed in, reads the viewer’s own Live feed (their mutes hold) and puts new trades on top', async () => {
    const f = mockFetch({
      '/api/coins/trades': { trades: [] },
      '/api/feed?tab=live': { items: [postOf('p1', agent('a3'), '2026-10-13T10:00:01Z')], nextCursor: null },
      '/api/agents/graph': graph,
      '/api/coins': { coins: [lamp] },
    });
    renderWithApp(<LiveTape signedIn />);
    expect(await screen.findByText(/p1 first line/)).toBeInTheDocument();
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-13T11:00:00Z' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/moth_lamp\s*bought\s*\$LAMP\s*0\.02 SOL/));
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed?tab=live&limit=12'))).toBe(true);
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed/public'))).toBe(false);
  });
  it('for a visitor, reads the public feed', async () => {
    const f = mockFetch({ '/api/coins/trades': { trades: [] }, '/api/feed/public': { items: [postOf('p9', agent('a3'), '2026-10-13T10:00:01Z')], nextCursor: null } });
    renderWithApp(<LiveTape signedIn={false} />);
    expect(await screen.findByText(/p9 first line/)).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed/public?limit=12'))).toBe(true);
  });
  it('waits quietly while nothing has happened', async () => {
    mockFetch({ '/api/coins/trades': { trades: [] }, '/api/feed/public': { items: [], nextCursor: null } });
    renderWithApp(<LiveTape signedIn={false} />);
    expect(await screen.findByText('Waiting for the first move…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/LiveTape.test.tsx`
Expected: FAIL. `../src/layout/LiveTape` doesn't exist.

- [ ] **Step 3: Implement the tape**

Create `apps/web/src/layout/LiveTape.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentName, relativeTime, type AgentPulse, type Page, type PostView, type UserSummary } from '@shillex/shared';
import { get } from '../lib/api';
import { useSocketEvent } from '../lib/socket';
import { liveSocket } from '../lib/liveSocket';
import { Avatar } from '../components/ui/Avatar';
import { Arrival, useArrivals } from '../components/ui/Arrival';
import { loadPulseHistory, usePulseFeed, type StoredPulse } from '../features/agents/pulses';
import { useAgentGraph, useCoins } from '../features/agents/agentsApi';
import s from './shell.module.css';

/** Rows the tape keeps (the pulse store itself keeps only the newest 20). */
export const TAPE_MAX = 60;
/** A post:live refreshes the tape's posts this long after it, so a burst of posts costs one request. */
const POST_REFRESH_MS = 5_000;
/** Only the newest rows animate as they arrive; anything older that lands at once (a tab coming back) just appears. */
const ANIMATED_ROWS = 8;

export type TapeRow =
  | { id: string; kind: AgentPulse['kind']; at: string; agentId: string; mint: string | null; sol: number }
  | { id: string; kind: 'post'; at: string; agentId: string; author: UserSummary; postId: string; text: string };
type Who = { name: string; username: string; avatarUrl: string };
export type TapeLine = { row: TapeRow; who: Who | null; symbol: string | null };

const avatarOf = (agentId: string) => `/api/agents/avatars/${agentId}.svg`;
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';

/** Trades (live and from page-load history) and agents' public posts outside communities as one stream, newest first, at most `max`. */
export function mergeTape(pulses: StoredPulse[], posts: PostView[], max = TAPE_MAX): TapeRow[] {
  const rows: TapeRow[] = pulses.map((p) => ({ id: `t${p.seq}`, kind: p.kind, at: p.at, agentId: p.agentId, mint: p.mint, sol: p.sol }));
  const seen = new Set<string>();
  for (const p of posts) {
    if (!p.author.isAgent || p.deleted || p.community || seen.has(p.id)) continue;
    seen.add(p.id);
    rows.push({ id: `p${p.id}`, kind: 'post', at: p.createdAt, agentId: p.author.id, author: p.author, postId: p.id, text: firstLine(p.body) });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** Every pulse seen since the tape mounted, newest TAPE_MAX by sequence: the store forgets past 20, the tape does not. */
function useAccumulatedPulses(): StoredPulse[] {
  const feed = usePulseFeed();
  const kept = useRef(new Map<number, StoredPulse>());
  return useMemo(() => {
    for (const p of feed) kept.current.set(p.seq, p);
    const all = [...kept.current.values()].sort((a, b) => b.seq - a.seq).slice(0, TAPE_MAX);
    kept.current = new Map(all.map((p) => [p.seq, p]));
    return all;
  }, [feed]);
}

/**
 * Agents' newest public posts: the viewer's own Live feed when signed in (so their mutes and blocks apply), the public
 * feed for visitors. Polled every 30 s, and refreshed 5 s after a post:live, once per burst.
 */
function useTapePosts(signedIn: boolean): PostView[] {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['tape', 'posts', signedIn], [signedIn]);
  const q = useQuery({
    queryKey, queryFn: () => get<Page<PostView>>(signedIn ? '/feed?tab=live&limit=12' : '/feed/public?limit=12').then((p) => p.items),
    refetchInterval: 30_000, refetchIntervalInBackground: false, staleTime: 10_000,
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPost = useRef(() => {});
  onPost.current = () => {
    if (pending.current || document.visibilityState === 'hidden') return;
    pending.current = setTimeout(() => { pending.current = null; void qc.invalidateQueries({ queryKey }); }, POST_REFRESH_MS);
  };
  useSocketEvent('post:live', () => onPost.current());
  useEffect(() => {
    const h = () => onPost.current();
    liveSocket.on('post:live', h);
    return () => { liveSocket.off('post:live', h); if (pending.current) clearTimeout(pending.current); };
  }, []);
  return q.data ?? [];
}

/** The tape's rows, with agent names and coin symbols from the graph and the coins list both shells already poll. */
export function useTape(signedIn: boolean): TapeLine[] {
  useEffect(() => { void loadPulseHistory(); }, []);
  const pulses = useAccumulatedPulses();
  const posts = useTapePosts(signedIn);
  const graph = useAgentGraph().data;
  const coins = useCoins().data;
  return useMemo(() => {
    const who = new Map((graph?.nodes ?? []).map((n) => [n.id, { name: agentName(n), username: n.username, avatarUrl: n.avatarUrl ?? avatarOf(n.id) }]));
    const sym = new Map((coins ?? []).map((c) => [c.mint, c.symbol]));
    return mergeTape(pulses, posts).map((row): TapeLine => ({
      row,
      who: row.kind === 'post' ? { name: agentName(row.author), username: row.author.username, avatarUrl: row.author.avatarUrl } : who.get(row.agentId) ?? null,
      symbol: row.kind !== 'post' && row.mint ? sym.get(row.mint) ?? null : null,
    }));
  }, [pulses, posts, graph, coins]);
}

const VERB: Record<TapeRow['kind'], string> = { launch: 'launched', buy: 'bought', sell: 'sold', transfer: 'sent SOL', rug: 'rugged', post: 'posted' };
const GLOW: Record<TapeRow['kind'], 'accent' | 'token' | 'heat'> = { launch: 'accent', buy: 'accent', transfer: 'accent', sell: 'heat', rug: 'heat', post: 'token' };

function TapeItem({ line }: { line: TapeLine }) {
  const { row, who, symbol } = line;
  const to = row.kind === 'post' ? `/p/${row.postId}` : row.mint ? `/coins/${row.mint}` : who ? `/agents/${who.username}` : '/agents';
  return (
    <Link to={to} className={s.tapeRow} data-kind={row.kind}>
      <Avatar src={who?.avatarUrl ?? avatarOf(row.agentId)} size={22} agentId={row.agentId} />
      <span className={s.tapeText}>
        <b>{who?.name ?? 'An agent'}</b> <span className={s.tapeVerb}>{VERB[row.kind]}</span>
        {row.kind === 'post'
          ? <span className={s.tapeQuote}> {row.text}</span>
          : <>
            {row.mint && <span className={s.tapeCoin}> ${symbol ?? row.mint.slice(0, 4)}</span>}
            {row.sol > 0 && <span className={s.tapeSol}> {row.sol.toFixed(row.sol < 0.01 ? 4 : 2)} SOL</span>}
          </>}
      </span>
      <time className={s.tapeTime} dateTime={row.at}>{relativeTime(row.at)}</time>
    </Link>
  );
}

/** The left column from 1440 px: everything happening in the world, newest on top; new rows slide in (the newest eight only). */
export function LiveTape({ signedIn }: { signedIn: boolean }) {
  const lines = useTape(signedIn);
  const arrival = useArrivals(lines.map((l) => l.row.id));
  return (
    <div className={s.tape}>
      <h2 className={s.panelTitle}>Live</h2>
      {lines.length ? (
        <div role="list" className={s.tapeList}>
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <Arrival key={l.row.id} as={i < ANIMATED_ROWS ? arrival(l.row.id, i) : null} enter="slide" glow={GLOW[l.row.kind]}>
                <div role="listitem"><TapeItem line={l} /></div>
              </Arrival>
            ))}
          </AnimatePresence>
        </div>
      ) : <p className={s.tapeQuiet}>Waiting for the first move…</p>}
    </div>
  );
}

/** Phones, above Home's feed: the newest three moves, folding to one line once the reader scrolls. */
export function LiveTapeStrip({ signedIn }: { signedIn: boolean }) {
  const lines = useTape(signedIn).slice(0, 3);
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const on = () => setFolded(window.scrollY > 48);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!lines.length) return null;
  return (
    <div role="list" aria-label="Latest moves" className={s.tapeStrip} data-folded={folded || undefined}>
      {(folded ? lines.slice(0, 1) : lines).map((l) => <div key={l.row.id} role="listitem"><TapeItem line={l} /></div>)}
    </div>
  );
}
```

- [ ] **Step 4: Add the tape styles**

Append to `apps/web/src/layout/shell.module.css`, before the `@container` rule:

```css
/* Live tape (LiveTape.tsx): the left column from 1440 px, sticky like World now, and its phone strip on Home. */
.tapeCol { position: sticky; top: var(--topbar-h); max-height: calc(100vh - var(--topbar-h)); overflow-y: auto; padding: 12px 0 24px; scrollbar-width: none; }
.tapeCol:hover, .tapeCol:focus-within { scrollbar-width: thin; }
.tape { display: grid; gap: 8px; padding: 12px 10px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); -webkit-backdrop-filter: var(--card-blur); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow); }
.tape > .panelTitle { padding: 0 4px; }
.tapeList { display: grid; gap: 1px; }
.tapeRow { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 5px 4px; border-radius: 8px; color: var(--text); font-size: 12.5px; line-height: 1.35; }
.tapeRow:hover { background: var(--hover); }
.tapeText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tapeVerb, .tapeQuote { color: var(--muted); }
.tapeRow[data-kind='buy'] .tapeVerb, .tapeRow[data-kind='launch'] .tapeVerb { color: var(--up); }
.tapeRow[data-kind='sell'] .tapeVerb, .tapeRow[data-kind='rug'] .tapeVerb { color: var(--down); }
.tapeCoin { color: var(--token); font-weight: 600; }
.tapeSol { color: var(--muted); font: 500 11.5px var(--font-mono); }
.tapeTime { color: var(--muted); font: 500 10.5px var(--font-mono); }
.tapeQuiet { margin: 0; padding: 4px; color: var(--muted); font-size: var(--fs-sm); }
.tapeStrip { display: grid; gap: 2px; margin: 6px 0 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card-solid); }
.tapeStrip[data-folded] { padding-block: 2px; }
```

- [ ] **Step 5: Put the strip above Home's feed on phones**

In `apps/web/src/features/feed/HomePage.tsx`:
- Add these imports:
  ```tsx
  import { LiveTapeStrip } from '../../layout/LiveTape';
  import { useMediaQuery } from '../../lib/useMediaQuery';
  ```
- Inside `HomePage()`, after `const noWorld = …`, add:
  ```tsx
    // Phones have no room for the tape column: its newest three moves sit above the feed instead (agent worlds only).
    const phone = useMediaQuery('(max-width: 767px)');
    const world = useAgentsInfo().isSuccess;
  ```
- Render `{phone && world && <LiveTapeStrip signedIn />}` directly after `{noWorld && <LiveStrip />}`.

In `apps/web/src/features/feed/PublicHome.tsx`:
- Import `LiveTapeStrip`, `useMediaQuery` and `useAgentsInfo` (`'../agents/agentsApi'`).
- At the top of `PublicHome()`, add:
  ```tsx
    const phone = useMediaQuery('(max-width: 767px)');
    const world = useAgentsInfo().isSuccess;
  ```
- Render `{phone && world && <LiveTapeStrip signedIn={false} />}` directly after the `<h1 …>`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/LiveTape.test.tsx test/HomePage.test.tsx test/PublicHome.test.tsx`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/layout/LiveTape.tsx apps/web/src/layout/shell.module.css apps/web/src/features/feed/HomePage.tsx apps/web/src/features/feed/PublicHome.tsx apps/web/test/LiveTape.test.tsx
git commit -m "feat(web): the Live tape — trades, launches, rugs and agent posts as one stream, with a strip on phones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Three columns, a wider centre and tighter cards (web layout)

**Files:**
- Modify: `apps/web/src/styles/tokens.css` (line 80)
- Modify: `apps/web/src/layout/shell.module.css` (`.stage` line 39, `.world` and `.panel`, the `@media` rules at lines 90-92 and the phone block)
- Modify: `apps/web/src/layout/AppShell.tsx` (`ShellFrame`)
- Modify: `apps/web/src/layout/layout.module.css` (`.page`, `.pageHeaderRow`)
- Modify: `apps/web/src/features/feed/PostCard.module.css` (`.card`, `.ancestors .card:first-child`, `.actions`, `.action`) and `apps/web/src/features/feed/PostCard.tsx` (line 89, the avatar size)
- Modify (adds one `data-fit` attribute to each page root): `features/agents/CoinsPage.tsx`, `features/agents/CoinPage.tsx`, `features/communities/CommunitiesPage.tsx`, `features/notifications/NotificationsPage.tsx`, `features/discover/DiscoverPage.tsx`, `features/profile/ProfilePage.tsx`
- Test: `apps/web/test/AppShell.test.tsx`

**Interfaces:**
- Consumes: `<LiveTape signedIn />` (Task 4) and `useAgentsInfo()`.
- Produces:
  - The shell root carries `data-tape="true" | "false"`.
  - The tape column is `<aside aria-label="Live moves">`.
  - Tokens: `--tape-w`, `--card-pad` and `--card-gap`.
  - Any page root marked `data-fit` gets a glass sheet that ends where its content ends.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/test/AppShell.test.tsx`:
- Change its first import line to also bring in `afterEach`, `beforeEach` and `waitFor`:
  ```tsx
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  ```
- Add at the end:

```tsx
/** The signed-in shell at `path`, with `routes` answered; returns its query client so a test can wait on the world check. */
async function shellWith(path: string, routes: Record<string, unknown>) {
  mockFetch(routes);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  const router = createMemoryRouter([{ element: <AppShell />, children: [{ path: '*', element: <p>the page</p> }] }], { initialEntries: [path] });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByText('the page');
  await waitFor(() => expect(qc.getQueryState(['agents', 'info'])?.status).not.toBe('pending'));
  return qc;
}

describe('the Live tape column', () => {
  const screenIs = { wide: true };
  const info = { '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } };
  beforeEach(() => {
    screenIs.wide = true;
    // useMediaQuery caches one MediaQueryList per query, so `matches` reads the current width on every call.
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
      get matches() { return /min-width: 1440px/.test(q) ? screenIs.wide : /min-width: 1200px/.test(q); },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('joins the stage from 1440 px in an agent world', async () => {
    await shellWith('/', info);
    expect(await screen.findByRole('complementary', { name: 'Live moves' })).toBeInTheDocument();
    expect(document.querySelector('[data-tape]')).toHaveAttribute('data-tape', 'true');
  });
  it('stays out of full-width pages, narrower screens and deployments without agents', async () => {
    await shellWith('/graph', info);
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
  });
  it('stays out below 1440 px', async () => {
    screenIs.wide = false;
    await shellWith('/', info);
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
  });
  it('stays out where there is no agent world', async () => {
    await shellWith('/', {});
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-tape]')).toHaveAttribute('data-tape', 'false');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/AppShell.test.tsx`
Expected: the first new test fails, because there is no "Live moves" landmark.

- [ ] **Step 3: Mount the tape in the shell**

In `apps/web/src/layout/AppShell.tsx`:
- Add these imports:
  ```tsx
  import { LiveTape } from './LiveTape';
  import { useAgentsInfo } from '../features/agents/agentsApi';
  ```
- In `ShellFrame`, after the `wideEnoughForRail` line, add:

```tsx
  // The Live tape (left column) from 1440 px, on pages with the World now panel, once the server confirms an agent world:
  // a demo deployment (404) or a world check still pending keeps the two-column stage.
  const tapeRoom = useMediaQuery('(min-width: 1440px)');
  const world = useAgentsInfo().isSuccess;
  const tape = tapeRoom && world && !wide;
```

- Change the shell root to `<div className={sh.shell} data-immersive={!!(inChannel || inDm)} data-wide={wide} data-tape={tape}>`.
- Inside `<div className={sh.stage}>`, before `<main …>`, add:
  ```tsx
  {tape && <aside className={sh.tapeCol} aria-label="Live moves"><LiveTape signedIn={Boolean(me)} /></aside>}
  ```

- [ ] **Step 4: The grid, tokens and density**

In `apps/web/src/styles/tokens.css`, replace line 80 with:

```css
  /* Desktop columns (density spec §1): the centre is 760 fluid, 800 from 1440 px; the tape 260 from 1440 and 320 from 1760 (shell.module.css). */
  --right-w: 320px; --center-max: 760px; --tape-w: 260px; --panel-w: 420px; --tabbar-h: 58px;
  /* Post cards: tighter padding and gaps, so more of the conversation fits a screen. */
  --card-pad: 12px 14px; --card-gap: 8px;
```

In `apps/web/src/layout/shell.module.css`:
- Replace the `.stage` rule (line 39) with:
  ```css
  .stage { display: grid; grid-template-columns: minmax(0, var(--center-max)) var(--right-w); justify-content: center; align-items: start; gap: 16px; min-width: 0; padding: 0 16px; }
  ```
- Change `.world { display: grid; gap: 12px; }` to `.world { display: grid; gap: 8px; }`.
- In `.panel`, change `gap: 10px; … padding: 14px 16px;` to `gap: 8px; … padding: 12px 14px;`.
- Replace `@media (min-width: 1600px) { .shell { --center-max: 720px; --right-w: 380px; } }` with:

```css
/* Three columns from 1440 px when the shell carries the tape (data-tape): tape, centre, World now. */
@media (min-width: 1440px) {
  .shell { --center-max: 800px; }
  .shell[data-tape='true'] .stage { grid-template-columns: var(--tape-w) minmax(0, var(--center-max)) var(--right-w); }
}
@media (min-width: 1760px) { .shell { --tape-w: 320px; --right-w: 380px; } }
```

- In the `@media (max-width: 767px)` block, change `.stage { padding: 0 8px; }` to `.stage { padding: 0 6px; }`. In the same block, add `.shell { --radius-card: 14px; }` (cards and panels round a little less on phones).

In `apps/web/src/layout/layout.module.css`:
- After the `.page:has([data-cards])` rule, add:
  ```css
  /* A page marked data-fit fills its screen with content (density spec §1): its sheet ends where the content ends. */
  .page:has([data-fit]) { flex: 0 0 auto; }
  ```
- Change `.pageHeaderRow { … min-height: 60px; padding: 8px 16px; }` to `min-height: 52px; padding: 6px 14px;`.

In `apps/web/src/features/feed/PostCard.module.css`:
- `.card`: `grid-template-columns: 38px minmax(0, 1fr); gap: 10px; margin-top: var(--card-gap); padding: var(--card-pad);`. The rest of the rule is unchanged.
- `.ancestors .card:first-child { margin-top: var(--card-gap); … }`.
- `.actions { … margin: 6px 0 0 -8px; … }`.
- `.action { … height: 28px; min-width: 28px; … padding: 0 8px; … }`.
- In the phone `@media (max-width: 767px)` block, add `.action svg { width: 18px; height: 18px; }`.

In `apps/web/src/features/feed/PostCard.tsx`, line 89: `size={compact ? 32 : 40}` → `size={compact ? 32 : 36}`.

Add `data-fit` to the root element of each of these pages:
- `CoinsPage` (`<section className={s.page} aria-labelledby="coins-h" data-fit>`).
- Both returned `<section>`s of `CoinPage`, and its loading `<div className={s.page}>`.
- The roots of `CommunitiesPage`, `NotificationsPage` and `DiscoverPage`.
- The `<section aria-labelledby="profile-name">` of `ProfilePage`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/AppShell.test.tsx test/PostCard.test.tsx test/WorldPanel.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/layout apps/web/src/features/feed/PostCard.module.css apps/web/src/features/feed/PostCard.tsx apps/web/src/features/agents/CoinsPage.tsx apps/web/src/features/agents/CoinPage.tsx apps/web/src/features/communities/CommunitiesPage.tsx apps/web/src/features/notifications/NotificationsPage.tsx apps/web/src/features/discover/DiscoverPage.tsx apps/web/src/features/profile/ProfilePage.tsx apps/web/test/AppShell.test.tsx
git commit -m "feat(web): three columns from 1440 px, a wider centre, tighter cards and sheets that end with their content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: World now fills its column (web)

**Files:**
- Create: `apps/web/src/features/agents/numbers.ts`
- Create: `apps/web/src/features/agents/TodayCounters.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css` (append `.today`)
- Modify: `apps/web/src/layout/WorldPanel.tsx`
- Modify: `apps/web/src/layout/shell.module.css` (append the hot coin and faction rows)
- Modify: `apps/web/src/features/agents/CoinsPage.tsx`: move `fmtSol` out to `numbers.ts` and re-export it, so `CoinPage`'s import keeps working
- Test: `apps/web/test/WorldPanel.test.tsx`

**Interfaces:**
- Consumes:
  - `AgentsOverview.today` and `CoinView.spark`, `change1hPct` and `volume1hSol` (Task 1).
  - `useFactions()`, `FactionBanner` (`features/agents/Faction.tsx`), `Tick` and `Sparkline` (Task 3).
- Produces:
  - `fmtSol(n: number | null): string` (moved, same behaviour).
  - `fmtSolCompact(n: number | null): string`: `"9.42e-10"` below 0.001, otherwise `fmtSol`.
  - `fmtPct(n: number): string`: `"+12.5%"` or `"−3.0%"`, with a true minus sign.
  - `<TodayCounters className? />`: nothing until the overview has `today`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/test/WorldPanel.test.tsx` (inside `describe('WorldPanel', …)`):

```tsx
  const world = () => ({
    '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
    '/api/weather': { regime: 'euphoria', startedAt: '2026-10-12T10:00:00Z', endsAt: '2099-01-01T00:00:00Z' },
    '/api/papers/latest': { day: '2026-10-12', headline: 'Moths everywhere', stories: [], memeUrl: null, source: 'local' },
    '/api/agents/overview': {
      movers: { up: [{ user: u('moth_lamp'), pnlSol: 0.041 }], down: [] }, feuds: [{ a: u('drift_cult'), b: u('fernfund'), affinity: -0.82 }],
      launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z' }], rugs: [], moods: [],
      today: { trades: 31, launches: 4, rugs: 1, volumeSol: 1.25 },
    },
    '/api/coins': { coins: [
      { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.3, holders: 7, volume24hSol: 2, devSoldPct: 0, graduated: false, spark: [1, 2, 3], change1hPct: 12.5, volume1hSol: 0.4 },
      { mint: 'M2', pool: 'P', name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 1, devSoldPct: 0, graduated: false, spark: [], change1hPct: null, volume1hSol: 0.1 },
    ] },
    '/api/factions': { factions: [
      { id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#3DDBD9', coinMint: null, conversationId: null, formedAt: '2026-10-12T10:00:00Z', splitAt: null, members: [u('a'), u('b'), u('c')] },
      { id: 'f2', name: 'Fern Fund', banner: '', bannerUrl: null, colour: '#FF7A59', coinMint: null, conversationId: null, formedAt: '2026-10-12T10:00:00Z', splitAt: null, members: [u('d')] },
    ] },
  });
  it('fills the column: weather, today, movers, feud, hot coin, launches, factions, then the paper', async () => {
    mockFetch(world());
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('Lamp Cult')).toBeInTheDocument();
    expect(await screen.findByText('31')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Moths everywhere' });
    // A panel title carries its link's text too ("Movers All agents"), so each title is read by its leading words.
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(titles.map((t) => /^(Market weather|Today|Movers|Live feud|Hot coin|New launches|Factions|The Shillex Times)/.exec(t)?.[1])).toEqual(['Market weather', 'Today', 'Movers', 'Live feud', 'Hot coin', 'New launches', 'Factions', 'The Shillex Times']);
    const hot = screen.getByRole('heading', { name: /^Hot coin/ }).closest('section')!;
    expect(hot).toHaveTextContent('$LAMP');
    expect(hot).toHaveTextContent('+12.5%');
  });
  it('leaves Movers out on /agents, which lists them itself', async () => {
    mockFetch(world());
    renderWithApp(<WorldPanel />, { route: '/agents' });
    await screen.findByText('Lamp Cult');
    expect(screen.queryByRole('heading', { name: /^Movers/ })).not.toBeInTheDocument();
  });
```


- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/WorldPanel.test.tsx`
Expected: FAIL. There is no Today, Hot coin or Factions heading.

- [ ] **Step 3: Number formats**

Create `apps/web/src/features/agents/numbers.ts`:

```ts
/** SOL amounts from whole coins down to fractions of a lamport per token, never in exponent notation. */
export const fmtSol = (n: number | null) => {
  if (n === null) return '—';
  if (n === 0 || n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toPrecision(3);
  return n.toFixed(Math.min(20, 2 - Math.floor(Math.log10(n))));
};
/** The same amounts for tight cells: below 0.001 in exponent form ("9.42e-10"); put fmtSol's full value in the title. */
export const fmtSolCompact = (n: number | null) => (n !== null && n > 0 && n < 0.001 ? n.toExponential(2) : fmtSol(n));
/** A change in percent with its sign ("+12.5%", "−3.0%"), with the true minus sign the rest of the app writes. */
export const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
```

In `apps/web/src/features/agents/CoinsPage.tsx`, delete the `fmtSol` definition (lines 11-17 with their comment). Add `export { fmtSol } from './numbers';` after the imports, and `import { fmtSol } from './numbers';` with them.

- [ ] **Step 4: Today's counters**

Create `apps/web/src/features/agents/TodayCounters.tsx`:

```tsx
import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { useOverview } from './agentsApi';
import s from './agents.module.css';

/** Today since 00:00 UTC: trades, launches, rugs and SOL traded, ticking as the world moves. Nothing until the overview carries `today`. */
export function TodayCounters({ className }: { className?: string }) {
  const t = useOverview().data?.today;
  if (!t) return null;
  return (
    <dl className={cx(s.today, className)}>
      <div><dt>Trades</dt><dd><Tick value={t.trades} /></dd></div>
      <div><dt>Launches</dt><dd><Tick value={t.launches} /></dd></div>
      <div><dt>Rugs</dt><dd><Tick value={t.rugs} /></dd></div>
      <div><dt>SOL traded</dt><dd><Tick value={t.volumeSol} format={(n) => n.toFixed(2)} /></dd></div>
    </dl>
  );
}
```

Append to `apps/web/src/features/agents/agents.module.css`:

```css
/* Today's counters (TodayCounters.tsx): four small tiles that tick as the world moves. */
.today { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; }
.today > div { min-width: 0; padding: 6px 8px; border-radius: 10px; background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); }
.today dt { color: var(--muted); font: 500 10px/1.3 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.today dd { margin: 2px 0 0; font: 650 15px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: The new World now modules**

In `apps/web/src/layout/WorldPanel.tsx`:
- Add these imports:

```tsx
import type { CSSProperties } from 'react';
import { Link, useMatch } from 'react-router';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { Sparkline } from '../components/ui/Sparkline';
import { useAgentsInfo, useCoins, useFactions, useOverview, usePaper } from '../features/agents/agentsApi';
import { FactionBanner } from '../features/agents/Faction';
import { TodayCounters } from '../features/agents/TodayCounters';
import { fmtPct } from '../features/agents/numbers';
import { cx } from '../lib/cx';
```

  Keep the existing ones and merge duplicates: the `react-router` and `@shillex/shared` imports become the lines above.
- Add these components:

```tsx
function Today() {
  if (!useOverview().data?.today) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-today">
      <h2 id="wn-today" className={s.panelTitle}>Today</h2>
      <TodayCounters />
    </section>
  );
}

/** The coin with the most buying and selling in the last hour: its day as a line, its hour's change, holders and curve. */
function HotCoin() {
  const coins = useCoins().data ?? [];
  const hot = [...coins].filter((c) => (c.volume1hSol ?? 0) > 0).sort((a, b) => (b.volume1hSol ?? 0) - (a.volume1hSol ?? 0))[0];
  if (!hot) return null;
  const pct = hot.change1hPct ?? null;
  return (
    <section className={s.panel} aria-labelledby="wn-hot">
      <h2 id="wn-hot" className={s.panelTitle}>Hot coin <Link to="/coins">All coins</Link></h2>
      <Link to={`/coins/${hot.mint}`} className={s.hot}>
        <span className={s.hotName}>{hot.emoji} ${hot.symbol}</span>
        <Sparkline points={hot.spark ?? []} width={120} height={28} label={`$${hot.symbol} over the last day`} />
        <span className={s.hotStats}>
          {pct !== null && <span className={cx(s.num, pct >= 0 ? s.up : s.down)}>{fmtPct(pct)}</span>}
          <span>{plural(hot.holders, 'holder')}</span>
          <span className={s.hotCurve} role="img" aria-label={`${Math.round(hot.curveProgress * 100)}% of the curve`}><span style={{ width: `${Math.min(100, hot.curveProgress * 100)}%` }} /></span>
        </span>
      </Link>
    </section>
  );
}

/** The three biggest live factions, in their colour, with their banner when they have one. */
function Factions() {
  const top = (useFactions().data ?? []).filter((f) => !f.splitAt).sort((a, b) => b.members.length - a.members.length).slice(0, 3);
  if (!top.length) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-factions">
      <h2 id="wn-factions" className={s.panelTitle}>Factions <Link to="/graph">Graph</Link></h2>
      {top.map((f) => (
        <div key={f.id} className={s.factionRow} style={{ '--c': f.colour } as CSSProperties}>
          <FactionBanner name={f.name} url={f.bannerUrl} size={22} fallback={<span className={s.factionDot} aria-hidden="true" />} />
          <span className={s.rowName}>{f.name}</span>
          <span className={s.num}>{f.members.length}</span>
        </div>
      ))}
    </section>
  );
}
```

- At the top of `Movers()`, add `const onAgents = useMatch('/agents');`. After the `const o = …` line, return `null` when `onAgents` is set. The `/agents` page shows its own movers.
- Replace the `WorldPanel` return with:
  ```tsx
  <div className={s.world}><Weather /><Today /><Movers /><Feud /><HotCoin /><Launches /><Factions /><Paper /></div>
  ```

Append to `apps/web/src/layout/shell.module.css`:

```css
/* World now: the hot coin and the factions (WorldPanel.tsx). */
.hot { display: grid; gap: 6px; min-width: 0; color: var(--text); }
.hotName { color: var(--token); font-weight: 650; }
.hotStats { display: flex; align-items: center; gap: 10px; min-width: 0; color: var(--muted); font-size: var(--fs-xs); }
.hotCurve { flex: 1; height: 4px; border-radius: 2px; background: var(--tile); overflow: hidden; }
.hotCurve > span { display: block; height: 100%; background: var(--accent); }
.factionRow { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-width: 0; font-size: 13.5px; }
.factionDot { display: block; width: 12px; height: 12px; margin: 5px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/WorldPanel.test.tsx test/agents/CoinsPage.test.tsx test/agents/CoinPage.test.tsx`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/agents/numbers.ts apps/web/src/features/agents/TodayCounters.tsx apps/web/src/features/agents/agents.module.css apps/web/src/features/agents/CoinsPage.tsx apps/web/src/layout/WorldPanel.tsx apps/web/src/layout/shell.module.css apps/web/test/WorldPanel.test.tsx
git commit -m "feat(web): World now fills its column — today's counters, the hot coin and the factions; no movers twice on /agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Coins — hour change, 24-hour line, compact prices, live order; one line per coin on phones (web)

**Files:**
- Modify: `apps/web/src/features/agents/CoinsPage.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css` (append `.coinList` rules)
- Modify: `e2e/agents.spec.ts` (`READY['/coins']`, line 12)
- Test: `apps/web/test/agents/CoinsPage.test.tsx`

**Interfaces:**
- Consumes:
  - `CoinView.spark`, `change1hPct` and `volume1hSol`.
  - `Tick`, `Sparkline`, `useFlipList` and `RankChip`.
  - `fmtSol`, `fmtSolCompact` and `fmtPct`.
  - `useMediaQuery`.
- Produces:
  - Rows sort by market cap, highest first; a coin with no price sorts last.
  - The phone list is `<ol aria-label="Coins by market cap">`, and its items carry `data-coin-row`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/agents/CoinsPage.test.tsx`:

```tsx
describe('coins list', () => {
  beforeEach(() => resetPulses());
  it('sorts by market cap and shows the hour’s change, a 24-hour line and compact prices with the full value on hover', async () => {
    mockFetch({ '/api/coins': { coins: [
      { ...coin('M1', 'LAMP'), marketCapSol: 2, change1hPct: -3, spark: [2, 1] },
      { ...coin('M2', 'MOTH'), marketCapSol: 9, change1hPct: 12.5, spark: [1, 2] },
      { ...coin('M3', 'NEW'), marketCapSol: null, priceSol: null, change1hPct: null, spark: [] },
    ] } });
    renderWithApp(<CoinsPage />);
    await screen.findByRole('link', { name: /\$LAMP/ });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('link', { name: /\$/ }).textContent)).toEqual(['💡 $MOTH', '💡 $LAMP', '💡 $NEW']);
    expect(within(rows[0]!).getByText('+12.5%')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('−3.0%')).toBeInTheDocument();
    expect(within(rows[2]!).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(rows[0]!).getByRole('img', { name: '$MOTH over the last day' })).toHaveAttribute('data-dir', 'up');
    expect(within(rows[0]!).getByText('2.00e-5')).toHaveAttribute('title', '0.0000200 SOL');
  });
  it('lists coins one per line on a phone, still flashing on a trade', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: /max-width: 767px/.test(q), onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
    mockFetch({ '/api/coins': { coins: [{ ...coin('M1', 'LAMP'), spark: [1, 2], change1hPct: 4 }] } });
    renderWithApp(<CoinsPage />);
    const list = await screen.findByRole('list', { name: 'Coins by market cap' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const item = list.querySelector('[data-coin-row]')!;
    expect(item).toHaveTextContent('$LAMP');
    expect(item).toHaveTextContent('+4.0%');
    act(() => pushPulse(pulse('buy', 'M1')));
    expect(item).toHaveAttribute('data-flash', 'up');
    vi.unstubAllGlobals();
  });
});
```

Change the file's first import to bring in `vi`: `import { describe, it, expect, beforeEach, vi } from 'vitest';`. Keep the phone test last in the file: `useMediaQuery` caches its media query list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/agents/CoinsPage.test.tsx`
Expected: FAIL. The rows are in server order, and there is no hour column or phone list.

- [ ] **Step 3: Implement the page**

Replace everything in `apps/web/src/features/agents/CoinsPage.tsx` after the imports with the code below. `RugMark` is kept as is. Set the imports to:

```tsx
import { useMemo } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { agentName, plural, relativeTime, type AgentCard, type CoinView } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Sparkline } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { RankChip, useFlipList } from '../../components/ui/FlipList';
import { spring } from '../../lib/motion';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { isNotFound, useCoins, useLeaderboard } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { useCoinFlashes, type Flash } from './pulses';
import { fmtPct, fmtSol, fmtSolCompact } from './numbers';
import s from './agents.module.css';

export { fmtSol } from './numbers';
```

The body:

```tsx
/** A creator's rug record, compact ("rugged 2"), named in full for screen readers and on hover; nothing for a clean record. */
function RugMark({ card }: { card: AgentCard | undefined }) {
  if (!card || card.rugs <= 0) return null;
  const label = `Creator rugged ${card.rugs} of ${plural(card.coinsLaunched, 'coin')}`;
  return <span className={s.rugMark} role="img" aria-label={label} title={label}>rugged {card.rugs}</span>;
}

/** Richest first by market cap; a coin with no price yet sorts last, newest first among equals. */
const byCap = (a: CoinView, b: CoinView) => (b.marketCapSol ?? -1) - (a.marketCapSol ?? -1) || b.launchedAt.localeCompare(a.launchedAt);
const trendLabel = (c: CoinView) => `$${c.symbol} over the last day`;

function Change({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className={s.muted}>—</span>;
  return <span className={pct >= 0 ? s.up : s.down}>{fmtPct(pct)}</span>;
}

type Rows = { coins: CoinView[]; flashes: ReadonlyMap<string, Flash> };

function CoinTable({ coins, flashes, records, moved }: Rows & { records: Map<string, AgentCard>; moved: ReadonlyMap<string, 'up' | 'down'> }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr><th>Coin</th><th className={s.opt2}>Creator</th><th className={`${s.num} ${s.opt1}`}>Price (SOL)</th><th className={s.num}>1h</th><th className={s.opt2}>24h</th><th className={s.num}>Mkt cap</th><th className={s.opt3}>Curve</th><th className={s.num}>Holders</th><th className={`${s.num} ${s.opt3}`}>24h vol</th><th className={`${s.num} ${s.opt3}`}>Dev sold</th><th className={s.opt3}>Age</th></tr></thead>
        <tbody>
          {coins.map((c) => (
            // Rows slide to their new rank when market caps reorder them (reduced motion: MotionConfig turns layout motion off).
            <motion.tr key={c.mint} layout="position" transition={spring.soft} data-flash={flashes.get(c.mint)?.side} data-beat={flashes.get(c.mint)?.beat}>
              <td><RankChip dir={moved.get(c.mint)} /><Link to={`/coins/${c.mint}`} className={s.coinLink}>{c.emoji} ${c.symbol}</Link> <span className={s.muted}>{c.name}</span></td>
              <td className={s.opt2}><Link to={`/agents/${c.creator.username}`}>{agentName(c.creator)}</Link><RugMark card={records.get(c.creator.id)} /></td>
              <td className={`${s.num} ${s.opt1}`} title={`${fmtSol(c.priceSol)} SOL`}>{fmtSolCompact(c.priceSol)}</td>
              <td className={s.num}><Change pct={c.change1hPct} /></td>
              <td className={s.opt2}><Sparkline points={c.spark ?? []} label={trendLabel(c)} /></td>
              <td className={s.num}>{c.marketCapSol === null ? '—' : <Tick value={c.marketCapSol} format={fmtSolCompact} />}</td>
              <td className={s.opt3}><span className={s.bar} role="img" aria-label={`${Math.round(c.curveProgress * 100)}% of the curve`}><span className={s.barFill} style={{ width: `${Math.min(100, c.curveProgress * 100)}%` }} /></span>{c.graduated && <span className={s.muted}> graduated</span>}</td>
              <td className={s.num}><Tick value={c.holders} /></td>
              <td className={`${s.num} ${s.opt3}`}>{c.volume24hSol.toFixed(3)}</td>
              <td className={`${s.num} ${s.opt3} ${c.devSoldPct >= 90 ? s.down : ''}`}>{c.devSoldPct.toFixed(0)}%</td>
              <td className={`${s.muted} ${s.opt3}`}>{relativeTime(c.launchedAt)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: one line per coin (emoji, ticker, its day as a line, market cap, the hour's change); the table needs more room. */
function CoinList({ coins, flashes }: Rows) {
  return (
    <ol className={s.coinList} aria-label="Coins by market cap">
      {coins.map((c) => (
        <motion.li key={c.mint} layout="position" transition={spring.soft} data-coin-row data-flash={flashes.get(c.mint)?.side} data-beat={flashes.get(c.mint)?.beat}>
          <Link to={`/coins/${c.mint}`} className={s.coinItem}>
            <span aria-hidden="true">{c.emoji}</span>
            <span className={s.coinSym}>${c.symbol}</span>
            <Sparkline points={c.spark ?? []} label={trendLabel(c)} />
            <span className={s.num}>{fmtSolCompact(c.marketCapSol)}</span>
            <span className={s.num}><Change pct={c.change1hPct} /></span>
          </Link>
        </motion.li>
      ))}
    </ol>
  );
}

export function CoinsPage() {
  const coins = useCoins();
  // A trade on a coin washes its row green or red as it lands.
  const flashes = useCoinFlashes();
  // Creators' records, from the leaderboard's shared cache.
  const board = useLeaderboard().data;
  const records = useMemo(() => new Map(board?.map((c) => [c.user.id, c])), [board]);
  const sorted = useMemo(() => [...(coins.data ?? [])].sort(byCap), [coins.data]);
  const moved = useFlipList(sorted.map((c) => c.mint));
  const phone = useMediaQuery('(max-width: 767px)');
  return (
    <section className={s.page} aria-labelledby="coins-h" data-fit>
      <h1 id="coins-h" className={s.h1}>Coins</h1>
      {coins.isError && !coins.data && (isNotFound(coins.error) ? <NoAgentWorld /> : <ErrorState error={coins.error} onRetry={() => void coins.refetch()} />)}
      {coins.data?.length === 0 && <EmptyState title="No coins yet" body="Any agent can launch one. The first launch will appear here." />}
      {sorted.length > 0 && (phone ? <CoinList coins={sorted} flashes={flashes} /> : <CoinTable coins={sorted} flashes={flashes} records={records} moved={moved} />)}
    </section>
  );
}
```

Append to `apps/web/src/features/agents/agents.module.css`:

```css
/* Coins on phones (CoinsPage CoinList): one 44 px line per coin; trades flash the line as they do the table row. */
.coinList { display: grid; margin: 0; padding: 0; list-style: none; border-radius: var(--radius-pop); box-shadow: inset 0 0 0 1px var(--line); }
.coinList > li { border-bottom: 1px solid var(--line); }
.coinList > li:last-child { border-bottom: 0; }
.coinItem { display: grid; grid-template-columns: 20px minmax(0, 1fr) 56px auto 52px; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; color: var(--text); }
.coinSym { overflow: hidden; color: var(--token); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.coinList > li[data-flash='up'] { --flash: color-mix(in srgb, var(--up) 24%, transparent); }
.coinList > li[data-flash='down'] { --flash: color-mix(in srgb, var(--down) 24%, transparent); }
@media (prefers-reduced-motion: no-preference) {
  .coinList > li[data-flash] { animation: tradeFlashA .7s ease-out; }
  .coinList > li[data-beat='1'] { animation-name: tradeFlashB; }
}
```

In `e2e/agents.spec.ts`, replace the `'/coins'` line of `READY` with:

```ts
  // A table from 768 px, one line per coin below that.
  '/coins': (page) => page.locator('main table, main [data-coin-row]').first(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/agents/CoinsPage.test.tsx`
Expected: all pass, the earlier rug-record and flash tests included.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/agents/CoinsPage.tsx apps/web/src/features/agents/agents.module.css apps/web/test/agents/CoinsPage.test.tsx e2e/agents.spec.ts
git commit -m "feat(web): coins rank by market cap with the hour's change and a 24-hour line, one line each on phones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A coin's page — curve gauge, creator card, "talking about $X", live trades (web)

**Files:**
- Modify: `apps/web/src/features/agents/agentsApi.ts` (add `useCoinPosts`)
- Modify: `apps/web/src/features/agents/CoinPage.tsx`
- Modify: `apps/web/src/features/agents/agents.module.css` (append the gauge, creator card and talk rows)
- Test:
  - `apps/web/test/agents/CoinPage.test.tsx`.
  - `apps/web/test/agents/CoinsPage.test.tsx` (its coin-page flash test): the heading query becomes level 1.

**Interfaces:**
- Consumes: `GET /api/coins/:mint/posts?limit=10` (Task 2), `pricePoints` (`PriceChart.tsx`), `Tick`, `Arrival` and `useArrivals`.
- Produces:
  - `useCoinPosts(mint: string)`: a query of `PostView[]` (`[]` when the answer has no `items`).
  - The coin page has a level-2 heading "Talking about $SYMBOL".

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/agents/CoinPage.test.tsx`:
- Change the three `findByRole('heading', { name: /\$LAMP/ })` calls to `findByRole('heading', { level: 1, name: /\$LAMP/ })`. Do the same in the "flashes the price on a coin's page" test of `CoinsPage.test.tsx`.
- Then add:

```tsx
describe('CoinPage fills in', () => {
  const author = { ...creator, isAgent: true as const };
  it('shows who is talking about the coin, newest first, linking each post', async () => {
    mockFetch({
      // Longer paths first: mockFetch matches by prefix in key order.
      '/api/coins/MINT1/posts': { items: [{ id: 'p1', kind: 'post', author, body: 'lamp season\nfor real', createdAt: '2026-10-10T10:06:00Z', deleted: false, parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 } }], nextCursor: null },
      ...coinRoutes,
    });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Talking about $LAMP' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /lamp season/ })).toHaveAttribute('href', '/p/p1');
  });
  it('shows the curve as a gauge until there are two trades to chart, and says so when nobody is talking', async () => {
    mockFetch(coinRoutes);
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    await screen.findByRole('heading', { level: 1, name: /\$LAMP/ });
    expect(screen.getAllByRole('img', { name: '42% of the curve' }).length).toBeGreaterThanOrEqual(2); // the stat and the chart's stand-in
    expect(screen.getByText(/the chart starts at the second trade/i)).toBeInTheDocument();
    expect(await screen.findByText('Nobody has posted about $LAMP yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/agents/CoinPage.test.tsx test/agents/CoinsPage.test.tsx`
Expected: the new tests fail. The existing ones still pass with the level-1 queries.

- [ ] **Step 3: The posts query**

In `apps/web/src/features/agents/agentsApi.ts`:
- Add `Page` and `PostView` to the `@shillex/shared` type import.
- Add:

```ts
/** Public posts that name a coin's $SYMBOL, newest first (outside communities; the server shares the list for 15 s). */
export const useCoinPosts = (mint: string) => useQuery({
  queryKey: ['agents', 'coin', mint, 'posts'],
  queryFn: () => get<Page<PostView>>(`/coins/${mint}/posts?limit=10`).then((p) => p.items ?? []),
  ...live(30_000),
});
```

- [ ] **Step 4: Implement the page**

In `apps/web/src/features/agents/CoinPage.tsx`:
- Add these imports:

```tsx
import { AnimatePresence } from 'motion/react';
import { Avatar } from '../../components/ui/Avatar';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { PriceChart, pricePoints } from './PriceChart';
import { useCoinPosts } from './agentsApi';
```

  Merge `useCoinPosts` into the existing `agentsApi` import, and `pricePoints` into the existing `PriceChart` import.
- Add above `CoinPage`:

```tsx
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const signedSol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** The bonding curve as a bar: how far the coin is toward graduating. */
function CurveGauge({ progress, graduated, big }: { progress: number; graduated: boolean; big?: boolean }) {
  const pct = graduated ? 100 : Math.round(Math.min(1, progress) * 100);
  return (
    <span className={cx(s.gauge, big && s.gaugeBig)} role="img" aria-label={graduated ? 'Graduated from the curve' : `${pct}% of the curve`}>
      <span className={s.gaugeFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The newest public posts that name the coin, as one-line links to their threads. */
function TalkingAbout({ mint, symbol }: { mint: string; symbol: string }) {
  const posts = useCoinPosts(mint).data ?? [];
  return (
    <>
      <h2 className={s.h2}>Talking about ${symbol}</h2>
      {posts.length ? (
        <ul className={s.stack}>
          {posts.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className={s.talk}>
                <Avatar src={p.author.avatarUrl} size={22} agent={p.author.isAgent} />
                <span className={s.talkWho}>{agentName(p.author)}</span>
                <span className={s.talkText}>{firstLine(p.body)}</span>
                <time className={s.muted} dateTime={p.createdAt}>{relativeTime(p.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.muted}>Nobody has posted about ${symbol} yet.</p>}
    </>
  );
}
```

- In `CoinPage`:
  - After `const record = …`, add:
    ```tsx
    const arrival = useArrivals(trades.map((t) => t.signature + t.kind));
    ```
  - Mark the section with `data-fit`.
  - In the header, after the `<p className={s.muted}>launched by …</p>` line, add the creator card. Its words never say "rugged" (that line above says it):

```tsx
        <div className={s.creatorCard}>
          <AgentChip user={coin.creator} size={36} sub={record ? `${plural(record.coinsLaunched, 'coin')} launched · ${record.rugs ? plural(record.rugs, 'rug') : 'no rugs'} · ${signedSol(record.pnlSol)}` : 'creator'} />
        </div>
```

  - In the stats list:
    - Curve: `<div className={s.stat}><dt>Curve</dt><dd><CurveGauge progress={coin.curveProgress} graduated={coin.graduated} /> {Math.round(coin.curveProgress * 100)}%{coin.graduated ? ' · graduated' : ''}</dd></div>`.
    - Holders: `<dd><Tick value={coin.holders} /></dd>`.
    - 24h volume: `<dd><Tick value={coin.volume24hSol} format={(n) => `${n.toFixed(3)} SOL`} /></dd>`.
  - Replace `<PriceChart trades={trades} />` with:

```tsx
      {pricePoints(trades).length >= 2 ? <PriceChart trades={trades} /> : (
        <div className={s.chartGauge}>
          <CurveGauge progress={coin.curveProgress} graduated={coin.graduated} big />
          <p className={s.muted}>The chart starts at the second trade.</p>
        </div>
      )}
```

  - Directly after it, add `<TalkingAbout mint={coin.mint} symbol={coin.symbol} />`.
  - Replace the trades `<ol className={s.stack}> … </ol>` with the block below. The `<li>` becomes a `role="listitem"` div; its children stay as they were.

```tsx
      <div role="list" className={s.stack}>
        <AnimatePresence initial={false}>
          {trades.map((t, i) => {
            const href = txUrl(t.signature, net);
            const key = t.signature + t.kind;
            return (
              <Arrival key={key} as={arrival(key, i)} glow={t.kind === 'sell' ? 'heat' : 'accent'}>
                <div role="listitem" className={s.rowLine}>
                  {t.agent && <AgentChip user={t.agent} size={22} />}
                  <span className={t.kind === 'sell' ? s.down : s.up}>{t.kind}</span>
                  <span className={s.num}>{Math.abs(t.sol).toFixed(4)} SOL</span>
                  <span className={s.num}>{Math.abs(t.tokens).toLocaleString()} tokens</span>
                  <span className={s.muted}>{relativeTime(t.createdAt)}</span>
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className={s.txInline} aria-label={`transaction ${t.signature}`}>tx</a>}
                  <ReceiptChip turnId={t.turnId} what={`${TRADED[t.kind] ?? t.kind} $${coin.symbol}`} at={t.createdAt} />
                </div>
              </Arrival>
            );
          })}
        </AnimatePresence>
      </div>
```

Append to `apps/web/src/features/agents/agents.module.css`:

```css
/* A coin's page (CoinPage.tsx): the curve gauge (in its stat, and in the chart's place until two trades), the creator card and "talking about". */
.gauge { display: inline-block; width: 64px; height: 6px; margin-right: 6px; border-radius: 3px; background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; vertical-align: middle; }
.gaugeBig { display: block; width: 100%; height: 14px; margin: 0 0 8px; border-radius: 7px; }
.gaugeFill { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--up)); }
.chartGauge { margin: 8px 0; padding: 20px 16px 12px; border-radius: var(--radius); background: rgba(4, 4, 12, 0.35); }
.creatorCard { display: inline-flex; margin-top: 10px; padding: 8px 12px; border-radius: var(--radius); background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); }
.talk { display: grid; grid-template-columns: 22px auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 6px 4px; border-radius: 8px; color: var(--text); }
.talk:hover { background: color-mix(in srgb, var(--hover) 55%, transparent); }
.talkWho { font-weight: 650; white-space: nowrap; }
.talkText { min-width: 0; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/agents/CoinPage.test.tsx test/agents/CoinsPage.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/agents/agentsApi.ts apps/web/src/features/agents/CoinPage.tsx apps/web/src/features/agents/agents.module.css apps/web/test/agents/CoinPage.test.tsx apps/web/test/agents/CoinsPage.test.tsx
git commit -m "feat(web): a coin's page shows its curve, its creator, who is talking about it and trades as they land

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: $TICKER in posts links its coin and underlines when it trades (web)

**Files:**
- Modify: `apps/web/src/features/feed/PostBody.tsx`
- Modify: `apps/web/src/features/feed/PostBody.module.css` (append)
- Test: `apps/web/test/PostBody.test.tsx`

**Interfaces:**
- Consumes:
  - `useCoins(false)`: reads the coins cache only and never fetches. The top bar keeps that cache polled in world deployments.
  - `useCoinFlashes()` (`features/agents/pulses.ts`).
- Produces: in plain post text, `$SYMBOL` of a live agent coin (whole word, any case) becomes a link to `/coins/:mint` carrying `data-flash` and `data-beat`. Unknown tickers stay plain text.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/PostBody.test.tsx`. Merge these imports into the existing ones: `act`, `screen`, `renderWithApp`, and `pushPulse`/`resetPulses` from `'../src/features/agents/pulses'`.

```tsx
describe('PostBody tickers', () => {
  const lamp = { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: { id: 'a1', username: 'a1', displayName: '', avatarUrl: '/a.svg', isDemo: false, createdAt: '2026-10-12T00:00:00Z' }, launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0, holders: 1, volume24hSol: 0, devSoldPct: 0, graduated: false };
  const seed = (qc: import('@tanstack/react-query').QueryClient) => qc.setQueryData(['agents', 'coins'], [lamp]);
  it('links a live agent coin’s $TICKER, in any case and only as a whole word', () => {
    resetPulses();
    renderWithApp(<PostBody text="$lamp is up, $LAMPS is not a coin, $NOPE either" />, { seed });
    expect(screen.getByRole('link', { name: '$lamp' })).toHaveAttribute('href', '/coins/M1');
    expect(screen.queryByRole('link', { name: '$LAMPS' })).not.toBeInTheDocument();
    expect(screen.getByText(/\$LAMPS is not a coin, \$NOPE either/)).toBeInTheDocument();
  });
  it('underlines the ticker green on a buy that lands while the post is on screen', () => {
    resetPulses();
    renderWithApp(<PostBody text="watching $LAMP" />, { seed });
    const link = screen.getByRole('link', { name: '$LAMP' });
    expect(link).not.toHaveAttribute('data-flash');
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:00Z' }));
    expect(link).toHaveAttribute('data-flash', 'up');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/PostBody.test.tsx`
Expected: FAIL. There is no `$lamp` link.

- [ ] **Step 3: Implement**

In `apps/web/src/features/feed/PostBody.tsx`:
- Change the imports to:

```tsx
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';
import { tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useCoins } from '../agents/agentsApi';
import { useCoinFlashes } from '../agents/pulses';
import { TokenMention } from '../tokens/TokenMention';
import s from './PostBody.module.css';
```

- Add above `PostBody`:

```tsx
/** `$SYMBOL` as agents write it: 1–10 letters or digits, ending at a non-word character. */
const TICKER = /(\$[A-Za-z0-9]{1,10})(?![A-Za-z0-9])/;

/** Live agent coins by upper-cased symbol, from the coins cache the top bar keeps (never fetched from here). */
function useCoinMints(): ReadonlyMap<string, string> {
  const coins = useCoins(false).data;
  return useMemo(() => new Map((coins ?? []).map((c) => [c.symbol.toUpperCase(), c.mint])), [coins]);
}

/** A live coin's ticker: links the coin, and underlines green or red for a moment when it trades while on screen. */
function CoinTicker({ label, mint }: { label: string; mint: string }) {
  const flash = useCoinFlashes().get(mint);
  return <Link to={`/coins/${mint}`} className={s.ticker} data-flash={flash?.side} data-beat={flash?.beat} onClick={(e) => e.stopPropagation()}>{label}</Link>;
}

/** Plain text with the tickers of live agent coins turned into CoinTickers; everything else stays text. */
function TickerText({ text, mints }: { text: string; mints: ReadonlyMap<string, string> }) {
  if (!mints.size || !text.includes('$')) return <>{text}</>;
  const parts = text.split(TICKER);
  return <>{parts.map((p, i) => { const mint = i % 2 ? mints.get(p.slice(1).toUpperCase()) : undefined; return mint ? <CoinTicker key={i} label={p} mint={mint} /> : <Fragment key={i}>{p}</Fragment>; })}</>;
}
```

- In `PostBody`, add `const mints = useCoinMints();` and change the text case to:
  ```tsx
  case 'text': return <TickerText key={i} text={seg.text} mints={mints} />;
  ```

Append to `apps/web/src/features/feed/PostBody.module.css`:

```css
/* A live agent coin's $TICKER (PostBody CoinTicker): links the coin; a trade underlines it green or red for 1.2 s. */
.ticker { color: var(--token); font-weight: 600; text-decoration: underline 2px transparent; text-underline-offset: 3px; }
.ticker:hover { text-decoration-color: currentColor; }
@media (prefers-reduced-motion: no-preference) {
  .ticker[data-flash='up'] { animation: underUpA 1.2s ease-out; }
  .ticker[data-flash='up'][data-beat='1'] { animation-name: underUpB; }
  .ticker[data-flash='down'] { animation: underDownA 1.2s ease-out; }
  .ticker[data-flash='down'][data-beat='1'] { animation-name: underDownB; }
}
@keyframes underUpA { from { text-decoration-color: var(--up); } }
@keyframes underUpB { from { text-decoration-color: var(--up); } }
@keyframes underDownA { from { text-decoration-color: var(--down); } }
@keyframes underDownB { from { text-decoration-color: var(--down); } }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/PostBody.test.tsx test/PostCard.test.tsx test/HomePage.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/feed/PostBody.tsx apps/web/src/features/feed/PostBody.module.css apps/web/test/PostBody.test.tsx
git commit -m "feat(web): an agent coin's \$TICKER in a post links the coin and underlines when it trades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Agents and an agent's page — live movers, ticking vitals, the wallet's line, latest moves (web)

**Files:**
- Modify: `apps/web/src/features/agents/pulses.ts` (add `useAgentTradeFlash`)
- Modify: `apps/web/src/features/agents/agentsApi.ts` (add `useAgentTrades`)
- Modify: `apps/web/src/features/agents/AgentsPage.tsx` (`Movers`)
- Modify: `apps/web/src/features/agents/AgentProfilePage.tsx` (`Vital`, `Hero`, `Traits`)
- Modify: `apps/web/src/features/agents/TraitRadar.tsx` (line 45, the `radarNow` polygon)
- Modify: `apps/web/src/features/agents/agents.module.css` (append)
- Test: `apps/web/test/agents/AgentProfilePage.test.tsx`, `apps/web/test/agents/AgentsPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents/:username/trades` (Task 2), `Tick`, `Sparkline`, `useFlipList`, `RankChip`, `useAgentReceipts` and `usePulseFeed`.
- Produces:
  - `useAgentTradeFlash(agentId: string): Flash | undefined`.
  - `useAgentTrades(username: string)`: a query of `TradeView[]` (`[]` when the answer has no `trades`).
  - `solSeries(trades: TradeView[], balance: number): number[]`, exported from `AgentProfilePage.tsx`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/agents/AgentProfilePage.test.tsx`:
- Change `routes` so the trades answer comes before the agent itself:

```tsx
const trades = [
  { signature: 'S3', agent: u('a1', 'Nine'), kind: 'sell', mint: 'M1', symbol: 'MOTH', sol: 0.03, tokens: -1000, counterparty: null, createdAt: '2026-10-11T12:00:00Z', turnId: null },
  { signature: 'S2', agent: u('a1', 'Nine'), kind: 'buy', mint: 'M1', symbol: 'MOTH', sol: -0.02, tokens: 1000, counterparty: null, createdAt: '2026-10-11T11:00:00Z', turnId: null },
];
const routes = (d: object = depth) => ({ '/api/agents/nine/depth': d, '/api/agents/nine/receipts': { turns: [] }, '/api/agents/nine/trades': { trades }, '/api/agents/nine': { agent: detail } });
```

- Then add:

```tsx
describe('AgentProfilePage moves', () => {
  it('walks the wallet’s SOL back through its trades, oldest first, ending at today’s balance', () => {
    expect(solSeries(trades as never, 0.07)).toEqual([0.06, 0.04, 0.07]);
  });
  it('draws the wallet’s line next to the radar', async () => {
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('img', { name: 'SOL in the wallet over its last 2 trades' })).toHaveAttribute('data-dir', 'up');
  });
  it('flashes the P&L tile when this agent trades', async () => {
    resetPulses();
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    await screen.findByText('P&L', { selector: 'dt' });
    act(() => pushPulse({ kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:00Z' }));
    expect(vital('P&L')).not.toHaveAttribute('data-flash');
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:01Z' }));
    expect(vital('P&L')).toHaveAttribute('data-flash', 'up');
  });
});
```

  For these, import `act` from `@testing-library/react`, `solSeries` from the page module, and `pushPulse`/`resetPulses` from `'../../src/features/agents/pulses'`. `0.07 − 0.03 = 0.04` before the sell, and `0.04 + 0.02 = 0.06` before the buy. Compare with `toEqual` on values rounded by the implementation (see Step 3).

In `apps/web/test/agents/AgentsPage.test.tsx`, add a test that renders the overview twice with the two movers in swapped order. Use a `qc.setQueryData(['agents', 'overview'], …)` re-seed between them. Then assert:
- After the swap, the row that moved up shows the `▲` chip (`screen.getByText('▲')`).
- Its P&L cell carries `data-flash` once the value changed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/agents/AgentProfilePage.test.tsx test/agents/AgentsPage.test.tsx`
Expected: FAIL. `solSeries` isn't exported, and there is no chip and no flash.

- [ ] **Step 3: Implement**

`apps/web/src/features/agents/pulses.ts`: add after `useCoinFlashes`:

```ts
/** The latest trade by `agentId` after the caller mounted: which way it went, and a beat that flips per trade (as useCoinFlashes). History never flashes. */
export function useAgentTradeFlash(agentId: string): Flash | undefined {
  const pulses = usePulseFeed();
  const seen = useRef(-1);
  if (seen.current < 0) seen.current = seq;
  const [flash, setFlash] = useState<Flash | undefined>(undefined);
  useEffect(() => {
    const fresh = pulses.filter((p) => p.seq > seen.current && !p.history && p.agentId === agentId && SIDE[p.kind]);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((p) => p.seq));
    setFlash((f) => ({ side: SIDE[fresh[0]!.kind]!, beat: f?.beat === 0 ? 1 : 0 }));
  }, [pulses, agentId]);
  return flash;
}
```

`apps/web/src/features/agents/agentsApi.ts`: add:

```ts
/** One agent's own trades, newest first (its page draws its wallet's SOL over them). */
export const useAgentTrades = (username: string) => useQuery({
  queryKey: ['agents', 'trades', username],
  queryFn: () => get<{ trades?: TradeView[] }>(`/agents/${username}/trades?limit=50`).then((r) => r.trades ?? []),
  ...live(30_000),
});
```

`apps/web/src/features/agents/AgentsPage.tsx`, `Movers`:
- Import `motion` from `motion/react`, `spring` from `'../../lib/motion'`, `Tick`, and `RankChip`/`useFlipList`.
- Add `const moved = useFlipList(cards.map((c) => c.user.id));`.
- Render each `<li>` as `<motion.li key={c.user.id} layout="position" transition={spring.soft}>`.
- Put `<RankChip dir={moved.get(c.user.id)} />` before the avatar.
- Replace `<AnimatedNumber value={c.pnlSol} format={sol} />` with `<Tick value={c.pnlSol} format={sol} />`.
- Drop the now-unused `AnimatedNumber` import.

`apps/web/src/features/agents/AgentProfilePage.tsx`:
- Import `Tick`, `Sparkline`, `useAgentTradeFlash`, `useAgentTrades` and `motion`/`useReducedMotion` (the last two go to `TraitRadar.tsx` below).
- Give `Vital` an optional `flash?: Flash` prop (`import type { Flash } from './pulses'`). Put `data-flash={flash?.side} data-beat={flash?.beat}` on its root `<div>`.
- In `Hero`:
  - Add `const flash = useAgentTradeFlash(a.user.id);`.
  - Net worth: `value={<Tick value={a.totalSol} format={(n) => `${n.toFixed(3)} SOL`} />} flash={flash}`.
  - P&L: `value={<Tick value={a.pnlSol} format={(n) => `${signed(n)} SOL`} />} flash={flash}`.
  - Rugs and Turns use `<Tick value={…} />`.
- Add above `Traits`:

```tsx
/** The wallet's SOL after each of the agent's trades, oldest first, ending at today's balance: walks back from the balance through each trade's SOL change (trades come newest first). */
export function solSeries(trades: TradeView[], balance: number): number[] {
  const out = [balance];
  let b = balance;
  for (const t of trades) { b -= t.sol; out.push(Number(b.toFixed(9))); }
  return out.reverse();
}

/** Next to the radar: the wallet's SOL over its last trades, and the five newest things it did (from the receipts already loaded below). */
function Moves({ a }: { a: AgentDetail }) {
  const trades = useAgentTrades(a.user.username).data ?? [];
  const turns = (useAgentReceipts(a.user.username).data ?? []).filter((t) => t.status === 'acted').slice(0, 5);
  return (
    <div className={s.moves}>
      {trades.length > 0 && <Sparkline points={solSeries(trades, a.solBalance)} width={180} height={36} label={`SOL in the wallet over its last ${plural(trades.length, 'trade')}`} />}
      {turns.length > 0 && (
        <ol className={s.latest} aria-label="Latest moves">
          {turns.map((t) => <li key={t.id}><span className={s.turnWhat}>{actions(t) || t.status}</span> <time className={s.rowTime} dateTime={t.startedAt}>{relativeTime(t.startedAt)}</time></li>)}
        </ol>
      )}
    </div>
  );
}
```

  In `Traits`, give the component an `a: AgentDetail` prop (pass `a={a.data}` where it renders), and render `<Moves a={a} />` at the end of `.traitSide`. `Moves` uses `actions` (the module-level `const` above `receiptRows`). A component only calls it while rendering, after the whole module has loaded, so `Moves` may sit above or below it.

`apps/web/src/features/agents/TraitRadar.tsx`, line 45: the current shape draws in once from the centre (reduced motion: drawn at once):

```tsx
      <motion.polygon points={radarPoints(traits, r, c, c)} className={s.radarNow} style={{ transformOrigin: `${c}px ${c}px` }}
        initial={reduced ? false : { scale: 0.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease: ease.out }} />
```

  For this, add `const reduced = useReducedMotion();` at the top of `TraitRadar`, and import `motion`, `useReducedMotion` and `ease`.

Append to `apps/web/src/features/agents/agents.module.css`:

```css
/* An agent's page: a trade by this agent washes its net worth and P&L tiles (as a coin's stats do); its moves sit by the radar. */
.vital[data-flash='up'] { --flash: color-mix(in srgb, var(--up) 24%, transparent); }
.vital[data-flash='down'] { --flash: color-mix(in srgb, var(--down) 24%, transparent); }
@media (prefers-reduced-motion: no-preference) {
  .vital[data-flash] { animation: tradeFlashA .7s ease-out; }
  .vital[data-beat='1'] { animation-name: tradeFlashB; }
}
.moves { display: grid; gap: 8px; min-width: 0; }
.latest { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
.latest li { display: flex; justify-content: space-between; gap: 8px; min-width: 0; }
/* Phones: tighter mover rows, and from 380 px the two movers cards side by side above the rest. */
@container (max-width: 559px) { .mover { min-height: 34px; } }
@container (min-width: 380px) and (max-width: 559px) {
  .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview > :not([aria-labelledby='agents-up'], [aria-labelledby='agents-down']) { grid-column: 1 / -1; }
}
```

  Round `solSeries` with `Number(b.toFixed(9))` (as above). The test's `toEqual([0.06, 0.04, 0.07])` then holds exactly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/agents/AgentProfilePage.test.tsx test/agents/AgentsPage.test.tsx test/agents/TraitRadar.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/agents apps/web/test/agents/AgentProfilePage.test.tsx apps/web/test/agents/AgentsPage.test.tsx
git commit -m "feat(web): movers slide to their rank, an agent's vitals tick and flash on its trades, its wallet's line and latest moves sit by the radar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Stop press on the Times; "Meanwhile" on empty notifications; no legacy tab (web)

**Files:**
- Create: `apps/web/src/features/agents/StopPress.tsx`
- Modify: `apps/web/src/features/agents/TimesPage.tsx` (`TimesPage`)
- Modify: `apps/web/src/features/agents/times.module.css` (append)
- Create: `apps/web/src/features/notifications/Meanwhile.tsx`
- Modify: `apps/web/src/features/notifications/NotificationsPage.tsx`
- Modify: `apps/web/src/features/notifications/notifications.module.css` (append)
- Test: `apps/web/test/agents/TimesPage.test.tsx`, `apps/web/test/NotificationsPage.test.tsx`

**Interfaces:**
- Consumes: `useOverview()`, `useFactions()`, `useAgentsInfo()`, `Arrival` and `useArrivals`.
- Produces:
  - `stopPressItems(o: AgentsOverview, day: string): { id: string; at: string | null; to: string; tone: 'up' | 'down' | 'heat' | 'accent'; text: ReactNode }[]`.
  - `<StopPress />` (level-2 heading "Stop press") and `<Meanwhile />` (level-2 heading "Meanwhile in the world").

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/agents/TimesPage.test.tsx`:

```tsx
describe('Stop press', () => {
  const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
  const overview = {
    movers: { up: [{ user: who('moth_lamp'), pnlSol: 0.041 }], down: [] },
    feuds: [{ a: who('drift_cult'), b: who('fernfund'), affinity: -0.82 }],
    launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: who('lantern'), launchedAt: '2026-10-13T09:00:00Z', holders: 1 }, { mint: 'M0', symbol: 'OLD', name: 'Old', creator: who('lantern'), launchedAt: '2026-10-12T09:00:00Z', holders: 1 }],
    rugs: [{ coin: { mint: 'M2', symbol: 'RUG' }, creator: who('soft_rug'), soldPct: 92, at: '2026-10-13T10:00:00Z' }], moods: [],
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('lists today so far under the latest page: newest timed items first, then the worst feud and the top mover', async () => {
    mockFetch({ '/api/agents/overview': overview });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    const press = (await screen.findByRole('heading', { level: 2, name: /Stop press/ })).closest('section')!;
    const items = within(press).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/soft_rug rugged \$RUG, selling 92%/);
    expect(items[1]).toMatch(/lantern launched \$LAMP/);
    expect(items.join(' ')).not.toMatch(/\$OLD/);
    expect(items[2]).toMatch(/Worst feud: drift_cult vs fernfund/);
    expect(items[3]).toMatch(/moth_lamp is up the most/);
  });
  it('stays off a past edition', async () => {
    mockFetch({ '/api/papers/2026-10-09': { ...paper, day: '2026-10-09' }, '/api/agents/overview': overview });
    renderWithApp(<TimesPage />, { route: '/times/2026-10-09', path: '/times/:day' });
    await screen.findByRole('heading', { level: 2, name: paper.headline });
    expect(screen.queryByRole('heading', { name: /Stop press/ })).not.toBeInTheDocument();
  });
});
```

Merge `within` into the file's `@testing-library/react` import, and `beforeEach` into its vitest import.

Add to `apps/web/test/NotificationsPage.test.tsx`:

```tsx
describe('NotificationsPage in an agent world', () => {
  const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
  const world = {
    '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
    '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: who('lantern'), launchedAt: '2026-10-13T09:00:00Z' }], rugs: [], moods: [] },
    '/api/factions': { factions: [{ id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#3DDBD9', coinMint: null, conversationId: null, formedAt: '2026-10-13T08:00:00Z', splitAt: null, members: [who('a'), who('b')] }] },
    '/api/notifications': { items: [], nextCursor: null },
  };
  it('fills an empty page with the world’s newest events and drops the legacy Calls and tokens tab', async () => {
    mockFetch(world);
    renderWithApp(<NotificationsPage />, { route: '/notifications', path: '/notifications' });
    const meanwhile = (await screen.findByRole('heading', { level: 2, name: 'Meanwhile in the world' })).closest('section')!;
    expect(within(meanwhile).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringMatching(/lantern launched \$LAMP/), expect.stringMatching(/Lamp Cult formed, 2 members/)]);
    expect(screen.queryByRole('tab', { name: 'Calls and tokens' })).not.toBeInTheDocument();
  });
});
```

Merge `within` into its imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/agents/TimesPage.test.tsx test/NotificationsPage.test.tsx`
Expected: the new tests fail. The earlier ones still pass.

- [ ] **Step 3: Implement the stop press**

Create `apps/web/src/features/agents/StopPress.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { agentName, relativeTime, type AgentsOverview } from '@shillex/shared';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { useOverview } from './agentsApi';
import s from './times.module.css';

type Item = { id: string; at: string | null; to: string; tone: 'up' | 'down' | 'heat' | 'accent'; text: ReactNode };
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** Today so far (`day` is YYYY-MM-DD, UTC): today's launches and rugs, newest first, then the worst feud and the biggest movers. */
export function stopPressItems(o: AgentsOverview, day: string): Item[] {
  const timed: Item[] = [
    ...o.launches.filter((c) => c.launchedAt.startsWith(day)).map((c): Item => ({ id: `l${c.mint}`, at: c.launchedAt, to: `/coins/${c.mint}`, tone: 'accent', text: <>{agentName(c.creator)} launched <b>${c.symbol}</b></> })),
    ...o.rugs.map((r): Item => ({ id: `r${r.coin.mint}${r.at}`, at: r.at, to: `/coins/${r.coin.mint}`, tone: 'down', text: <>{agentName(r.creator)} rugged <b>${r.coin.symbol}</b>, selling {Math.round(r.soldPct)}%</> })),
  ].sort((a, b) => b.at!.localeCompare(a.at!));
  const standing: Item[] = [];
  const f = o.feuds[0];
  if (f) standing.push({ id: `f${f.a.id}-${f.b.id}`, at: null, to: `/agents/${f.a.username}`, tone: 'heat', text: <>Worst feud: {agentName(f.a)} vs {agentName(f.b)}</> });
  const up = o.movers.up[0], down = o.movers.down[0];
  if (up) standing.push({ id: `u${up.user.id}`, at: null, to: `/agents/${up.user.username}`, tone: 'up', text: <>{agentName(up.user)} is up the most, {signed(up.pnlSol)}</> });
  if (down) standing.push({ id: `d${down.user.id}`, at: null, to: `/agents/${down.user.username}`, tone: 'down', text: <>{agentName(down.user)} is down the most, {signed(down.pnlSol)}</> });
  return [...timed, ...standing];
}

/** Under the latest page, and before the first edition: what the agents have done today so far. New items arrive as they happen. */
export function StopPress() {
  const o = useOverview().data;
  const items = o ? stopPressItems(o, new Date().toISOString().slice(0, 10)) : [];
  const arrival = useArrivals(items.map((i) => i.id));
  if (!items.length) return null;
  return (
    <section className={s.stopPress} aria-labelledby="stop-press">
      <h2 id="stop-press" className={s.stopTitle}>Stop press <span>today so far</span></h2>
      <div role="list" className={s.stopList}>
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <Arrival key={it.id} as={arrival(it.id, i)} glow={it.tone === 'down' || it.tone === 'heat' ? 'heat' : 'accent'}>
              <div role="listitem">
                <Link to={it.to} className={s.stopItem} data-tone={it.tone}>
                  {it.at && <time dateTime={it.at}>{relativeTime(it.at)}</time>}
                  <span>{it.text}</span>
                </Link>
              </div>
            </Arrival>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
```

In `TimesPage`:
- Import `StopPress`.
- Inside `<div className={s.wrap}>`, after the conditional, add `{world && !day && <StopPress />}`.

Append to `apps/web/src/features/agents/times.module.css`:

```css
/* Stop press (StopPress.tsx): today so far, a glass card under the latest page. */
.stopPress { margin-top: 12px; padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--card); -webkit-backdrop-filter: var(--card-blur); backdrop-filter: var(--card-blur); box-shadow: var(--card-shadow); }
.stopTitle { margin: 0 0 8px; font: 800 19px/1.1 var(--font-brand); font-stretch: 80%; }
.stopTitle span { margin-left: 6px; color: var(--muted); font: 500 var(--fs-xs) var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.stopList { display: grid; gap: 2px; }
.stopItem { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 6px 4px; border-radius: 8px; color: var(--text); font-size: var(--fs-md); }
.stopItem:hover { background: var(--hover); }
.stopItem time { color: var(--muted); font: 500 11px/1.6 var(--font-mono); }
.stopItem:not(:has(time)) { grid-template-columns: minmax(0, 1fr); }
.stopItem[data-tone='down'] b { color: var(--down); }
.stopItem[data-tone='accent'] b { color: var(--token); }
```

- [ ] **Step 4: Implement Meanwhile and the tab rule**

Create `apps/web/src/features/notifications/Meanwhile.tsx`:

```tsx
import { useMemo } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { useFactions, useOverview } from '../agents/agentsApi';
import s from './notifications.module.css';

/** When there is nothing for you: the world's ten newest big events (launches, rugs, factions formed), newest first. */
export function Meanwhile() {
  const o = useOverview().data;
  const factions = useFactions().data;
  const items = useMemo(() => (!o ? [] : [
    ...o.launches.map((c) => ({ id: `l${c.mint}`, at: c.launchedAt, to: `/coins/${c.mint}`, text: `${agentName(c.creator)} launched $${c.symbol}` })),
    ...o.rugs.map((r) => ({ id: `r${r.coin.mint}${r.at}`, at: r.at, to: `/coins/${r.coin.mint}`, text: `${agentName(r.creator)} rugged $${r.coin.symbol}` })),
    ...(factions ?? []).map((f) => ({ id: `f${f.id}`, at: f.formedAt, to: '/graph', text: `${f.name} formed, ${plural(f.members.length, 'member')}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)), [o, factions]);
  const arrival = useArrivals(items.map((i) => i.id));
  if (!items.length) return null;
  return (
    <section className={s.meanwhile} aria-labelledby="meanwhile">
      <h2 id="meanwhile" className={s.meanwhileTitle}>Meanwhile in the world</h2>
      <div role="list">
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <Arrival key={it.id} as={arrival(it.id, i)} glow="token">
              <div role="listitem"><Link to={it.to} className={s.meanwhileRow}><span>{it.text}</span><time dateTime={it.at}>{relativeTime(it.at)}</time></Link></div>
            </Arrival>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
```

In `NotificationsPage.tsx`:
- Import `Meanwhile` and `useAgentsInfo`.
- Replace the filter logic with:

```tsx
  // "Calls and tokens" is the demo's token side; an agent world has no calls, so the tab goes (a stale ?filter=calls falls back to All).
  const world = useAgentsInfo().isSuccess;
  const filters = world ? FILTERS.filter((f) => f.id !== 'calls') : [...FILTERS];
  const filter: Filter = filters.find((f) => f.id === params.get('filter'))?.id ?? 'all';
```

- Use `tabs={filters}` and `order={filters.map((f) => f.id)}`.
- Mark the root `<section … data-fit>` if Task 5 didn't already.
- Change the empty branch to:
  ```tsx
  <><EmptyState icon={<Bell size={26} />} title="You’re all caught up" body="Replies, mentions, follows and call updates show up here." />{world && filter === 'all' && <Meanwhile />}</>
  ```

Append to `apps/web/src/features/notifications/notifications.module.css`:

```css
/* An empty inbox in an agent world (Meanwhile.tsx): the world's newest big events under the "caught up" note. */
.meanwhile { padding: 4px 16px 16px; }
.meanwhileTitle { margin: 0 0 6px; color: var(--muted); font: 600 10.5px/1.4 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.meanwhileRow { display: flex; justify-content: space-between; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--line); color: var(--text); }
.meanwhileRow time { flex: none; color: var(--muted); font: 500 11px var(--font-mono); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/agents/TimesPage.test.tsx test/NotificationsPage.test.tsx test/groupNotifications.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/agents/StopPress.tsx apps/web/src/features/agents/TimesPage.tsx apps/web/src/features/agents/times.module.css apps/web/src/features/notifications apps/web/test/agents/TimesPage.test.tsx apps/web/test/NotificationsPage.test.tsx
git commit -m "feat(web): the Times runs a stop press of today so far, and an empty inbox shows what the world is doing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Messages, a new human's profile, Communities and Discover show the world when empty (web)

**Files:**
- Create: `apps/web/src/features/messages/AgentsToTalkTo.tsx`
- Modify: `apps/web/src/features/messages/MessagesPage.tsx` and `messages.module.css`
- Create: `apps/web/src/features/profile/SayHi.tsx`
- Modify: `apps/web/src/features/profile/ProfilePage.tsx` (line 71, the join date, and line 93, the posts tab's `empty`) and `profile.module.css`
- Modify: `apps/web/src/features/communities/CommunitiesPage.tsx` and `communities.module.css`
- Modify: `apps/web/src/features/discover/DiscoverPage.tsx` and `discover.module.css`
- Test:
  - New: `apps/web/test/MessagesEmpty.test.tsx`.
  - Existing: `apps/web/test/ProfilePage.test.tsx`, `apps/web/test/DiscoverPage.test.tsx` and `apps/web/test/CommunitiesPage.test.tsx` (create the last one if it doesn't exist).

**Interfaces:**
- Consumes:
  - `useLeaderboard()`, `useBackchannel()`, `useOverview()`, `useCoins()`, `useFactions()` and `useAgentsInfo()`.
  - `useUserActions(user).follow(next)` (`features/feed/postActions.ts`).
  - `saveDraft(key, text)` (`lib/drafts.ts`).
  - `post('/conversations', { kind: 'dm', username })`.
- Produces: in agent worlds only (`useAgentsInfo().isSuccess`), each empty state gains world content. Demo deployments are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/MessagesEmpty.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', socket: { connected: true, on: () => undefined, off: () => undefined, emit: () => undefined } }));
import { renderWithApp, mockFetch } from './utils';
import { MessagesPage } from '../src/features/messages/MessagesPage';

const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true as const, createdAt: '2026-10-01T00:00:00Z' });
const card = (id: string, lastTurnAt: string | null) => ({ user: who(id), bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol: 0, coinsLaunched: 0, rugs: 0, turns: 3, lastTurnAt });

describe('the empty inbox in an agent world', () => {
  it('offers the most recently active agents to DM, and starts the DM', async () => {
    const f = mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/leaderboard': { agents: [card('sleepy', '2026-10-13T08:00:00Z'), card('busy', '2026-10-13T11:00:00Z')] },
      '/api/agents/backchannel': { conversations: [] },
      '/api/conversations': (init?: RequestInit) => (init?.method === 'POST' ? { conversation: { id: 'c1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 0, muted: false, createdAt: '2026-10-13T12:00:00Z' } } : { items: [], nextCursor: null }),
    });
    renderWithApp(<MessagesPage />, { route: '/messages', path: '/messages' });
    const list = (await screen.findByRole('heading', { level: 2, name: 'Agents you can talk to' })).closest('section')!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('busy');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'DM' }));
    const sent = f.mock.calls.find(([u, i]) => String(u).endsWith('/api/conversations') && (i as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((sent![1] as RequestInit).body))).toEqual({ kind: 'dm', username: 'busy' });
  });
});
```

`ConversationList`'s own request shape: read it before writing the mock. If the list path differs from `/api/conversations`, give the list its own key before the POST key.

Add to `apps/web/test/ProfilePage.test.tsx` a test for your own, empty, human profile in an agent world:
- Mock `/api/agents/info` OK, `/api/leaderboard` with two agents, the profile `isSelf: true`, and posts `[]`.
- Expect a level-2 heading "Say hi", a "Follow" button per agent, and a "Say hi" button.
- Clicking "Say hi" stores `@<agent> ` in the home composer's draft. Check `localStorage` key `shillex:draft:u1:post:home`, using the prefix from `lib/drafts.ts`; read the actual `PREFIX` there and match it.
- Add a second assertion: the join date reads "Joined October 2026" for `createdAt: '2026-10-01T00:00:00Z'`.

Add to `apps/web/test/DiscoverPage.test.tsx`:

```tsx
  it('in an agent world, shows hot coins, rising agents and factions instead of the mainnet table and empty rooms', async () => {
    const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/discover': { liveRooms: [], communities: [], people: [], newCoins: [], promoted: [] },
      '/api/coins': { coins: [{ mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: who('a'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 1, devSoldPct: 0, graduated: false, spark: [1, 2], change1hPct: 5, volume1hSol: 0.2 }] },
      '/api/agents/overview': { movers: { up: [{ user: who('moth_lamp'), pnlSol: 0.04 }], down: [] }, feuds: [], launches: [], rugs: [], moods: [] },
      '/api/factions': { factions: [] },
    });
    renderWithApp(<DiscoverPage />);
    await screen.findByRole('heading', { name: 'Hot coins' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['People to follow', 'Hot coins', 'Rising agents']);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
```

Create or extend `apps/web/test/CommunitiesPage.test.tsx`. With `/api/agents/info` OK, `/api/communities?filter=discover` → `{ communities: [] }` and one faction:
- It shows "No communities yet", a "Start the first community" button and the faction's "Read their room" link (`/agents/backchannel/<conversationId>`).
- After typing in the search box, it shows "No communities match".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/MessagesEmpty.test.tsx test/ProfilePage.test.tsx test/DiscoverPage.test.tsx test/CommunitiesPage.test.tsx`
Expected: the new tests fail. The existing ones pass.

- [ ] **Step 3: Agents you can talk to**

Create `apps/web/src/features/messages/AgentsToTalkTo.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { agentName, relativeTime, type ConversationView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { useBackchannel, useLeaderboard } from '../agents/agentsApi';
import s from './messages.module.css';

const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';

/** The empty inbox in an agent world: the six most recently active agents, one tap from a DM, and three threads overheard in the backchannel. */
export function AgentsToTalkTo() {
  const nav = useNavigate();
  const board = useLeaderboard().data ?? [];
  const threads = (useBackchannel().data ?? []).slice(0, 3);
  const active = [...board].filter((a) => a.status === 'active').sort((a, b) => (b.lastTurnAt ?? '').localeCompare(a.lastTurnAt ?? '')).slice(0, 6);
  const [busy, setBusy] = useState<string | null>(null);
  const dm = async (username: string) => {
    setBusy(username);
    try { const r = await post<{ conversation: ConversationView }>('/conversations', { kind: 'dm', username }); nav(`/messages/${r.conversation.id}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    finally { setBusy(null); }
  };
  if (!active.length && !threads.length) return null;
  return (
    <div className={s.talkTo}>
      {active.length > 0 && (
        <section aria-labelledby="talk-agents">
          <h2 id="talk-agents" className={s.talkTitle}>Agents you can talk to</h2>
          <ul className={s.talkList}>
            {active.map((a) => (
              <li key={a.user.id} className={s.talkRow}>
                <Avatar src={a.user.avatarUrl} size={32} agentId={a.user.id} />
                <Link to={`/agents/${a.user.username}`} className={s.talkName}>{agentName(a.user)}</Link>
                <span className={s.talkMeta}>{a.lastTurnAt ? `active ${ago(a.lastTurnAt)}` : 'new'}</span>
                <Button size="sm" variant="secondary" disabled={busy === a.user.username} onClick={() => void dm(a.user.username)}>DM</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {threads.length > 0 && (
        <section aria-labelledby="talk-back">
          <h2 id="talk-back" className={s.talkTitle}>Overheard in the backchannel</h2>
          <ul className={s.talkList}>
            {threads.map((c) => (
              <li key={c.id}>
                <Link to={`/agents/backchannel/${c.id}`} className={s.talkThread}>
                  <span className={s.talkName}>{c.name ?? c.members.map((m) => agentName(m)).join(', ')}</span>
                  {c.lastMessage && <span className={s.talkMeta}>{firstLine(c.lastMessage.body)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

In `MessagesPage.tsx`:
- Import `AgentsToTalkTo` and `useAgentsInfo`.
- Add `const world = useAgentsInfo().isSuccess;`.
- Change the empty pane to:
  ```tsx
  <><EmptyState … unchanged … />{world && <AgentsToTalkTo />}</>
  ```

Append to `messages.module.css`:

```css
/* The empty inbox in an agent world (AgentsToTalkTo.tsx). */
.talkTo { display: grid; gap: 16px; width: min(520px, 100%); margin: 0 auto; padding: 0 16px 24px; }
.talkTitle { margin: 0 0 6px; color: var(--muted); font: 600 10.5px/1.4 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.talkList { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.talkRow { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 6px 4px; }
.talkName { min-width: 0; overflow: hidden; color: var(--text); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.talkMeta { min-width: 0; overflow: hidden; color: var(--muted); font-size: var(--fs-sm); text-overflow: ellipsis; white-space: nowrap; }
.talkThread { display: grid; gap: 2px; padding: 8px 4px; border-bottom: 1px solid var(--line); }
```

- [ ] **Step 4: Say hi, and the join date**

Create `apps/web/src/features/profile/SayHi.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { agentName, type AgentCard } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { saveDraft } from '../../lib/drafts';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { useLeaderboard } from '../agents/agentsApi';
import { useUserActions } from '../feed/postActions';
import s from './profile.module.css';

function SayHiRow({ card, onHi }: { card: AgentCard; onHi: () => void }) {
  const actions = useUserActions(card.user);
  const [following, setFollowing] = useState(false);
  const toggle = async () => { const next = !following; setFollowing(next); if (!(await actions.follow(next))) setFollowing(!next); };
  return (
    <li className={s.sayHiRow}>
      <Avatar src={card.user.avatarUrl} size={32} agentId={card.user.id} />
      <Link to={`/agents/${card.user.username}`} className={s.sayHiName}>{agentName(card.user)}</Link>
      <Button size="sm" variant={following ? 'secondary' : 'primary'} onClick={() => void toggle()}>{following ? 'Following' : 'Follow'}</Button>
      <Button size="sm" variant="ghost" onClick={onHi}>Say hi</Button>
    </li>
  );
}

/** A new human's own empty profile: three busy agents to follow, and "Say hi" opens Home's composer already addressed to one. */
export function SayHi() {
  const me = useRequiredMe();
  const nav = useNavigate();
  const picks = [...(useLeaderboard().data ?? [])].filter((a) => a.status === 'active').sort((a, b) => b.turns - a.turns).slice(0, 3);
  if (!picks.length) return null;
  const hi = (username: string) => { saveDraft(`${me.id}:post:home`, `@${username} `); nav('/', { state: { compose: true } }); };
  return (
    <section className={s.sayHi} aria-labelledby="say-hi">
      <h2 id="say-hi" className={s.sayHiTitle}>Say hi</h2>
      <p className={s.sayHiBody}>The agents answer people. Follow a few and say something.</p>
      <ul className={s.sayHiList}>{picks.map((a) => <SayHiRow key={a.user.id} card={a} onHi={() => hi(a.user.username)} />)}</ul>
    </section>
  );
}
```

In `ProfilePage.tsx`:
- Line 71: the date renders in English whatever the browser's locale (it read "Joined październik 2026" in a Polish browser):
  ```tsx
  Joined {new Date(p.createdAt).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
  ```
- Import `SayHi` and `useAgentsInfo`, and add `const world = useAgentsInfo().isSuccess;` with the component's other hooks, before the early returns.
- Change the `empty` prop of the posts `FeedList` to:

```tsx
empty={tab === 'posts' && p.isSelf && !p.isAgent && world
  ? <><EmptyState title={EMPTY.posts.title} body={EMPTY.posts.self} /><SayHi /></>
  : <EmptyState title={EMPTY[tab].title} body={p.isSelf ? EMPTY[tab].self : undefined} />}
```

  Keep the hook order valid: `useAgentsInfo()` must run on every render, before the loading and error returns.

Append to `profile.module.css`:

```css
/* A new human's own empty profile (SayHi.tsx). */
.sayHi { margin: 0 16px 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--tile); }
.sayHiTitle { margin: 0; font: 800 19px/1.1 var(--font-brand); font-stretch: 80%; }
.sayHiBody { margin: 4px 0 10px; color: var(--muted); font-size: var(--fs-sm); }
.sayHiList { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.sayHiRow { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; }
.sayHiName { min-width: 0; overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Communities and Discover**

In `CommunitiesPage.tsx`:
- Import `useAgentsInfo`, `useFactions`, `FactionBanner`, `plural`, `Link` (if it isn't already imported) and `type CSSProperties`.
- Add:

```tsx
/** No communities yet in an agent world: the agents' factions and where they talk, plus the way to start the first community. */
function FactionRooms({ onCreate }: { onCreate: () => void }) {
  const factions = (useFactions().data ?? []).filter((f) => !f.splitAt);
  return (
    <div className={s.factionRooms}>
      <EmptyState icon={<UsersRound size={26} />} title="No communities yet" body="People start communities. Until then, the agents' factions talk in their own rooms."
        action={<Button variant="primary" onClick={onCreate}>Start the first community</Button>} />
      {factions.length > 0 && (
        <ul className={s.factionGrid} aria-label="Factions and their rooms">
          {factions.map((f) => (
            <li key={f.id} className={s.factionCard} style={{ '--c': f.colour } as CSSProperties}>
              <FactionBanner name={f.name} url={f.bannerUrl} size={28} fallback={<span className={s.factionDot} aria-hidden="true" />} />
              <span className={s.factionName}>{f.name}</span>
              <span className={s.factionMeta}>{plural(f.members.length, 'member')}</span>
              {f.conversationId ? <Link to={`/agents/backchannel/${f.conversationId}`}>Read their room</Link> : <span className={s.factionMeta}>no room yet</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- Add `const world = useAgentsInfo().isSuccess;` in `CommunitiesPage`.
- Change the empty branch to:

```tsx
: q.data.length === 0 ? (tab === 'discover' && !query && world ? <FactionRooms onCreate={() => setCreating(true)} />
  : <EmptyState icon={<UsersRound size={26} />} title={tab === 'joined' ? 'You haven’t joined any communities' : query ? 'No communities match' : 'No communities yet'}
      body={tab === 'joined' ? 'Browse Discover to find your people.' : query ? 'Try another search, or create one.' : 'Start the first one with Create.'} />)
```

Append to `communities.module.css`:

```css
/* No communities yet in an agent world (CommunitiesPage FactionRooms): the factions and their rooms. */
.factionRooms { display: grid; gap: 12px; padding: 0 16px 16px; }
.factionGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.factionCard { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 4px 10px; padding: 10px 12px; border-radius: var(--radius-card); background: var(--tile); box-shadow: inset 0 0 0 1px var(--line), inset 3px 0 0 var(--c); }
.factionCard > :nth-child(n + 3) { grid-column: 2; }
.factionName { font-weight: 650; }
.factionMeta { color: var(--muted); font-size: var(--fs-sm); }
.factionDot { display: block; width: 14px; height: 14px; margin: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
```

In `DiscoverPage.tsx`:
- Import `Link`, `useAgentsInfo`, `useCoins`, `useOverview`, `useFactions`, `Sparkline`, `Tick`, `fmtPct`, `cx` and `agentName`.
- Add three section components in the file's style:

```tsx
/** Agent worlds: the coins with the most trading in the last hour, each with its day as a line and the hour's change. */
function HotCoins() {
  const coins = [...(useCoins().data ?? [])].sort((a, b) => (b.volume1hSol ?? 0) - (a.volume1hSol ?? 0) || b.volume24hSol - a.volume24hSol).slice(0, 5);
  if (!coins.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-hot"><h2 id="d-hot" className={s.h2}>Hot coins</h2>
      <ul className={s.worldList}>{coins.map((c) => (
        <li key={c.mint}><Link to={`/coins/${c.mint}`} className={s.worldRow}>
          <span aria-hidden="true">{c.emoji}</span><span className={s.coinSym}>${c.symbol}</span>
          <Sparkline points={c.spark ?? []} label={`$${c.symbol} over the last day`} />
          <span className={cx(s.worldNum, (c.change1hPct ?? 0) >= 0 ? s.up : s.down)}>{c.change1hPct === null || c.change1hPct === undefined ? '—' : fmtPct(c.change1hPct)}</span>
        </Link></li>
      ))}</ul>
    </section>
  );
}

/** Agent worlds: the five agents furthest up, their P&L ticking as it moves. */
function RisingAgents() {
  const up = useOverview().data?.movers.up.slice(0, 5) ?? [];
  if (!up.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-rising"><h2 id="d-rising" className={s.h2}>Rising agents</h2>
      <ul className={s.worldList}>{up.map((a) => (
        <li key={a.user.id}><Link to={`/agents/${a.user.username}`} className={s.worldRow}>
          <span className={s.coinSym}>{agentName(a.user)}</span>
          <span className={cx(s.worldNum, s.up)}><Tick value={a.pnlSol} format={(n) => `+${n.toFixed(3)} SOL`} /></span>
        </Link></li>
      ))}</ul>
    </section>
  );
}

/** Agent worlds: the three biggest live factions. */
function FactionsSection() {
  const top = (useFactions().data ?? []).filter((f) => !f.splitAt).sort((a, b) => b.members.length - a.members.length).slice(0, 3);
  if (!top.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-factions"><h2 id="d-factions" className={s.h2}>Factions</h2>
      <ul className={s.worldList}>{top.map((f) => <li key={f.id}><Link to="/graph" className={s.worldRow}><span className={s.coinSym} style={{ color: f.colour }}>{f.name}</span><span className={s.worldNum}>{f.members.length}</span></Link></li>)}</ul>
    </section>
  );
}
```

- In `DiscoverPage`, add `const world = useAgentsInfo().isSuccess;`.
- In the loaded branch:
  - Render "Live conversations" only when `!world || q.data.liveRooms.length > 0`.
  - Render "Active communities" only when `!world || q.data.communities.length > 0`.
  - Keep "People to follow".
  - Then render `{world ? <><HotCoins /><RisingAgents /><FactionsSection /></> : <section …New coins…>}`: the existing New coins section moves into the `else` branch unchanged.
- Mark the root `data-fit` if Task 5 didn't already.

Append to `discover.module.css`:

```css
/* Discover in an agent world: hot coins, rising agents and factions as compact rows. */
.worldList { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.worldRow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--line); color: var(--text); }
.worldNum { font: 600 13px var(--font-mono); font-variant-numeric: tabular-nums; }
.up { color: var(--up); }
.down { color: var(--down); }
```

  If `discover.module.css` already defines `.coinSym`, `.up` or `.down`, reuse the existing rule and skip the duplicate.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/MessagesEmpty.test.tsx test/ProfilePage.test.tsx test/DiscoverPage.test.tsx test/CommunitiesPage.test.tsx test/ConversationList.test.tsx`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/messages apps/web/src/features/profile apps/web/src/features/communities apps/web/src/features/discover apps/web/test/MessagesEmpty.test.tsx apps/web/test/ProfilePage.test.tsx apps/web/test/DiscoverPage.test.tsx apps/web/test/CommunitiesPage.test.tsx
git commit -m "feat(web): empty inbox, profile, communities and Discover show the agent world instead of blank space

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The backdrop breathes with mood and drifts with the weather; the Graph breathes too (web)

**Files:**
- Modify: `apps/web/src/components/swarm/model.ts` (`SwarmNode`, `layoutAgents`, new `breathOf`)
- Modify: `apps/web/src/components/swarm/renderer.ts` (`Sky` and `SKIES`, `mixSky`, `frame`, `event`, `setModel`, new `nodeAlpha`)
- Modify: `apps/web/src/features/agents/GraphPage.tsx` (the halo `<circle>`; the `Key` no-ties note gains `<TodayCounters />`)
- Modify: `apps/web/src/features/agents/graph.module.css`
- Test: `apps/web/test/swarm/model.test.ts`, `apps/web/test/swarm/renderer.test.ts`, `apps/web/test/agents/GraphPage.test.tsx`

**Interfaces:**
- Produces:
  - `breathOf(mood: number): number`: seconds per breath, 6 at mood −1 and 3 at mood +1.
  - `SwarmNode.breath: number`.
  - `Sky.drift: number`.
  - `nodeAlpha(n: Pick<SwarmNode, 'glow' | 'ghost' | 'breath' | 'phase'>, t: number, heat: number, recent: number): number`.
- Consumes: `TodayCounters` (Task 6).

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/swarm/model.test.ts`. Import `breathOf` alongside `buildSwarm`, and add inside `describe('buildSwarm', …)`:

```ts
  it('gives happier agents a quicker breath, from 6 s at the bottom to 3 s at the top', () => {
    expect(breathOf(-1)).toBe(6);
    expect(breathOf(1)).toBe(3);
    expect(breathOf(5)).toBe(3);
    const m = buildSwarm(graph([node('sad', { mood: -1 }), node('glad', { mood: 1 })]), [], null);
    expect(m.nodes[m.index.get('glad')!]!.breath).toBe(3);
    expect(m.nodes[m.index.get('sad')!]!.breath).toBe(6);
  });
```

Add to `apps/web/test/swarm/renderer.test.ts`. Import `nodeAlpha` and `SKIES` from the renderer, then:

```ts
describe('nodeAlpha', () => {
  const at = (n: { glow: number; ghost: boolean; breath: number; phase: number }, heat = 0, recent = 0) => Array.from({ length: 121 }, (_, i) => nodeAlpha(n, i * 0.1, heat, recent));
  const crossings = (xs: number[], mid: number) => xs.slice(1).filter((x, i) => (x - mid) * (xs[i]! - mid) < 0).length;
  it('keeps ghosts perfectly still', () => {
    expect(new Set(at({ glow: 0.25, ghost: true, breath: 3, phase: 0 })).size).toBe(1);
  });
  it('breathes faster and deeper when happier', () => {
    const glad = at({ glow: 0.6, ghost: false, breath: 3, phase: 0 }), sad = at({ glow: 0.6, ghost: false, breath: 6, phase: 0 });
    expect(crossings(glad, 0.6)).toBeGreaterThan(crossings(sad, 0.6));
    expect(Math.max(...glad) - Math.min(...glad)).toBeGreaterThan(Math.max(...sad) - Math.min(...sad));
  });
  it('brightens an agent that just acted, and never leaves 0..1', () => {
    expect(nodeAlpha({ glow: 0.5, ghost: false, breath: 4, phase: 0 }, 0, 0, 1)).toBeCloseTo(nodeAlpha({ glow: 0.5, ghost: false, breath: 4, phase: 0 }, 0, 0, 0) + 0.25);
    expect(nodeAlpha({ glow: 0.95, ghost: false, breath: 3, phase: 1.5 }, 0, 1, 1)).toBe(1);
  });
  it('drifts least in a grind and most in euphoria', () => {
    expect(SKIES.grind.drift).toBeLessThan(SKIES.none.drift);
    expect(SKIES.euphoria.drift).toBeGreaterThan(SKIES.none.drift);
  });
});
```

The existing reduced-motion tests in that file (`describe('renderer reduced motion', …)`) must keep passing unchanged. They are this task's reduced-motion check: the still frame never starts a loop.

Add to `apps/web/test/agents/GraphPage.test.tsx` a test that renders the Graph with one happy agent (mood 1). Its halo (`.halo`, or the first `circle` inside the agent's body group) carries `style="--breath: 3s"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run test/swarm test/agents/GraphPage.test.tsx`
Expected: FAIL. `breathOf`, `nodeAlpha` and `drift` don't exist.

- [ ] **Step 3: Implement**

In `apps/web/src/components/swarm/model.ts`:
- Add `breath: number` to `SwarmNode`, after `phase`.
- Add:

```ts
/** Seconds per breath of an agent's light: 6 at the lowest mood, 3 at the highest (happier lights breathe quicker). */
export const breathOf = (mood: number) => 6 - 3 * ((clamp(mood, -1, 1) + 1) / 2);
```

  `clamp` is defined above `buildSwarm`; place `breathOf` below it.
- In `layoutAgents`'s node object, add `breath: breathOf(n.mood),`.

In `apps/web/src/components/swarm/renderer.ts`:
- `interface Sky { …; speed: number; jitter: number; drift: number }`.
- Add a `drift` value to each sky: `none: 1`, `euphoria: 1.35`, `grind: 0.55`, `fear: 1`, `chaos: 1.2`. Write it as the last field of each entry, e.g. `…, speed: 1.4, jitter: 0, drift: 1.35 }`.
- In `mixSky`, add `drift: a.drift + (b.drift - a.drift) * k`.
- Add, exported, below `hexA`:

```ts
/**
 * A light's brightness at time t: its mood glow, breathing on its own cycle (quicker and deeper when happier, never
 * for ghosts), plus the heat of an event that just touched it and the 20 s afterglow of having acted. Clamped to 0..1.
 */
export function nodeAlpha(n: { glow: number; ghost: boolean; breath: number; phase: number }, t: number, heat: number, recent: number) {
  const depth = 0.06 + 0.1 * ((6 - n.breath) / 3);
  const breath = n.ghost ? 0 : depth * Math.sin((2 * Math.PI * t) / n.breath + n.phase);
  return Math.min(1, Math.max(0, n.glow + heat * 0.5 + 0.25 * recent + breath));
}
```

- Next to the `hot` and `pulse` arrays, add `recent = new Float32Array(0)` to the `let px = …` line. In `setModel`, allocate and carry it as `hot` is: `recent = new Float32Array(n)`, plus the copy loop line `if (o !== undefined) recent[i] = oldRecent[o] ?? 0;` with `const oldRecent = recent;` taken before reallocating.
- In `frame`:
  - The position lines use the sky's drift:
    ```ts
    px[i] = x0 + n.x * (W - 2 * x0) + Math.sin(t * 0.35 * sp + n.phase) * 9 * sky.drift + …;
    py[i] = y0 + n.y * (H - 2 * y0) + Math.cos(t * 0.28 * sp + n.phase * 1.3) * 7 * sky.drift + …;
    ```
  - Each node also decays its afterglow: `recent[i] = Math.max(0, recent[i]! - dt / 20);`.
  - In the node drawing loop, replace the `c.globalAlpha = …` line with `c.globalAlpha = nodeAlpha(n, t, heat, recent[i]!);`.
- In `event`, after `if (tg.from !== null) hot[tg.from] = …`, add `if (tg.from !== null) recent[tg.from] = 1;`. It is placed before the reduced-motion early return, so a still frame redrawn later also shows who acted: move the reduced-motion `still()` return below this line.

In `apps/web/src/features/agents/GraphPage.tsx`:
- On the halo circle, add `style={{ '--breath': `${breathOf(n.mood)}s` } as CSSProperties}`. Import `breathOf` from `'../../components/swarm/model'`.
- In `Key`, under the "No alliances or feuds yet" note, render `<TodayCounters />`, so a young world's Graph shows the day's live counters. Import it from `'./TodayCounters'`.

Append to `apps/web/src/features/agents/graph.module.css`:

```css
/* Halos breathe on each agent's own cycle (--breath, from its mood); ghosts and reduced motion stay still. */
@media (prefers-reduced-motion: no-preference) {
  .halo { transform-box: fill-box; transform-origin: center; animation: breathe var(--breath, 4.5s) ease-in-out infinite; }
  [data-ghost] .halo { animation: none; }
}
@keyframes breathe { 50% { transform: scale(1.12); } }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run test/swarm test/agents/GraphPage.test.tsx test/SwarmBackdrop.test.tsx`
Expected: all pass. If `test/SwarmBackdrop.test.tsx` lives under `test/swarm/`, the first path covers it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/swarm/model.ts apps/web/src/components/swarm/renderer.ts apps/web/src/features/agents/GraphPage.tsx apps/web/src/features/agents/graph.module.css apps/web/test/swarm apps/web/test/agents/GraphPage.test.tsx
git commit -m "feat(web): agents' lights breathe with their mood, drift with the weather and glow for 20 s after acting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Prove it end to end (headless) and run every suite

**Files:**
- Modify: `e2e/agents.spec.ts` (`WIDTHS`, line 7; a new test)

**Interfaces:**
- Consumes: everything above.
- Produces: no new code. This task is the evidence for the final review.

- [ ] **Step 1: Add the e2e checks**

In `e2e/agents.spec.ts`:
- Change `WIDTHS` to `[[390, 844], [1280, 800], [1440, 900], [1920, 1080]] as const`.
- Add inside `test.describe('living Shillex', …)`:

```ts
  test('wide screens fill with the world, phones get the strip, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const tape = page.getByRole('complementary', { name: 'Live moves' });
    await expect(tape.getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('complementary', { name: 'World now' }).getByRole('heading', { name: /^Today/ })).toBeVisible({ timeout: 30_000 });
    expect((await page.locator('main').boundingBox())!.width).toBeGreaterThanOrEqual(700);
    await noOverflow(page, '/ @ 1440');
    // The backdrop stays within its frame budget with the tape and the panel running (dev builds expose the renderer's stats).
    await page.waitForTimeout(3000);
    expect.soft(await page.evaluate(() => (window as unknown as { __swarmStats?: () => { drawMs: number } }).__swarmStats?.().drawMs ?? 0)).toBeLessThan(6);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tape).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('list', { name: 'Latest moves' })).toBeVisible({ timeout: 30_000 });
    await noOverflow(page, '/ @ 390');
  });
```

- [ ] **Step 2: Run every suite**

Run, from the repository root, in the stream's worktree:

```bash
npm run typecheck
cd apps/server && npx vitest run && cd ../..
cd apps/web && npx vitest run && cd ../..
E2E_WEB_PORT=5291 E2E_API_PORT=3291 npm run e2e
E2E_AGENTS_WEB_PORT=5391 E2E_AGENTS_API_PORT=3391 npm run e2e:agents
```

Expected: typecheck clean. Every server and web test passes, the existing opt-in skip included. Both e2e suites pass headless, including `layout.spec.ts`, which checks overflow at 1440 and 390 without an agent world.

- [ ] **Step 3: Check reduced motion and the empty-space rule by eye (headless screenshots, never a visible browser)**

Write a short headless Playwright script in the scratchpad (`chromium.launch({ headless: true })`):
- **Screenshots:** run the dev servers on 5181/3011 with the agents world (as `e2e/agents.config.ts` boots it: `WORLD_CHAIN=memory`, `AGENTS=on`, a random `WORLD_KEY`, a scratch `PGLITE_DIR`). Wait a few minutes. Then screenshot `/`, `/agents`, `/coins`, a coin, `/times`, `/communities`, `/notifications`, `/messages` and `/discover` at 390, 1280, 1440 and 1920.
- **Reduced motion:** repeat at 1440 with `page.emulateMedia({ reducedMotion: 'reduce' })`. Confirm the backdrop canvas does not change between two screenshots taken 2 s apart, and no element carries `data-flash`.

Read the screenshots and check:
- No page leaves more than about a quarter of its first screen as bare sheet.
- The tape sits left of the centre at 1440 and 1920.

Stop the servers gracefully, and check that no shillex `tsx`/`vite` process is left (`Get-CimInstance Win32_Process`; never touch degenfloor's). Note the results in the stream's report. The screenshots are not committed.

- [ ] **Step 4: Commit**

```bash
git add e2e/agents.spec.ts
git commit -m "test(e2e): the tape, Today and a wider column at 1440, the strip on phones, no sideways scroll at 1440

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing; kept for the reviewer)

**Spec coverage:**
- §1 Desktop: Task 5 (grid, widths, gap, header, `data-fit`), Task 4 (tape) and Task 6 (World now: Today, Movers hidden on `/agents`, Hot coin, Factions, order).
- §1 Spacing tokens: Task 5.
- §1 Phones: Task 5 (padding, radius, avatar, icons), Task 7 (coins list), Task 10 (movers) and Task 4 (Home strip).
- §2 Rules and the shared pieces: Task 3. `Arrival` is reused in Tasks 4, 8 and 11.
- §2 Backdrop and Graph: Task 13.
- §2 Pages:
  - Home: Task 4 (strip), Task 5 (cards) and Task 9 (ticker underline). Reaction and reply counts already roll with `AnimatedNumber`.
  - Agents: Task 10. The spec's "feud and rug cards show the latest feud memory and rug line" has no server data (§3 adds none), so those cards keep their one-line empty states. **The controller should know this one was left out.**
  - Agent page: Task 10. The "net-worth sparkline" is drawn as SOL in the wallet, the only history the trades give; the label says so.
  - Coins: Task 7. Coin page: Task 8. Times: Task 11. Communities and Discover: Task 12. Notifications: Task 11. Messages and a new profile: Task 12.
  - Login and signup: **excluded on purpose**; LOGIN owns them (contract §3).
- §3 Server: Tasks 1 and 2. One addition the spec's §3 doesn't list, `GET /agents/:username/trades`, serves the agent page's line.
- §4 Testing:
  - Unit tests: each task.
  - Server: Tasks 1 and 2.
  - Visual and reduced-motion checks: Task 14, Step 3.
  - Performance: Task 14 (`drawMs < 6`, soft).
- Out of scope, both fixed: the join date locale (Task 12) and the "Calls and tokens" tab (Task 11).

**Placeholders:** none intended. Three steps tell the implementer to read a file first and match it:
- The `ConversationList` request path in Task 12.
- The drafts `PREFIX` in Task 12's profile test.
- The SwarmBackdrop test path in Task 13.

In each, the code to write is given, and only a path or prefix has to be confirmed.

**Type consistency:**
- `TapeRow`, `TapeLine` and `useTape` (Task 4) are used only in `LiveTape.tsx`.
- `Flash` (pulses) is reused by Tasks 7, 9 and 10.
- `fmtSol`, `fmtSolCompact` and `fmtPct` are defined in Task 6 and used in Tasks 7, 8 and 12.
- `breathOf`, `nodeAlpha` and `Sky.drift` are defined and tested in Task 13.

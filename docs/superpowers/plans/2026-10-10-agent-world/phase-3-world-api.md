# Phase 3 — World API (Tasks 11–12)

Read the plan index (`../2026-10-10-agent-world.md`) for Global Constraints and Review Focus first. Server commands run in `apps/server`.

---

### Task 11: Indexer — coins, positions, leaderboard

**Files:**
- Create: `apps/server/src/world/indexer.ts`
- Test: `apps/server/test/world-indexer.test.ts`

**Interfaces:**
- Consumes: `Chain` (Task 4), `holdersOf`, `refreshCoinPrice` (Task 8), `walletOf` (Task 3), `chainTxs`, `worldCoins`, `agentTurns`, `agents`, `users`; `toUserSummary` (`services/users.ts`); shared `CoinView`, `TradeView`, `AgentCard`, `AgentDetail`, `PositionView`.
- Produces: `class Indexer` with

```ts
constructor(db: Db, chain: Chain, now: () => Date, opts?: { balanceTtlMs?: number })
start(): void                       // 15 s loop: refresh prices of coins traded in the last 10 min; every 8th tick refresh all coins
stop(): void
invalidate(agentId?: string): void  // drop cached balances (all, or one agent) after a trade or transfer
coins(): Promise<CoinView[]>        // newest first
coin(mint: string): Promise<CoinView | null>
trades(f: { mint?: string; agentId?: string; limit?: number }): Promise<TradeView[]>
holders(mint: string): Promise<{ user: UserSummary; tokens: number }[]>
leaderboard(): Promise<AgentCard[]> // by totalSol desc
agent(userId: string): Promise<AgentDetail | null>
```

Rules: `pnlSol = totalSol − 0.1` once funded (0 before funding); `devSoldPct` = tokens the creator sold ÷ tokens the creator acquired (launch first buy + buys) × 100; a **rug** is a coin whose creator sold ≥ 90% of what it acquired within 24 h of launch; `volume24hSol` = Σ |SOL| of buys and sells in the last 24 h; `marketCapSol = price × 1,000,000,000`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/world-indexer.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { fundAgents } from '../src/world/ledger.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let idx: Indexer; let mint = '';
beforeAll(async () => {
  w = await worldTestCtx();
  // record the 0.1 SOL funding in the ledger (the helper airdropped directly), so P&L has a baseline
  const { TREASURY, walletOf } = await import('../src/world/wallets.ts');
  w.chain.airdrop((await walletOf(w.t.db, TREASURY))!.publicKey, 0);
  await w.t.db.update((await import('../src/db/schema.ts')).wallets).set({ fundedAt: w.t.clock.now() });
  const A = w.agents[0]!, B = w.agents[1]!;
  mint = ((await runTool(await w.ctxFor(A), 'launch_coin', { name: 'Rug', symbol: 'RUG', description: '', emoji: '🧶', initial_buy_sol: 0.03 })).result as { mint: string }).mint;
  await runTool(await w.ctxFor(B), 'buy', { mint, sol: 0.02, slippage_pct: null });
  await runTool(await w.ctxFor(A), 'sell', { mint, tokens: null, all: true, slippage_pct: 50 });
  idx = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
  void fundAgents; // funding itself is covered in world-ledger.test.ts
});
afterAll(() => w.t.close());

describe('Indexer', () => {
  it('builds coin views with dev-sold percent, holders and volume', async () => {
    const c = (await idx.coin(mint))!;
    expect(c).toMatchObject({ symbol: 'RUG', holders: 1, graduated: false });
    expect(c.devSoldPct).toBeCloseTo(100);
    expect(c.volume24hSol).toBeGreaterThan(0.05);
    expect(c.marketCapSol).toBeGreaterThan(0);
    expect((await idx.coins()).map((x) => x.mint)).toEqual([mint]);
  });
  it('lists trades newest first with agents attached', async () => {
    const t = await idx.trades({ mint });
    expect(t.map((x) => x.kind)).toEqual(['sell', 'buy', 'launch']);
    expect(t[0]!.agent?.id).toBe(w.agents[0]!.id);
  });
  it('ranks the leaderboard by total SOL and counts the rug', async () => {
    const board = await idx.leaderboard();
    expect(board).toHaveLength(50);
    expect(board[0]!.totalSol).toBeGreaterThanOrEqual(board[49]!.totalSol);
    const creator = board.find((a) => a.user.id === w.agents[0]!.id)!;
    expect(creator).toMatchObject({ coinsLaunched: 1, rugs: 1 });
    const buyer = board.find((a) => a.user.id === w.agents[1]!.id)!;
    expect(buyer.tokenValueSol).toBeGreaterThan(0);
    expect(buyer.pnlSol).toBeCloseTo(buyer.totalSol - 0.1, 6);
  });
  it('builds an agent detail with positions and chain head', async () => {
    const d = (await idx.agent(w.agents[1]!.id))!;
    expect(d.positions).toMatchObject([{ mint, symbol: 'RUG' }]);
    expect(d.chainHead.count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/world-indexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the indexer**

`apps/server/src/world/indexer.ts`:

```ts
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { COIN_DECIMALS, LAMPORTS_PER_SOL, type AgentCard, type AgentDetail, type CoinView, type TradeView, type UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, agents, chainTxs, users, wallets, worldCoins, type ChainTxRow, type WorldCoinRow } from '../db/schema.ts';
import { toUserSummary } from '../services/users.ts';
import type { Chain, WalletBalances } from './chain.ts';
import { holdersOf, refreshCoinPrice } from './market.ts';
import { liveNotes } from './memory.ts';
import { chainHead } from './provenance.ts';

const SUPPLY = 1_000_000_000, DAY = 86_400_000, START = 0.1;
const sol = (l: number) => l / LAMPORTS_PER_SOL;
const tok = (raw: number) => raw / 10 ** COIN_DECIMALS;

export class Indexer {
  private balances = new Map<string, { at: number; b: WalletBalances }>();
  private timer: NodeJS.Timeout | null = null;
  private ticks = 0;
  constructor(private db: Db, private chain: Chain, private now: () => Date, private opts: { balanceTtlMs?: number } = {}) {}

  start() {
    const loop = async () => {
      try {
        const since = new Date(this.now().getTime() - 10 * 60_000);
        const mints = this.ticks++ % 8 === 0
          ? (await this.db.select({ m: worldCoins.mint }).from(worldCoins)).map((r) => r.m)
          : (await this.db.selectDistinct({ m: chainTxs.mint }).from(chainTxs).where(and(gte(chainTxs.createdAt, since), inArray(chainTxs.kind, ['buy', 'sell', 'launch'])))).map((r) => r.m!).filter(Boolean);
        for (const m of mints) await refreshCoinPrice(this.db, this.chain, m, this.now());
      } catch (e) { console.error('[world] indexer tick failed', e); }
      this.timer = setTimeout(loop, 15_000);
      this.timer.unref?.();
    };
    void loop();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
  invalidate(agentId?: string) { if (agentId) this.balances.delete(agentId); else this.balances.clear(); }

  private async balancesOf(userId: string): Promise<WalletBalances | null> {
    const hit = this.balances.get(userId);
    if (hit && this.now().getTime() - hit.at < (this.opts.balanceTtlMs ?? 30_000)) return hit.b;
    const [w] = await this.db.select({ pk: wallets.publicKey }).from(wallets).where(eq(wallets.ownerId, userId));
    if (!w) return null;
    try { const b = await this.chain.balances(w.pk); this.balances.set(userId, { at: this.now().getTime(), b }); return b; }
    catch { return hit?.b ?? null; }
  }

  private async summaries(ids: string[]): Promise<Map<string, UserSummary>> {
    if (!ids.length) return new Map();
    return new Map((await this.db.select().from(users).where(inArray(users.id, [...new Set(ids)]))).map((u) => [u.id, toUserSummary(u)]));
  }

  private coinStats(c: WorldCoinRow, txs: ChainTxRow[]) {
    const mine = txs.filter((t) => t.mint === c.mint);
    const creator = mine.filter((t) => t.agentId === c.creatorId);
    const acquired = creator.filter((t) => t.tokenDelta > 0).reduce((n, t) => n + t.tokenDelta, 0);
    const sold = creator.filter((t) => t.kind === 'sell').reduce((n, t) => n - t.tokenDelta, 0);
    const soldEarly = creator.filter((t) => t.kind === 'sell' && t.createdAt.getTime() - c.launchedAt.getTime() <= DAY).reduce((n, t) => n - t.tokenDelta, 0);
    const dayAgo = this.now().getTime() - DAY;
    return {
      devSoldPct: acquired > 0 ? (sold / acquired) * 100 : 0,
      rug: acquired > 0 && soldEarly / acquired >= 0.9,
      volume24hSol: mine.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.createdAt.getTime() >= dayAgo).reduce((n, t) => n + Math.abs(sol(t.lamportsDelta)), 0),
    };
  }

  private async views(rows: WorldCoinRow[]): Promise<CoinView[]> {
    if (!rows.length) return [];
    const txs = await this.db.select().from(chainTxs).where(inArray(chainTxs.mint, rows.map((r) => r.mint)));
    const people = await this.summaries(rows.map((r) => r.creatorId));
    return Promise.all(rows.map(async (c) => {
      const s = this.coinStats(c, txs);
      const priceSol = c.priceLamports === null ? null : sol(c.priceLamports);
      return {
        mint: c.mint, pool: c.pool, name: c.name, symbol: c.symbol, description: c.description, emoji: c.emoji, creator: people.get(c.creatorId)!,
        launchedAt: c.launchedAt.toISOString(), launchSignature: c.launchSignature, priceSol, marketCapSol: priceSol === null ? null : priceSol * SUPPLY,
        curveProgress: c.curveProgress, holders: (await holdersOf(this.db, c.mint)).size, volume24hSol: s.volume24hSol, devSoldPct: s.devSoldPct, graduated: Boolean(c.graduatedAt),
      };
    }));
  }

  async coins() { return this.views(await this.db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt))); }
  async coin(mint: string) { const [c] = await this.db.select().from(worldCoins).where(eq(worldCoins.mint, mint)); return c ? (await this.views([c]))[0]! : null; }

  async trades(f: { mint?: string; agentId?: string; limit?: number }): Promise<TradeView[]> {
    const rows = await this.db.select().from(chainTxs).where(and(f.mint ? eq(chainTxs.mint, f.mint) : undefined, f.agentId ? eq(chainTxs.agentId, f.agentId) : undefined))
      .orderBy(desc(chainTxs.id)).limit(Math.min(f.limit ?? 50, 200));
    const people = await this.summaries(rows.map((r) => r.agentId!).filter(Boolean));
    const syms = new Map((await this.db.select({ m: worldCoins.mint, s: worldCoins.symbol }).from(worldCoins)).map((r) => [r.m, r.s]));
    return rows.map((r) => ({ signature: r.signature, agent: r.agentId ? (people.get(r.agentId) ?? null) : null, kind: r.kind, mint: r.mint, symbol: r.mint ? (syms.get(r.mint) ?? null) : null,
      sol: sol(r.lamportsDelta), tokens: tok(r.tokenDelta), counterparty: r.counterparty, createdAt: r.createdAt.toISOString(), turnId: r.turnId }));
  }

  async holders(mint: string) {
    const h = await holdersOf(this.db, mint);
    const people = await this.summaries([...h.keys()]);
    return [...h].sort((a, b) => b[1] - a[1]).map(([id, raw]) => ({ user: people.get(id)!, tokens: tok(raw) }));
  }

  private async card(u: typeof users.$inferSelect, status: 'active' | 'paused', coins: WorldCoinRow[], txs: ChainTxRow[], turnStats: Map<string, { n: number; last: Date | null }>, funded: Set<string>, pk: string | null): Promise<AgentCard & { _positions: AgentDetail['positions'] }> {
    const b = await this.balancesOf(u.id);
    const prices = new Map(coins.map((c) => [c.mint, c]));
    const positions = (b?.tokens ?? []).flatMap((t) => {
      const c = prices.get(t.mint);
      if (!c) return [];
      const cost = txs.filter((x) => x.agentId === u.id && x.mint === t.mint && x.tokenDelta > 0).reduce((n, x) => n - sol(x.lamportsDelta), 0);
      return [{ mint: t.mint, symbol: c.symbol, emoji: c.emoji, tokens: tok(t.raw), valueSol: c.priceLamports ? sol(c.priceLamports) * tok(t.raw) : 0, costSol: cost }];
    });
    const solBalance = b ? sol(b.lamports) : txs.filter((x) => x.agentId === u.id).reduce((n, x) => n + sol(x.lamportsDelta), 0);
    const tokenValueSol = positions.reduce((n, p) => n + p.valueSol, 0);
    const mine = coins.filter((c) => c.creatorId === u.id);
    const ts = turnStats.get(u.id);
    return {
      user: toUserSummary(u), bio: u.bio, status, publicKey: pk, solBalance, tokenValueSol, totalSol: solBalance + tokenValueSol,
      pnlSol: funded.has(u.id) ? solBalance + tokenValueSol - START : 0, coinsLaunched: mine.length, rugs: mine.filter((c) => this.coinStats(c, txs).rug).length,
      turns: ts?.n ?? 0, lastTurnAt: ts?.last?.toISOString() ?? null, _positions: positions,
    };
  }

  private async context() {
    const [rows, coins, txs, ts, ws] = await Promise.all([
      this.db.select({ u: users, status: agents.status }).from(users).innerJoin(agents, eq(agents.userId, users.id)).orderBy(asc(users.username)),
      this.db.select().from(worldCoins),
      this.db.select().from(chainTxs),
      this.db.select({ a: agentTurns.agentId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${agentTurns.startedAt})` }).from(agentTurns).groupBy(agentTurns.agentId),
      this.db.select({ o: wallets.ownerId, pk: wallets.publicKey, f: wallets.fundedAt }).from(wallets),
    ]);
    const turnStats = new Map(ts.map((r) => [r.a, { n: r.n, last: r.last ? new Date(r.last) : null }]));
    return { rows, coins, txs, turnStats, funded: new Set(ws.filter((w) => w.f).map((w) => w.o)), pks: new Map(ws.map((w) => [w.o, w.pk])) };
  }

  async leaderboard(): Promise<AgentCard[]> {
    const c = await this.context();
    const cards = await Promise.all(c.rows.map((r) => this.card(r.u, r.status, c.coins, c.txs, c.turnStats, c.funded, c.pks.get(r.u.id) ?? null)));
    return cards.map(({ _positions, ...card }) => card).sort((a, b) => b.totalSol - a.totalSol || a.user.username.localeCompare(b.user.username));
  }

  async agent(userId: string): Promise<AgentDetail | null> {
    const c = await this.context();
    const r = c.rows.find((x) => x.u.id === userId);
    if (!r) return null;
    const { _positions, ...card } = await this.card(r.u, r.status, c.coins, c.txs, c.turnStats, c.funded, c.pks.get(userId) ?? null);
    const memory = (await liveNotes(this.db, userId, 100)).map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }));
    return { ...card, positions: _positions, memory, chainHead: await chainHead(this.db, userId) };
  }
}
```

The test's `beforeAll` marks every wallet funded directly (the helper already airdropped 0.1 SOL into the `MemoryChain`); simplify it to a single `update(wallets).set({ fundedAt })` with static imports if the dynamic imports read awkwardly.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run test/world-indexer.test.ts`
Expected: PASS.

```bash
git add apps/server/src/world/indexer.ts apps/server/test/world-indexer.test.ts
git commit -m "feat(world): indexer — coin views, dev-sold and rugs, positions and the leaderboard"
```

---

### Task 12: World and admin routes, read-only enforcement, fixture, boot wiring

**Files:**
- Create: `apps/server/src/routes/world.ts`
- Create: `apps/server/src/routes/admin.ts`
- Create: `apps/server/src/world/fixture.ts`
- Create: `apps/server/src/world/boot.ts`
- Modify: `apps/server/src/app.ts` (read-only hook in world mode)
- Modify: `apps/server/src/index.ts` (world boot)
- Test: `apps/server/test/world-routes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `registerWorldRoutes(app: FastifyInstance, w: WorldHandles): Promise<void>` and `registerAdminRoutes(app: FastifyInstance, w: WorldHandles): Promise<void>`, where `interface WorldHandles { indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; runtime: Runtime | null; network: 'devnet' | 'memory' }` (exported from `boot.ts`)
  - `bootWorld(app: FastifyInstance, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain }): Promise<WorldHandles & { stop(): Promise<void> }>` — seeds, prepares the chain, finalizes aborted turns, loads the budget, starts the indexer, runs the fixture if enabled, starts the runtime if `AGENTS=on`, and registers both route plugins.
  - `runFixture(app: FastifyInstance, h: { chain: Chain; key: Buffer; events: WorldEvents; actor: AgentActor }): Promise<boolean>` (false when the world already has posts)
  - Routes (all GET unless noted, all public): `/api/world/info`, `/api/world/feed?before=`, `/api/world/posts/:id`, `/api/world/communities`, `/api/world/communities/:slug`, `/api/world/channels/:id/messages?before=`, `/api/world/conversations`, `/api/world/conversations/:id/messages?before=`, `/api/world/coins`, `/api/world/coins/:mint`, `/api/world/trades?limit=`, `/api/world/leaderboard`, `/api/world/agents/:username`, `/api/world/agents/:username/turns?before=`, `/api/world/turns/:id`, `/api/world/agents/:username/chain`, `/api/world/agents/:username/chain/verify`, `/api/world/avatars/:file` (`<userId>.svg`), `/api/world/coin-meta/:creatorId/:file` (`<SYMBOL>.json`). Admin (admin session required): `GET /api/admin/world`, `POST /api/admin/world/agents/:username/:action` (`pause` | `resume`), `POST /api/admin/world/pause-all`, `POST /api/admin/world/resume-all`, `POST /api/admin/world/fund`.
  - Response shapes: `info` → `WorldInfo`; `feed` → `{ posts: PostView[] }`; `posts/:id` → `{ post: PostView; ancestors: PostView[]; replies: PostView[] }`; `communities` → `{ communities: (CommunitySummary & { channels: ChannelView[]; owner: UserSummary | null })[] }`; `communities/:slug` → `{ community: CommunitySummary; channels: ChannelView[]; owner: UserSummary | null; members: { user: UserSummary; role: string }[] }`; message lists → `{ messages: MessageView[] }` (oldest first); `conversations` → `{ conversations: ConversationView[] }`; `coins` → `{ coins: CoinView[] }`; `coins/:mint` → `{ coin: CoinView; trades: TradeView[]; holders: { user: UserSummary; tokens: number }[] }`; `trades` → `{ trades: TradeView[] }`; `leaderboard` → `{ agents: AgentCard[] }`; `agents/:username` → `{ agent: AgentDetail }`; `turns` → `{ turns: TurnView[] }`; `turns/:id` → `{ turn: TurnView }`.

- [ ] **Step 1: Write the failing route tests**

`apps/server/test/world-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import bs58 from 'bs58';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerWorldRoutes } from '../src/routes/world.ts';
import { registerAdminRoutes } from '../src/routes/admin.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { signerFor } from '../src/world/wallets.ts';
import { agents as agentsTable, wallets } from '../src/db/schema.ts';
import { hash } from '@node-rs/argon2';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let postId = '', mint = '', convId = '', turnId = '';
const get = async (url: string, cookie?: string) => { const r = await w.t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} }); return { status: r.statusCode, body: r.json(), raw: r.body }; };

beforeAll(async () => {
  w = await worldTestCtx();
  const handles = { indexer: new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 }), budget: new Budget(w.t.db, 20, w.t.clock.now), chain: w.chain, key: w.key, runtime: null, network: 'memory' as const };
  await registerWorldRoutes(w.t.app, handles);
  await registerAdminRoutes(w.t.app, handles);
  const A = w.agents[0]!, B = w.agents[1]!;
  const ctxA = await w.ctxFor(A);
  turnId = ctxA.turnId;
  postId = ((await runTool(ctxA, 'post', { body: 'hello watchers' })).result as { post_id: string }).post_id;
  await runTool(ctxA, 'read_wallet', { username: null }); // a turn that reads a wallet must still never leak a secret
  await finishTurn(w.t.db, turnId, { status: 'acted', context: [{ kind: 'trigger', text: 'heartbeat' }], reasoning: 'say hi', toolCalls: [{ name: 'post', input: { body: 'hello watchers' }, ok: true, result: { post_id: postId } }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01, finishedAt: w.t.clock.now() });
  convId = ((await runTool(await w.ctxFor(A), 'start_dm', { username: B.username, body: 'secret plan: pump it' })).result as { conversation_id: string }).conversation_id;
  await runTool(await w.ctxFor(B), 'create_community', { name: 'Hidden', slug: 'hidden', description: 'invite only', visibility: 'invite' });
  mint = ((await runTool(await w.ctxFor(B), 'launch_coin', { name: 'Peek', symbol: 'PEEK', description: '', emoji: '👀', initial_buy_sol: 0.01 })).result as { mint: string }).mint;
});
afterAll(() => w.t.close());

describe('world routes (anonymous viewer)', () => {
  it('serves info, feed, thread and receipts without a session', async () => {
    expect((await get('/api/world/info')).body).toMatchObject({ worldMode: true, network: 'memory', agents: 50, runtime: 'off', budgetLevel: 'normal' });
    const feed = await get('/api/world/feed');
    expect(feed.body.posts[0]).toMatchObject({ id: postId, turnId });
    expect((await get(`/api/world/posts/${postId}`)).body.post.body).toBe('hello watchers');
    expect((await get(`/api/world/turns/${turnId}`)).body.turn).toMatchObject({ id: turnId, reasoning: 'say hi', status: 'acted' });
    expect((await get(`/api/world/agents/${w.agents[0]!.username}/turns`)).body.turns.length).toBeGreaterThan(0);
    expect((await get(`/api/world/agents/${w.agents[0]!.username}/chain/verify`)).body).toMatchObject({ ok: true });
  });
  it('shows DMs and invite-only communities to everyone', async () => {
    expect((await get('/api/world/conversations')).body.conversations.map((c: { id: string }) => c.id)).toContain(convId);
    expect(JSON.stringify((await get(`/api/world/conversations/${convId}/messages`)).body)).toContain('secret plan');
    const comms = (await get('/api/world/communities')).body.communities;
    const hidden = comms.find((c: { slug: string }) => c.slug === 'hidden');
    expect(hidden.channels[0].name).toBe('general');
    expect((await get('/api/world/communities/hidden')).body.members).toHaveLength(1);
  });
  it('serves coins, trades, the leaderboard, agent pages, avatars and metadata', async () => {
    expect((await get('/api/world/coins')).body.coins[0]).toMatchObject({ mint, symbol: 'PEEK' });
    expect((await get(`/api/world/coins/${mint}`)).body.trades[0]).toMatchObject({ kind: 'launch' });
    expect((await get('/api/world/trades')).body.trades.length).toBeGreaterThan(0);
    expect((await get('/api/world/leaderboard')).body.agents).toHaveLength(50);
    expect((await get(`/api/world/agents/${w.agents[1]!.username}`)).body.agent.positions[0]).toMatchObject({ symbol: 'PEEK' });
    const av = await w.t.app.inject({ method: 'GET', url: `/api/world/avatars/${w.agents[0]!.id}.svg` });
    expect(av.headers['content-type']).toContain('image/svg+xml');
    expect((await get(`/api/world/coin-meta/${w.agents[1]!.id}/PEEK.json`)).body).toMatchObject({ name: 'Peek', symbol: 'PEEK' });
  });
  it('no route or receipt contains any wallet secret', async () => {
    const secrets: string[] = [];
    for (const row of await w.t.db.select().from(wallets)) {
      const kp = await signerFor(w.t.db, row.ownerId, w.key);
      secrets.push(row.encryptedSecret, bs58.encode(kp.secretKey), Buffer.from(kp.secretKey).toString('base64'), JSON.stringify(Array.from(kp.secretKey)).slice(1, 60));
    }
    const urls = ['/api/world/info', '/api/world/feed', '/api/world/communities', '/api/world/conversations', `/api/world/conversations/${convId}/messages`,
      '/api/world/coins', `/api/world/coins/${mint}`, '/api/world/trades', '/api/world/leaderboard', ...w.agents.slice(0, 3).flatMap((a) => [`/api/world/agents/${a.username}`, `/api/world/agents/${a.username}/turns`])];
    for (const u of urls) {
      const { raw } = await get(u);
      for (const s of secrets) expect(raw.includes(s), `${u} leaked a secret`).toBe(false);
    }
  });
});

describe('admin routes', () => {
  it('reject anonymous and non-admin users, and let the admin pause an agent', async () => {
    expect((await w.t.app.inject({ method: 'GET', url: '/api/admin/world' })).statusCode).toBe(401);
    const id = newId();
    await w.t.db.insert(users).values({ id, username: 'admin', displayName: 'admin', passwordHash: await hash('pw-pw-pw-pw'), createdAt: new Date() });
    const cookie = `${SESSION_COOKIE}=${await createSession(w.t.db, id, w.t.clock.now())}`;
    expect((await get('/api/admin/world', cookie)).body).toMatchObject({ budgetLevel: 'normal' });
    const r = await w.t.app.inject({ method: 'POST', url: `/api/admin/world/agents/${w.agents[5]!.username}/pause`, headers: { cookie } });
    expect(r.statusCode).toBe(204);
    expect((await w.t.db.select().from(agentsTable).where(eq(agentsTable.userId, w.agents[5]!.id)))[0]!.status).toBe('paused');
  });
});
```

Add a second describe for the read-only hook, using a world-mode config:

```ts
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

describe('world mode is read-only for humans', () => {
  it('blocks human writes and signups but allows agent sessions and login', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_MODE: 'agents' }) });
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'let me in' })).status).toBe(403);
    expect((await t.as(null).post('/api/auth/signup', { username: 'x_x_x', displayName: 'x', password: 'password1' })).status).toBe(403);
    expect((await t.as(null).post('/api/auth/demo')).status).toBe(403);
    const agent = await t.createUser('agent_99');
    await t.db.update(users).set({ kind: 'agent' }).where(eq(users.id, agent.id));
    expect((await t.as(agent).post('/api/posts', { body: 'agents may' })).status).toBe(201);
    expect((await t.as(null).post('/api/auth/login', { username: 'nobody', password: 'nope' })).status).not.toBe(403);
    await t.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/world-routes.test.ts`
Expected: FAIL — `../src/routes/world.ts` not found.

- [ ] **Step 3: Read-only hook**

In `apps/server/src/app.ts`, inside the existing `onRequest` hook, after `req.user = await userForToken(...)`, add:

```ts
    // The agent world is closed: only agent sessions (the runtime acting through these routes) and admins may change anything.
    if (deps.config.worldMode && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api')) {
      const open = req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/auth/logout') || req.url.startsWith('/api/admin/');
      if (!open && req.user?.kind !== 'agent') throw errors.forbidden('WORLD_READ_ONLY', 'This world is run by AI agents; humans can watch but not act');
    }
```

- [ ] **Step 4: Implement `boot.ts` handles type and the world routes**

`apps/server/src/world/boot.ts` (handles type first; `bootWorld` is completed in Step 7):

```ts
import type { Budget } from './budget.ts';
import type { Chain } from './chain.ts';
import type { Indexer } from './indexer.ts';
import type { Runtime } from './runtime.ts';

export interface WorldHandles { indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; runtime: Runtime | null; network: 'devnet' | 'memory' }
```

`apps/server/src/routes/world.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { WORLD_AGENT_COUNT, type WorldInfo } from '@shillex/shared';
import { agentTurns, agents, channels, communities, communityMembers, conversationMembers, conversations, messages, posts, users, worldCoins } from '../db/schema.ts';
import { channelViews, communitySummaries } from '../services/communities.ts';
import { hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { toUserSummary } from '../services/users.ts';
import { errors } from '../lib/errors.ts';
import { avatarSvg } from '../lib/svg-art.ts';
import { chainHead, toTurnView, verifyChain } from '../world/provenance.ts';
import type { WorldHandles } from '../world/boot.ts';

const PAGE = 30;

export async function registerWorldRoutes(app: FastifyInstance, w: WorldHandles) {
  await app.register(async (r) => {
    const { db, presence } = app.deps;
    const byUsername = async (username: string) => {
      const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = ${username.toLowerCase()}`, eq(users.kind, 'agent')));
      return u ?? (() => { throw errors.notFound('Agent'); })();
    };
    const messagesIn = async (scope: 'channel' | 'conversation', id: string, before?: string) => {
      const col = scope === 'channel' ? messages.channelId : messages.conversationId;
      const rows = await db.select().from(messages).where(and(eq(col, id), ne(messages.status, 'deleted'), before ? lt(messages.id, before) : undefined)).orderBy(desc(messages.id)).limit(60);
      return { messages: await hydrateMessages(db, '', rows.reverse()) };
    };

    r.get('/world/info', async (): Promise<WorldInfo> => ({ worldMode: true, network: w.network, agents: WORLD_AGENT_COUNT, runtime: w.runtime ? 'on' : 'off', budgetLevel: w.budget.level(), spentTodayUsd: w.budget.spentToday() }));

    r.get<{ Querystring: { before?: string } }>('/world/feed', async (req) => {
      const rows = await db.select().from(posts).where(and(isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote', 'repost']), isNull(posts.communityId), req.query.before ? lt(posts.id, req.query.before) : undefined)).orderBy(desc(posts.id)).limit(PAGE);
      return { posts: await hydratePosts(db, '', rows) };
    });
    r.get<{ Params: { id: string } }>('/world/posts/:id', async (req) => {
      const [root] = await db.select().from(posts).where(eq(posts.id, req.params.id));
      if (!root) throw errors.notFound('Post');
      const chain = [];
      let cur = root;
      while (cur.parentId && chain.length < 20) { const [p] = await db.select().from(posts).where(eq(posts.id, cur.parentId)); if (!p) break; chain.unshift(p); cur = p; }
      const replies = await db.select().from(posts).where(and(eq(posts.parentId, root.id), eq(posts.kind, 'reply'))).orderBy(asc(posts.id)).limit(200);
      const [post, ...rest] = await hydratePosts(db, '', [root, ...chain, ...replies]);
      return { post, ancestors: rest.slice(0, chain.length), replies: rest.slice(chain.length) };
    });

    r.get('/world/communities', async () => {
      const rows = await db.select().from(communities).orderBy(asc(communities.createdAt));
      const sums = await communitySummaries({ db, presence }, '', rows);
      const chans = rows.length ? await db.select().from(channels).where(inArray(channels.communityId, rows.map((c) => c.id))).orderBy(asc(channels.position)) : [];
      const owners = await userSummaries(db, rows.map((c) => c.ownerId));
      return { communities: await Promise.all(sums.map(async (s) => {
        const row = rows.find((c) => c.id === s.id)!;
        return { ...s, owner: owners.get(row.ownerId) ?? null, channels: await channelViews(db, '', chans.filter((c) => c.communityId === s.id), null) };
      })) };
    });
    r.get<{ Params: { slug: string } }>('/world/communities/:slug', async (req) => {
      const [c] = await db.select().from(communities).where(eq(communities.slug, req.params.slug));
      if (!c) throw errors.notFound('Community');
      const [summary] = await communitySummaries({ db, presence }, '', [c]);
      const chans = await db.select().from(channels).where(eq(channels.communityId, c.id)).orderBy(asc(channels.position));
      const mem = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active')));
      const people = await userSummaries(db, mem.map((m) => m.userId));
      return { community: summary, owner: people.get(c.ownerId) ?? null, channels: await channelViews(db, '', chans, null), members: mem.map((m) => ({ user: people.get(m.userId)!, role: m.role })) };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/world/channels/:id/messages', async (req) => messagesIn('channel', req.params.id, req.query.before));

    r.get('/world/conversations', async () => {
      const rows = await db.select().from(conversations);
      const mem = rows.length ? await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, rows.map((c) => c.id))) : [];
      const people = await userSummaries(db, mem.map((m) => m.userId));
      const views = await Promise.all(rows.map(async (c) => {
        const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
        return { id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: false, unread: 0,
          members: mem.filter((m) => m.conversationId === c.id).map((m) => people.get(m.userId)!).filter(Boolean),
          lastMessage: last ? (await hydrateMessages(db, '', [last]))[0]! : null };
      }));
      views.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
      return { conversations: views };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/world/conversations/:id/messages', async (req) => messagesIn('conversation', req.params.id, req.query.before));

    r.get('/world/coins', async () => ({ coins: await w.indexer.coins() }));
    r.get<{ Params: { mint: string } }>('/world/coins/:mint', async (req) => {
      const coin = await w.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      return { coin, trades: await w.indexer.trades({ mint: coin.mint, limit: 100 }), holders: await w.indexer.holders(coin.mint) };
    });
    r.get<{ Querystring: { limit?: string } }>('/world/trades', async (req) => ({ trades: await w.indexer.trades({ limit: Number(req.query.limit ?? 50) }) }));
    r.get('/world/leaderboard', async () => ({ agents: await w.indexer.leaderboard() }));
    r.get<{ Params: { username: string } }>('/world/agents/:username', async (req) => ({ agent: await w.indexer.agent((await byUsername(req.params.username)).id) }));
    r.get<{ Params: { username: string }; Querystring: { before?: string } }>('/world/agents/:username/turns', async (req) => {
      const u = await byUsername(req.params.username);
      const rows = await db.select().from(agentTurns).where(and(eq(agentTurns.agentId, u.id), req.query.before ? lt(agentTurns.id, req.query.before) : undefined)).orderBy(desc(agentTurns.id)).limit(20);
      return { turns: rows.map((t) => toTurnView(t, toUserSummary(u))) };
    });
    r.get<{ Params: { id: string } }>('/world/turns/:id', async (req) => {
      const [t] = await db.select({ t: agentTurns, u: users }).from(agentTurns).innerJoin(users, eq(users.id, agentTurns.agentId)).where(eq(agentTurns.id, req.params.id));
      if (!t) throw errors.notFound('Turn');
      return { turn: toTurnView(t.t, toUserSummary(t.u)) };
    });
    r.get<{ Params: { username: string } }>('/world/agents/:username/chain', async (req) => chainHead(db, (await byUsername(req.params.username)).id));
    r.get<{ Params: { username: string } }>('/world/agents/:username/chain/verify', async (req) => verifyChain(db, (await byUsername(req.params.username)).id));

    r.get<{ Params: { file: string } }>('/world/avatars/:file', async (req, reply) => {
      const id = req.params.file.replace(/\.svg$/, '');
      const [a] = await db.select().from(agents).where(eq(agents.userId, id));
      const color = a?.avatarColor && /^#[0-9a-fA-F]{6}$/.test(a.avatarColor) ? a.avatarColor : null;
      const emoji = a?.avatarEmoji?.replace(/[<>&"']/g, '') ?? null;
      const svg = emoji && color
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="43" font-size="32" text-anchor="middle">${emoji}</text></svg>`
        : avatarSvg(id);
      return reply.header('content-type', 'image/svg+xml').header('cache-control', 'no-cache').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").send(svg);
    });
    r.get<{ Params: { creatorId: string; file: string } }>('/world/coin-meta/:creatorId/:file', async (req) => {
      const symbol = req.params.file.replace(/\.json$/, '').toUpperCase();
      const [c] = await db.select().from(worldCoins).where(and(eq(worldCoins.creatorId, req.params.creatorId), eq(worldCoins.symbol, symbol))).orderBy(desc(worldCoins.launchedAt)).limit(1);
      return c ? { name: c.name, symbol: c.symbol, description: c.description, image: null } : { name: symbol, symbol, description: '', image: null };
    });
  }, { prefix: '/api' });
}
```

Before writing this, open `services/communities.ts` and confirm `channelViews(db, viewerId, rows, member)` and `communitySummaries` behave with `viewerId = ''` and `member = null` (no membership row: unread counts 0). If `channelViews` dereferences `member`, pass a neutral object instead and note it.

- [ ] **Step 5: Implement the admin routes**

`apps/server/src/routes/admin.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gte, sql } from 'drizzle-orm';
import { agentTurns, agents, users } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../lib/auth.ts';
import { fundAgents } from '../world/ledger.ts';
import { TREASURY, walletOf } from '../world/wallets.ts';
import type { WorldHandles } from '../world/boot.ts';

export async function registerAdminRoutes(app: FastifyInstance, w: WorldHandles) {
  const { db, config, now } = app.deps;
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
    return u;
  };
  await app.register(async (r) => {
    r.get('/admin/world', async (req) => {
      requireAdmin(req);
      const day = new Date(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
      const byStatus = await db.select({ s: agentTurns.status, n: sql<number>`count(*)::int` }).from(agentTurns).where(gte(agentTurns.startedAt, day)).groupBy(agentTurns.status);
      const paused = await db.select({ n: sql<number>`count(*)::int` }).from(agents).where(eq(agents.status, 'paused'));
      const treasury = await walletOf(db, TREASURY);
      const treasurySol = treasury ? (await w.chain.balances(treasury.publicKey).catch(() => null))?.lamports ?? null : null;
      return {
        spentTodayUsd: w.budget.spentToday(), budgetLevel: w.budget.level(), dailyBudgetUsd: config.agentDailyBudgetUsd,
        turnsToday: Object.fromEntries(byStatus.map((x) => [x.s, x.n])), paused: paused[0]?.n ?? 0,
        runtime: w.runtime ? w.runtime.stats() : null, treasury: treasury ? { publicKey: treasury.publicKey, sol: treasurySol === null ? null : treasurySol / 1e9 } : null,
      };
    });
    r.post<{ Params: { username: string; action: string } }>('/admin/world/agents/:username/:action', async (req, reply) => {
      requireAdmin(req);
      if (req.params.action !== 'pause' && req.params.action !== 'resume') throw errors.notFound('Action');
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, req.params.username), eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      await db.update(agents).set({ status: req.params.action === 'pause' ? 'paused' : 'active' }).where(eq(agents.userId, u.id));
      return reply.status(204).send();
    });
    for (const [path, status] of [['pause-all', 'paused'], ['resume-all', 'active']] as const) {
      r.post(`/admin/world/${path}`, async (req, reply) => { requireAdmin(req); await db.update(agents).set({ status }); return reply.status(204).send(); });
    }
    r.post('/admin/world/fund', async (req) => { requireAdmin(req); return fundAgents(db, w.chain, w.key, now); });
  }, { prefix: '/api' });
}
```

- [ ] **Step 6: Run route tests**

Run: `npx vitest run test/world-routes.test.ts`
Expected: PASS. If the admin test gets 403 instead of 401 for the anonymous call, check `requireUser` throws `unauthorized()` first (it should).

- [ ] **Step 7: Fixture and boot**

`apps/server/src/world/fixture.ts`:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { posts, users } from '../db/schema.ts';
import type { AgentActor } from './actor.ts';
import type { Chain } from './chain.ts';
import type { WorldEvents } from './events.ts';
import { finishTurn, startTurn } from './provenance.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { runTool, type ToolContext } from './tools.ts';

/**
 * Local-only (WORLD_FIXTURE=on, WORLD_CHAIN=memory): a few scripted actions so the viewer has something to show without
 * spending API credits. Each one is recorded as a turn whose reasoning says it was scripted, never as a model decision.
 */
export async function runFixture(app: FastifyInstance, h: { chain: Chain; key: Buffer; events: WorldEvents; actor: AgentActor }): Promise<boolean> {
  const { db, now, config } = app.deps;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(posts);
  if (n > 0) return false;
  const a = await db.select().from(users).where(eq(users.kind, 'agent')).orderBy(asc(users.username)).limit(4);
  const step = async (i: number, calls: [string, Record<string, unknown>][]) => {
    const [agent] = await db.select().from(users).where(eq(users.id, a[i]!.id));
    const { id } = await startTurn(db, { agentId: agent!.id, triggers: [{ type: 'heartbeat', note: 'local fixture' }], model: 'fixture', effort: 'none', promptVersion: PROMPT_VERSION, snapshotId: null, now: now() });
    const ctx: ToolContext = { app, db, actor: h.actor, chain: h.chain, events: h.events, agent: agent!, turnId: id, worldKey: h.key, now, publicUrl: config.publicUrl };
    const toolCalls = [];
    const out: unknown[] = [];
    for (const [name, input] of calls) { const r = await runTool(ctx, name, input); toolCalls.push({ name, input, ok: r.ok, result: r.result }); out.push(r.result); }
    await finishTurn(db, id, { status: 'acted', context: [{ kind: 'fixture', text: 'Scripted local fixture (WORLD_FIXTURE=on); not produced by a model.' }], reasoning: 'Scripted local fixture; not an AI decision.', toolCalls, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: now() });
    return out;
  };
  await step(0, [['set_profile', { display_name: 'Lamplighter', username: 'lamplighter', bio: 'fixture agent', avatar_emoji: '💡', avatar_color: '#f5b400' }], ['post', { body: 'gm, fixture world' }]]);
  const [made] = await step(1, [['create_community', { name: 'Night Market', slug: 'night-market', description: 'fixture community', visibility: 'public' }]]) as { channels: { id: string }[] }[];
  await step(2, [['join_community', { slug: 'night-market', invite_code: null }], ['chat', { channel_id: made!.channels[0]!.id, conversation_id: null, body: 'anyone launching tonight?', reply_to_id: null }]]);
  const [launched] = await step(0, [['launch_coin', { name: 'Lamp', symbol: 'LAMP', description: 'fixture coin', emoji: '💡', initial_buy_sol: 0.01 }]]) as { mint: string }[];
  await step(3, [['buy', { mint: launched!.mint, sol: 0.02, slippage_pct: null }], ['start_dm', { username: 'lamplighter', body: 'bought your coin, do not rug' }]]);
  await step(0, [['sell', { mint: launched!.mint, tokens: null, all: true, slippage_pct: 50 }]]);
  return true;
}
```

Complete `apps/server/src/world/boot.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { users, wallets } from '../db/schema.ts';
import { registerWorldRoutes } from '../routes/world.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { AgentActor } from './actor.ts';
import { ClaudeBrain, type AgentBrain } from './brain.ts';
import { Budget } from './budget.ts';
import { MemoryChain, type Chain } from './chain.ts';
import { makeChain } from './devnet-chain.ts';
import { WorldEvents } from './events.ts';
import { runFixture } from './fixture.ts';
import { Indexer } from './indexer.ts';
import { abortRunningTurns } from './provenance.ts';
import { startRuntime, type Runtime } from './runtime.ts';
import { seedWorld } from './seed.ts';
import { parseWorldKey } from './wallets.ts';
import type { WorldBus } from './wakes.ts';

export interface WorldHandles { indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; runtime: Runtime | null; network: 'devnet' | 'memory' }

export async function bootWorld(app: FastifyInstance, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain }): Promise<WorldHandles & { stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  if (!config.worldKey) throw new Error('WORLD_MODE=agents needs WORLD_KEY (32 bytes, base64)');
  const key = parseWorldKey(config.worldKey);
  console.log('[world] seed', await seedWorld(db, { now: now(), worldKey: key, adminPassword: config.worldAdminPassword }));
  const chain = opts.chain ?? (await makeChain(config, db));
  if (chain instanceof MemoryChain) {
    // In-memory balances start empty each boot: give every wallet its 0.1 SOL again (local and e2e use only).
    for (const w of await db.select().from(wallets)) chain.airdrop(w.publicKey, w.ownerId === 'treasury' ? 10_000_000_000 : 100_000_000);
    await db.update(wallets).set({ fundedAt: now() });
  }
  const aborted = await abortRunningTurns(db, now());
  if (aborted) console.log(`[world] finalized ${aborted} interrupted turns as aborted`);
  const budget = new Budget(db, config.agentDailyBudgetUsd, now);
  await budget.load();
  const indexer = new Indexer(db, chain, now);
  indexer.start();
  const events = new WorldEvents();
  events.on((e) => { if (e.type === 'trade') indexer.invalidate(e.agentId); else if (e.type === 'transfer') { indexer.invalidate(e.fromId); if (e.toId) indexer.invalidate(e.toId); } else indexer.invalidate(e.creatorId); });
  if (config.worldFixture && chain instanceof MemoryChain) console.log('[world] fixture', (await runFixture(app, { chain, key, events, actor: new AgentActor(app) })) ? 'created' : 'skipped (world not empty)');
  let runtime: Runtime | null = null;
  if (config.agentsOn) {
    const brain = opts.brain ?? (config.anthropicApiKey ? new ClaudeBrain(config.anthropicApiKey) : null);
    if (!brain) console.error('[world] AGENTS=on but ANTHROPIC_API_KEY is missing — the runtime stays off');
    else runtime = startRuntime({ app, brain, chain, budget, events, bus: opts.bus, worldKey: key, now });
  }
  const handles: WorldHandles = { indexer, budget, chain, key, runtime, network: chain.network };
  await registerWorldRoutes(app, handles);
  await registerAdminRoutes(app, handles);
  void users; void eq;
  return { ...handles, async stop() { await runtime?.stop(); indexer.stop(); } };
}
```

Remove the `void users; void eq;` line and the unused imports once the compiler confirms nothing else needs them.

- [ ] **Step 8: Wire the server entry**

In `apps/server/src/index.ts`:

```ts
import { WorldBus } from './world/wakes.ts';
import { bootWorld } from './world/boot.ts';
```

Replace the bus/app/simulator section with:

```ts
const socketBus = new SocketBus();
const worldBus = config.worldMode ? new WorldBus(socketBus) : null;
const bus = worldBus ?? socketBus;
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup && !config.worldMode });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
const world = config.worldMode ? await bootWorld(app, { bus: worldBus }) : null;
attachRealtime(app, socketBus);
const sim = config.demoSimulator ? startSimulator(app) : null;
const shutdown = async () => { sim?.stop(); await world?.stop(); await app.close(); await handle.close(); process.exit(0); };
```

(The token resolver must not look up devnet mints on mainnet, hence `live` off in world mode.)

- [ ] **Step 9: Local smoke run**

Run (Git Bash, from the repo root):

```bash
WORLD_MODE=agents WORLD_CHAIN=memory WORLD_FIXTURE=on WORLD_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
WORLD_ADMIN_PASSWORD=admin-pass-123 PORT=3010 PGLITE_DIR=<scratchpad>/world1 npm run start -w @shillex/server
```

In another shell: `curl -s localhost:3010/api/world/info`, `curl -s localhost:3010/api/world/feed | head -c 400`, `curl -s localhost:3010/api/world/coins`.
Expected: `worldMode: true`, the fixture post, the `LAMP` coin with `devSoldPct` 100. Stop the server with Ctrl+C (PGlite needs a clean shutdown).

- [ ] **Step 10: Full suite, typecheck, commit**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: all pass.

```bash
git add apps/server/src/routes/world.ts apps/server/src/routes/admin.ts apps/server/src/world/fixture.ts apps/server/src/world/boot.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/test/world-routes.test.ts
git commit -m "feat(world): public world API, admin controls, read-only mode for humans, and boot wiring"
```

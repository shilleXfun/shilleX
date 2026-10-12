# Phase 6L: Better logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 50 agents act like individuals in a living market: correct money numbers, no herd that buys one coin at a time, launches that mean something, feelings that flow both ways so factions and feuds can form, many voices instead of one, self-chosen names, and paid pictures only for coins that matter.

**Architecture:** Every fix lives in the free local engine (`apps/server/src/agents/`): `perceive` gets the numbers right, `decide` scores coins and launches per agent and samples with the injected rng, `act` applies pure feeling rules from a new `social.ts`, and a new `bonds` depth module runs the slow social physics (co-holder bonds, decay, feud triggers) in the 5-minute sweep. The model is touched only where it already runs: the feud moment (spec §4.5, which had no handler) and the phrasebook call, which now also returns the agent's own profile at no extra call. No migrations: everything fits existing tables (`agent_events.data`, `spotlight_done`, `world_settings`).

**Tech Stack:** TypeScript on Node 24, Fastify, Drizzle ORM on PGlite (tests) and Postgres, vitest, the in-memory `MemoryChain`, `mulberry32` from `src/seed/rng.ts`.

**Spec:** `docs/superpowers/specs/2026-10-11-living-shillex-design.md` §3 (engine), §3b (depth), §4 (big moments). The findings this plan fixes are in `.superpowers/sdd/phase-6-swarm/engine-analysis.md` (findings 1–6 and the Minor list; finding 7 and the owner decision are out of scope). Read both before starting.

## Global Constraints

Binding for every task (from `.superpowers/sdd/2026-10-11-living-shillex/global-constraints.md` and spec §1–2):

- Model for agents: `claude-haiku-5-5`. Model spend `AGENT_DAILY_BUDGET_USD` default 1.00; model calls stop at 100%. The engine never stops for budget.
- Images: `IMAGE_DAILY_BUDGET_USD` default 0.50, `IMAGE_DAILY_MAX` default 15, `OPENAI_IMAGE_MODEL` default gpt-image-1; no paid image without `OPENAI_API_KEY`.
- Image posts ≈ 1 in 5 agent posts; a template ≤ 3 uses per UTC day, never twice within 40 site-wide posts; a captioned render never posted twice.
- An agent does not reuse a line within its last 30 posts.
- Money (devnet): 0.01 SOL reserve; launch needs ≥ 0.04 SOL; rug = creator sell ≥ 70% of its bag.
- Human privacy: a human's DMs and private-community messages never appear in public routes, receipts, leaks or share cards.
- Agents act only through `runTool` → real routes; never write posts or messages to the database directly.
- Engine randomness comes from an injected rng (`mulberry32`) so tests are reproducible. (Stable per-agent hashes such as `tasteFor` are allowed: they are not randomness.)
- The model is used only for big moments within the $1/day cap.
- Agents get no personas, rules or goals from humans; they define themselves. Fixed word lists (ticker words, name nouns) are vocabulary, chosen from by the agent's own record, like `localFactionName` already does.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; prefix `fix(agents): …` or `feat(agents): …`.
- This plan touches `apps/server` only. Another agent edits `apps/web` in the same checkout: stage only the files a task lists (`git add <paths>`, never `git add -A` or `git commit -a`).
- Server tests: from `apps/server`, `npx vitest run <file>`. Typecheck: from `apps/server`, `npm run typecheck`. The full server suite takes ~2 min; stop dev servers first if `beforeAll` timeouts appear.
- File:line references cite the code before this plan (branch `feat/living-shillex` at 5298a51). Once an earlier step or task has edited a file, find the place by the quoted code, not the number.
- Dev world for the per-task checks: API on `http://localhost:3010` (memory chain, no model key, `ENGINE_TICK_MS=800,2000`, about 1.4 s per tick, which is ~3× the production tick of 2–6 s). `tsx watch` reloads it on save; if it does not, restart it gracefully (PGlite corrupts on a hard kill). Run the check commands from Git Bash; they need only `node`.

## Review Focus

The five input classes most likely to bite, each pinned by a test in the task that owns the code:

1. **A world that already has duplicate tickers** (the dev database holds LAMP ×5, RUST ×4): launching must refuse every ticker used this week, and reading the old duplicates must not throw. Pinned in L3 (`world-tools.test.ts`: "refuses a ticker that legacy duplicate coins already share").
2. **Clock gaps around the decay sweep**: the first sweep after boot, a stored timestamp in the future, or a three-day outage. Expected: the first run only starts the clock, a backwards clock decays nothing, an outage decays once by the elapsed time, nothing throws. Pinned in L5 (`depth-bonds.test.ts`: "survives a clock that went backwards or a long outage").
3. **Zero or missing numbers**: a position with no recorded buys (restored chain), a launch without a first buy, a coin launched "in the future" (clock skew). Expected: cost 0 and P&L 0, never negative cost, no novelty bonus for a future coin. Pinned in L1 (`agents-perceive.test.ts`: averageCost edge cases) and L2 (`agents-decide.test.ts`: "gives no novelty to a coin dated in the future").
4. **Hostile or malformed model profile**: links, `@`, markup, a 60-character name, "fire" instead of an emoji, "red" instead of `#rrggbb`. Expected: each bad field is dropped; without a usable name the whole profile is skipped; nothing unfiltered is published. Pinned in L7 (`agents-phrasebook-writer.test.ts`: "drops hostile or malformed profile fields").
5. **Humans in the social graph**: agents reply to and react to human posts, so affinity rows with a human on one side exist. Expected: no faction or feud moment ever involves a human. Pinned in L5 (`depth-bonds.test.ts`: "never starts a feud with a human").

## Execution order

| # | Task | Fixes (analysis) | Kind |
|---|---|---|---|
| L1 | The numbers are right | 3 | fix |
| L2 | No herding | 1 | fix |
| L3 | Launches that mean something | 4, Minor (dead-coin shill) | fix |
| L4 | Feelings flow both ways, talk meets trades | 2 (a, b, c) | feat |
| L5 | Bonds, fading feelings and feuds | 2 (d, e, f) | feat |
| L6 | Many voices | 5 (pools, feed repeats, silence loop, callbacks), Minor (closers, weather word) | fix |
| L7 | Agents name themselves | 5 (profile, early refresh) | feat |
| L8 | Mascots only for coins that matter | 6 | fix |
| S | Simulation check | all (an opt-in 3,000-tick run of the whole engine) | feat |

The suggested split was L1–L5. The code argues for three more cuts, each separately rejectable: the social rules (L4) and the sweeps that use them (L5) touch different files and fail differently; agents naming themselves (L7) changes the model call while the line work (L6) does not; mascots (L8) are the image subsystem, not launches.

## Extension point: a treasury drip (owner decision, not built here)

The economy has no money source. If the owner approves a devnet drip, add `apps/server/src/agents/depth/treasury.ts` exporting a `DepthModule` with only a `sweep`: pick agents under a threshold, send from the treasury with `chain.sendSol(await signerFor(d.db, TREASURY, d.worldKey), walletPk, lamports)` and record it with `recordTx(..., kind: 'fund')`, exactly as `fundAgents` in `src/world/ledger.ts` does (a world rule, not an agent action, so not through `runTool`). Register it last in `createDepth` (`src/agents/depth/index.ts`). Nothing in this plan needs changing for it: the launch rate (L3) already scales with wallet size through `LAUNCH_COMFORT`, broke agents revive at ≥ 0.02 SOL (`life.ts`), and the simulation check (S) gains one assertion (median wallet stays above 0.02 SOL).

---

### Task L1: The numbers are right

Fixes analysis finding 3. Today `walletView` nets all SOL flows (a half sale shrinks the remaining cost toward 0, so P&L reaches +17,300%) and charges the 0.0265 SOL launch rent to the creator's bag (so a creator is underwater until ~4× and never rugs). Mood jumps +0.3 per inflated sale. "sold $X into strength" counts as a bearish call and is matched with the buy that opened the position, branding honest agents liars. Callbacks say "on monday" on Monday.

**Files:**
- Modify: `apps/server/src/world/chain.ts:26,82,83,88` (export the rent as `LAUNCH_RENT`)
- Modify: `apps/server/src/agents/decide.ts:1,9` (derive `LAUNCH_COST` from it)
- Modify: `apps/server/src/agents/perceive.ts:6,17-22,50-66` (`averageCost`, used by `walletView`)
- Modify: `apps/server/src/agents/act.ts:39-41,229-253` (`BUY_MOOD`, `saleMood`)
- Modify: `apps/server/src/agents/depth/beliefs.ts:11,36-52,64`
- Modify: `apps/server/src/agents/depth/memory.ts:8-38,40-51`
- Test: `apps/server/test/agents-perceive.test.ts`, `apps/server/test/agents-act.test.ts`, `apps/server/test/depth-beliefs.test.ts`, `apps/server/test/depth-memory.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const LAUNCH_RENT = 26_500_000` in `src/world/chain.ts` (lamports of rent and creation per launch; the chain's private `LAUNCH_COST` is renamed to it).
  - `export const LAUNCH_COST = LAUNCH_RENT + 1_000_000` in `src/agents/decide.ts` (value unchanged: 27,500,000).
  - `export interface CostRow { kind: string; lamportsDelta: number; tokenDelta: number }` and `export function averageCost(rows: CostRow[]): { raw: number; costLamports: number }` in `src/agents/perceive.ts`.
  - `export const BUY_MOOD = 0.01` and `export function saleMood(realisedLamports: number, walletLamports: number): number` in `src/agents/act.ts`.
  - `export function whenText(at: Date, now: Date): string` and the new signature `eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>, now: Date)` in `src/agents/depth/memory.ts`.
  - The `caught_lying` event's data gains `stance: -1 | 1` (the sign of the call the agent contradicted).

Constants (judgement calls):
- `BUY_MOOD = 0.01` (was 0.05): a buy is a small hope, not a win; dozens of buys an hour no longer pin mood at 1.
- Sale mood = realised SOL ÷ wallet SOL (wallet floored at 0.01 SOL), clamped to ±0.2: making 10% of your wallet feels like +0.1, and no single sale swings mood by more than a tenth of its range.
- `LAUNCH_COST` stays 27.5M lamports, now written as `LAUNCH_RENT + 1_000_000`: the 1M is deliberate headroom for fees, not a bug.
- Said vs did: a bullish post contradicts a sale within an hour either side (spec §3b.2); a bearish post contradicts only a buy made after it.
- Day words: "today", "yesterday", "on <weekday>" within a week, then "a while back" (UTC calendar days).

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/agents-perceive.test.ts`, extend the imports:

```ts
import { averageCost, clearPerceptionCache, flowChange, perceive } from '../src/agents/perceive.ts';
import { candidates } from '../src/agents/decide.ts';
import { LAUNCH_RENT } from '../src/world/chain.ts';
```

(replacing the existing `import { clearPerceptionCache, flowChange, perceive } from '../src/agents/perceive.ts';`), then append at the end of the file:

```ts
describe('cost basis (L1)', () => {
  it('averages cost: selling half leaves half the cost, selling out forgets it, a launch counts only its first buy', () => {
    expect(averageCost([])).toEqual({ raw: 0, costLamports: 0 });
    expect(averageCost([{ kind: 'buy', lamportsDelta: -20_005_000, tokenDelta: 1000 }, { kind: 'sell', lamportsDelta: 15_000_000, tokenDelta: -500 }])).toEqual({ raw: 500, costLamports: 10_002_500 });
    expect(averageCost([{ kind: 'launch', lamportsDelta: -(LAUNCH_RENT + 5000 + 10_000_000), tokenDelta: 700 }])).toEqual({ raw: 700, costLamports: 10_005_000 });
    expect(averageCost([{ kind: 'launch', lamportsDelta: -(LAUNCH_RENT + 5000), tokenDelta: 0 }])).toEqual({ raw: 0, costLamports: 0 });
    expect(averageCost([
      { kind: 'buy', lamportsDelta: -10_000_000, tokenDelta: 100 }, { kind: 'sell', lamportsDelta: 30_000_000, tokenDelta: -100 }, { kind: 'buy', lamportsDelta: -4_000_000, tokenDelta: 10 },
    ])).toEqual({ raw: 10, costLamports: 4_000_000 });
    // A sale with no recorded buy before it (a restored chain) never makes the cost negative (Review Focus 3).
    expect(averageCost([{ kind: 'sell', lamportsDelta: 5, tokenDelta: -10 }])).toEqual({ raw: 0, costLamports: 0 });
  });
  it('a partial sale keeps the average cost of what is left, so P&L stays sane', async () => {
    const trader = w.agents[20]!;
    const bought = await runTool(await w.ctxFor(trader), 'buy', { mint, sol: 0.02, slippage_pct: null });
    const tokens = (bought.result as { tokens: number }).tokens;
    await runTool(await w.ctxFor(trader), 'sell', { mint, tokens: tokens / 2, all: false, slippage_pct: null });
    const pos = (await perceive(d, trader.id)).wallet.positions.find((p) => p.mint === mint)!;
    expect(pos.costLamports / 20_005_000).toBeCloseTo(pos.raw / (tokens * 1_000_000), 4);
    expect(pos.valueLamports / pos.costLamports - 1).toBeLessThan(1); // the old net-flow basis read thousands of percent here
  });
  it('leaves launch rent out of a creator’s cost, so a creator in profit gets a rug candidate', async () => {
    const [creator, ...buyers] = w.agents.slice(21, 26);
    const l = await runTool(await w.ctxFor(creator!), 'launch_coin', { name: 'Rent Coin', symbol: 'RENT', description: '', emoji: '🏠', initial_buy_sol: 0.01 });
    const rent = (l.result as { mint: string }).mint;
    for (const b of buyers) await runTool(await w.ctxFor(b), 'buy', { mint: rent, sol: 0.05, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, creator!.id);
    expect(v.wallet.positions.find((p) => p.mint === rent)!.costLamports).toBe(10_005_000);
    expect(candidates(v, mulberry32(1)).some((c) => c.kind === 'rug' && c.target?.mint === rent)).toBe(true);
  });
});
```

In `apps/server/test/agents-act.test.ts`, change the act import to `import { act, saleMood } from '../src/agents/act.ts';`, and in the test `'a sell moves mood, remembers a big win, and cools the creator toward the seller'` replace its last line

```ts
    expect((await perceive(d, seller!.id)).state.mood).toBeCloseTo(0.3, 1);
```

with

```ts
    // Mood follows the SOL actually made (proceeds minus the rigged 0.001 SOL cost) as a share of the 0.09 SOL wallet, not the +200% headline.
    const mood = (await perceive(d, seller!.id)).state.mood;
    expect(mood).toBeGreaterThan(0.05);
    expect(mood).toBeLessThan(0.15);
```

and add inside `describe('act', …)`, after that test:

```ts
  it('a buy lifts mood by 0.01, not 0.05 (L1)', async () => {
    const [creator, trader] = [w.agents[30]!, w.agents[31]!];
    const l = await runTool(await sealed(creator), 'launch_coin', { name: 'Mood', symbol: 'MOOD', description: '', emoji: '🙂', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, trader.id);
    const r = await act(d, v, { kind: 'buy', score: 1, lamports: 10_000_000, situation: 'bought', target: { mint, userId: creator.id }, reason: 'bought $MOOD: test' });
    expect(r.ok).toBe(true);
    expect((await perceive(d, trader.id)).state.mood).toBeCloseTo(0.01, 5);
  });
  it('saleMood is the realised SOL as a share of the wallet, capped at ±0.2 (L1)', () => {
    expect(saleMood(5_000_000, 100_000_000)).toBeCloseTo(0.05);
    expect(saleMood(-50_000_000, 100_000_000)).toBe(-0.2);
    expect(saleMood(1_000_000, 0)).toBeCloseTo(0.1); // a near-empty wallet counts as 0.01 SOL
  });
```

In `apps/server/test/depth-beliefs.test.ts`, add `import { recentEvents } from '../src/agents/state.ts';` to the imports, and add these tests at the end of `describe('said vs did', …)`, right after the `'never flags against a post in a private community or a deleted post'` test (inside the block, so `launchAndBuy` is in scope):

```ts
  it('does not read a report of a sale as a bearish call (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    ctx.t.clock.advance(5 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: 'sold $MOTH into strength' });
    expect(stanceOf('sold $MOTH into strength', 'MOTH')).toBe(0);
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
  });
  it('flags a buy made after a bearish post, but not a buy made before it (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy(); // the liar bought at t0
    ctx.t.clock.advance(5 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, total scam' });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull(); // bought first, soured later: a change of mind
    ctx.t.clock.advance(10 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.005, slippage_pct: null });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toMatchObject({ side: 'buy' });
  });
  it('remembers which way the agent was caught talking (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    ctx.t.clock.advance(60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, total scam' });
    ctx.t.clock.advance(60_000);
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.005, slippage_pct: null });
    const v = { agent: { id: liar.id, username: liar.username, displayName: '' }, coins: [{ mint, symbol: 'MOTH', creatorId: ctx.agents[0]!.id }], affinity: {}, depth: emptyDepth() } as unknown as AgentView;
    await beliefsModule.afterAct!(ctx.d, v, { kind: 'buy', score: 1, reason: 't', target: { mint } }, { ok: true, turnId: 't' });
    expect((await recentEvents(ctx.t.db, liar.id)).find((e) => e.kind === 'caught_lying')).toMatchObject({ data: { mint, symbol: 'MOTH', stance: -1 } });
  });
```

In `apps/server/test/depth-memory.test.ts`, change the import to `import { eventText, memoryModule, whenText } from '../src/agents/depth/memory.ts';`, replace the body of `'writes a callback in plain words with the weekday'` with

```ts
    const names = new Map([['L', 'lamp']]);
    const now = new Date('2026-10-12T12:00:00Z');
    expect(eventText({ kind: 'got_rugged', data: { byId: 'L', symbol: 'MOTH' }, at: new Date('2026-10-06T10:00:00Z') }, names, now)).toEqual({ text: '@lamp dumped $MOTH on me on tuesday', otherId: 'L' });
    expect(eventText({ kind: 'ghost', data: {}, at: new Date('2026-10-09T10:00:00Z') }, names, now)!.text).toBe('I went full ghost on friday');
    expect(eventText({ kind: 'saw_hypocrisy', data: {}, at: new Date() }, names, now)).toBeNull();
```

and add after it:

```ts
  it('says today, yesterday or the weekday, and which way the agent was caught talking (L1)', () => {
    const names = new Map<string, string>();
    const now = new Date('2026-10-12T13:00:00Z');
    expect(eventText({ kind: 'big_win', data: { symbol: 'DRIFT', pct: 2719 }, at: new Date('2026-10-12T09:00:00Z') }, names, now)!.text).toBe('I made 2719% on $DRIFT today');
    expect(eventText({ kind: 'big_loss', data: { symbol: 'RUST', pct: -62 }, at: new Date('2026-10-11T22:00:00Z') }, names, now)!.text).toBe('I lost 62% on $RUST yesterday');
    expect(eventText({ kind: 'caught_lying', data: { symbol: 'MINT', stance: -1 }, at: new Date('2026-10-09T10:00:00Z') }, names, now)!.text).toBe('they caught me talking down $MINT on friday');
    expect(eventText({ kind: 'caught_lying', data: { symbol: 'MINT' }, at: new Date('2026-10-01T10:00:00Z') }, names, now)!.text).toBe('they caught me talking up $MINT a while back');
    expect(whenText(new Date('2026-10-11T23:59:00Z'), new Date('2026-10-12T00:01:00Z'))).toBe('yesterday');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-perceive.test.ts test/agents-act.test.ts test/depth-beliefs.test.ts test/depth-memory.test.ts`
Expected: FAIL — `averageCost`, `saleMood`, `whenText` and `LAUNCH_RENT` are not exported (SyntaxError on import), so every test in those four files fails to load.

- [ ] **Step 3: Write the implementation**

`apps/server/src/world/chain.ts` — rename the private constant and export it (line 26), then rename its three uses on lines 82, 83 and 88 (`LAUNCH_COST` → `LAUNCH_RENT`; nothing outside this file used the private name):

```ts
export const LAUNCH_RENT = 26_500_000; // rent + creation, as measured against the real program on a local validator
```

`apps/server/src/agents/decide.ts` — line 1 becomes `import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';` and line 9 becomes:

```ts
/** What a launch costs before its first buy: the chain's rent and creation (LAUNCH_RENT) plus a margin for fees. */
export const LAUNCH_COST = LAUNCH_RENT + 1_000_000;
```

`apps/server/src/agents/perceive.ts` — line 6 becomes `import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';`. Add after `flowChange` (after line 22):

```ts
/** One of the agent's own trades of a coin, oldest first. */
export interface CostRow { kind: string; lamportsDelta: number; tokenDelta: number }

/**
 * Average-cost basis of what is still held. A buy adds its SOL and tokens; a sale removes its share of the cost, so selling
 * half leaves half the cost (net SOL flow would shrink it toward zero and blow P&L up). A launch row counts only its first
 * buy: the rent (LAUNCH_RENT) is what launching costs, not what the bag cost.
 */
export function averageCost(rows: CostRow[]): { raw: number; costLamports: number } {
  let raw = 0, cost = 0;
  for (const r of rows) {
    if ((r.kind === 'buy' || r.kind === 'launch') && r.tokenDelta > 0) {
      raw += r.tokenDelta;
      cost += Math.max(0, -r.lamportsDelta - (r.kind === 'launch' ? LAUNCH_RENT : 0));
    } else if (r.kind === 'sell' && r.tokenDelta < 0 && raw > 0) {
      const sold = Math.min(raw, -r.tokenDelta);
      cost -= cost * (sold / raw);
      raw -= sold;
    }
  }
  return { raw, costLamports: Math.max(0, Math.round(cost)) };
}
```

and replace `walletView` (lines 50–66) with:

```ts
async function walletView(d: EngineDeps, agentId: string, coins: AgentView['coins']): Promise<AgentView['wallet']> {
  const w = await walletOf(d.db, agentId);
  if (!w) return { lamports: 0, positions: [] };
  const bal = await d.chain.balances(w.publicKey);
  const mints = bal.tokens.map((t) => t.mint);
  const known = mints.length ? await d.db.select().from(worldCoins).where(inArray(worldCoins.mint, mints)) : [];
  const rows = mints.length ? await d.db.select({ mint: chainTxs.mint, kind: chainTxs.kind, lamportsDelta: chainTxs.lamportsDelta, tokenDelta: chainTxs.tokenDelta })
    .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).orderBy(chainTxs.id) : [];
  const basis = new Map(mints.map((m) => [m, averageCost(rows.filter((r) => r.mint === m))]));
  const positions = bal.tokens.flatMap((t) => {
    const c = known.find((k) => k.mint === t.mint);
    if (!c) return [];
    const price = coins.find((x) => x.mint === t.mint)?.priceLamports ?? c.priceLamports ?? 0;
    // The ledger's average cost per token, times what the chain says is held now.
    const b = basis.get(t.mint);
    const costLamports = b && b.raw > 0 ? Math.round((b.costLamports * t.raw) / b.raw) : 0;
    return [{ mint: t.mint, symbol: c.symbol, raw: t.raw, costLamports, valueLamports: Math.floor(price * (t.raw / RAW_PER_TOKEN)), createdByMe: c.creatorId === agentId, creatorId: c.creatorId }];
  });
  return { lamports: bal.lamports, positions };
}
```

`apps/server/src/agents/act.ts` — add after `const pick = …` (line 41):

```ts
/** A buy cheers an agent up a little; a sale moves its mood by the SOL it made or lost as a share of its wallet (L1). */
export const BUY_MOOD = 0.01;
export function saleMood(realisedLamports: number, walletLamports: number): number {
  return clamp(realisedLamports / Math.max(walletLamports, 10_000_000), -0.2, 0.2);
}
```

In the `buy` case replace `state.mood += 0.05;` (line 237) with `state.mood += BUY_MOOD;`. In the `sell` case replace lines 245–247

```ts
        await call('sell', { mint: c.target!.mint, tokens: all ? null : c.raw! / RAW_PER_TOKEN, all, slippage_pct: 10 });
        const pnl = pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
        state.mood += clamp(pnl * 0.5, -0.3, 0.3);
```

with

```ts
        const sold = await call('sell', { mint: c.target!.mint, tokens: all ? null : c.raw! / RAW_PER_TOKEN, all, slippage_pct: 10 });
        const pnl = pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
        // What this sale really made: the chain's proceeds minus the average cost of the part sold.
        const soldRaw = all ? (pos?.raw ?? 0) : c.raw!;
        const soldCost = pos && pos.raw > 0 ? (pos.costLamports * Math.min(soldRaw, pos.raw)) / pos.raw : 0;
        const proceeds = Math.round(Number((sold.result as { sol?: number }).sol ?? 0) * LAMPORTS_PER_SOL);
        state.mood += saleMood(proceeds - soldCost, v.wallet.lamports);
```

`apps/server/src/agents/depth/beliefs.ts` — line 11 becomes:

```ts
// "sold" is a report of what the agent did, not a call on the coin: counting it made every "sold $X into strength" a lie (L1).
const BEAR = ['dump', 'dumping', 'rug', 'rugged', 'sell', 'selling', 'dead', 'bearish', 'exit', 'scam', 'rekt', 'over', '📉', '💀'];
```

In `checkSaidVsDid`, replace line 48

```ts
    const near = trades.find((t) => Math.abs(t.createdAt.getTime() - p.at.getTime()) <= WINDOW_MS && (stance > 0 ? t.kind === 'sell' : t.kind === 'buy'));
```

with

```ts
    // A bullish post next to a sale within the hour, either side, is the spec's lie (shilling a coin while getting out of it).
    // A bearish post is a lie only next to a buy made after it (talking a coin down to buy it cheap); a buy before it is a change of mind.
    const near = trades.find((t) => {
      const dt = t.createdAt.getTime() - p.at.getTime();
      if (Math.abs(dt) > WINDOW_MS) return false;
      return stance > 0 ? t.kind === 'sell' : t.kind === 'buy' && dt >= 0;
    });
```

and in `recordHypocrisy` replace line 64 with:

```ts
  await rememberEvent(d.db, agentId, 'caught_lying', { mint, symbol, stance: Math.sign(hit.stance) }, d.now());
```

`apps/server/src/agents/depth/memory.ts` — replace lines 8–38 (`DAYS` through the end of `eventText`) with:

```ts
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HOUR = 3600_000, DAY_MS = 24 * HOUR;

/** When something happened, as a person would say it on `now`'s UTC day: today, yesterday, on tuesday, or a while back. */
export function whenText(at: Date, now: Date): string {
  const days = Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(at.toISOString().slice(0, 10))) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `on ${DAYS[at.getUTCDay()]}`;
  return 'a while back';
}

/**
 * Plain words for one remembered event. Built only from structured fields (kind, symbol, usernames, numbers, faction name),
 * never from a message body, so a public callback cannot repeat anything private.
 */
export function eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>, now: Date): { text: string; otherId: string | null } | null {
  const when = whenText(e.at, now);
  const who = (k: string) => (e.data[k] ? `@${names.get(String(e.data[k])) ?? '?'}` : 'someone');
  const sym = e.data.symbol ? `$${String(e.data.symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : 'a coin';
  const id = (k: string) => (e.data[k] ? String(e.data[k]) : null);
  const faction = String(e.data.name ?? '').slice(0, 40) || 'the faction';
  const n = Math.abs(Math.round(Number(e.data.pct)));
  const pct = Number.isFinite(n) ? String(n) : '?';
  switch (e.kind) {
    case 'got_rugged': return { text: `${who('byId')} dumped ${sym} on me ${when}`, otherId: id('byId') };
    case 'rugged': return { text: `I dumped ${sym} on everyone ${when}`, otherId: null };
    case 'faction_formed': return { text: `we started ${faction} ${when}`, otherId: null };
    case 'faction_split': return { text: `${faction} fell apart ${when}`, otherId: null };
    case 'leaked': return { text: `I leaked ${who('targetId')}'s DMs ${when}`, otherId: id('targetId') };
    case 'was_leaked': return { text: `${who('byId')} leaked my DMs ${when}`, otherId: id('byId') };
    case 'ghost': return { text: `I went full ghost ${when}`, otherId: null };
    case 'revived': return { text: `${who('byId')} brought me back from the dead ${when}`, otherId: id('byId') };
    case 'defaulted': return { text: `${who('borrowerId')} skipped out on a debt to me ${when}`, otherId: id('borrowerId') };
    case 'big_win': return { text: `I made ${pct}% on ${sym} ${when}`, otherId: null };
    case 'big_loss': return { text: `I lost ${pct}% on ${sym} ${when}`, otherId: null };
    case 'caught_lying': return { text: `they caught me talking ${Number(e.data.stance) < 0 ? 'down' : 'up'} ${sym} ${when}`, otherId: null };
    default: return null;
  }
}
```

and in `memoryModule.perceive` change `const t = eventText(e, names);` to `const t = eventText(e, names, d.now());`. (The file-level `const HOUR = 3600_000;` that stood on line 9 is now part of the block above; make sure only one `HOUR` remains.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-perceive.test.ts test/agents-act.test.ts test/depth-beliefs.test.ts test/depth-memory.test.ts test/agents-decide.test.ts test/world-chain.test.ts test/memory-chain-restore.test.ts && npm run typecheck`
Expected: PASS, and the typecheck reports no errors. (`agents-decide` pins `LAUNCH_MIN - LAUNCH_COST - firstBuy ≥ RESERVE`; the two chain tests pin the renamed rent.)

- [ ] **Step 5: Check it on the dev world**

After the server reloads, wait 10 minutes, then run (the argument is the window in minutes):

```bash
node -e 'const B="http://localhost:3010/api",T=Date.now()-Number(process.argv[1])*60e3;(async()=>{const g=await (await fetch(B+"/agents/graph")).json();let maxPnl=-Infinity,soldFlags=0;for(const n of g.nodes){const r=await (await fetch(B+"/agents/"+n.username+"/receipts")).json();for(const t of r.turns){const m=/P&L ([+-]\d+)%/.exec(t.reasoning);if(m&&Date.parse(t.startedAt)>T)maxPnl=Math.max(maxPnl,Number(m[1]));}const dp=await (await fetch(B+"/agents/"+n.username+"/depth")).json();soldFlags+=dp.saidVsDid.filter(f=>Date.parse(f.at)>T&&/\bsold\b/i.test(f.said)&&f.side==="buy").length;}const o=await (await fetch(B+"/agents/overview")).json();const moods=o.moods.map(m=>m.mood).sort((a,b)=>a-b);console.log({maxSellPnlPct:maxPnl,soldFlags,medianMood:moods[moods.length>>1],rugsToday:o.rugs.length})})()' 10
```

Expected: `maxSellPnlPct` below 1000 (it reached 17,300), `soldFlags` 0. Moods fade with a 60-minute half-life, so read `medianMood` again after an hour: ≤ 0.5 (it was 0.85). Within about 2 hours at the dev tick `rugsToday` should be ≥ 1 (it was 0 all day).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/world/chain.ts apps/server/src/agents/decide.ts apps/server/src/agents/perceive.ts apps/server/src/agents/act.ts apps/server/src/agents/depth/beliefs.ts apps/server/src/agents/depth/memory.ts apps/server/test/agents-perceive.test.ts apps/server/test/agents-act.test.ts apps/server/test/depth-beliefs.test.ts apps/server/test/depth-memory.test.ts
git commit -m "fix(agents): average-cost P&L without launch rent, moods sized by real SOL, and honest sale reports are no longer lies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L2: No herding

Fixes analysis finding 1. `decide.ts:111-125` takes the argmax of one score whose coin terms (momentum, holders) come from the one global view every agent shares (`perceive.ts:120-133`), so all 50 agents rank coins identically and each buy raises the leader further; the only per-agent term (creator affinity) is 0 for 91% of buys. A new coin's first buy is a `launch` row that momentum ignores (`perceive.ts:34`), and a buy that keeps failing is retried forever.

The fix scores each coin per agent and samples. A prototype of exactly these terms on a 50-agent constant-product market (scratch run during planning) moved the top coin's share of buys per 10 minutes from 0.90–0.96 (today's scoring) to 0.49–0.54, with 5.7–7.2 coins bought per 10 minutes. Keeping the old momentum clamp at 1 with d² sampling still gave the leader 0.71–0.81, which is why momentum is capped too.

**Files:**
- Modify: `apps/server/src/agents/decide.ts:1-2,31-38,111-125`
- Modify: `apps/server/src/agents/types.ts:40-41` (`AgentView.failedBuys`)
- Modify: `apps/server/src/agents/perceive.ts:4,24-34,135-157`
- Test: `apps/server/test/agents-decide.test.ts`, `apps/server/test/agents-perceive.test.ts`

**Interfaces:**
- Consumes: `LAUNCH_RENT` (L1, `src/world/chain.ts`); `stanceOf(text: string, symbol: string): number | null` (existing, `src/agents/depth/beliefs.ts`).
- Produces, all in `src/agents/decide.ts`:
  - `export function pickWeighted<T>(items: [T, number][], rng: () => number): T | null` (was module-private; L6 uses it).
  - `export const MOMENTUM_CAP = 0.5`; `export function momentumOf(c: { change10m: number; change1h: number }): number`.
  - `export const TASTE = 0.2`; `export function tasteFor(agentId: string, mint: string): number` (stable, -0.2..0.2).
  - `export const NOVEL_MS = 2_700_000`; `export const BUY_CHOICES = 5`.
  - `export function feedTalk(v: AgentView): Map<string, number>` (upper-case ticker → -0.3..0.3).
  - `export interface CoinScore { d: number; why: string }`; `export function coinScore(v: AgentView, c: AgentView['coins'][number], talk?: Map<string, number>): CoinScore`.
- Produces in `src/agents/types.ts`: `AgentView.failedBuys?: string[]` (optional, so hand-built views in tests still compile).
- Produces in `src/agents/perceive.ts`: `export const FAILED_BUY_MS = 1_800_000`.

Constants (judgement calls, one line each):
- `MOMENTUM_CAP = 0.5`, applied as `0.5 * tanh(1.5 * (2·change10m + change1h))`: a pump still pulls (a +40%/10 min coin scores ~0.49) but cannot drown taste, novelty and talk; the prototype's top-coin share landed at ~0.5.
- `TASTE = 0.2`: as big as the creator-ally term at loyalty 0.4 and affinity 0.5, so taste breaks ties without overruling real reasons.
- Novelty `0.3 * curiosity * (1 - age / 45 min)` for coins with ≤ 3 holders: a curious agent gives a 5-minute-old coin a ~0.2 head start, gone after 45 minutes.
- Talk: each feed post with |stance| > 0.3 adds `±0.1 * (1 + affinity to its author)`, total clamped to ±0.3: an ally's shill counts up to twice a stranger's, an enemy's not at all.
- Concentration `-0.4 * position value / net worth`: an agent with 60% of its worth in one coin wants it 0.24 less.
- Sampling: weight `d²` over the best `BUY_CHOICES = 5` coins with `d > 0`: favours good coins without the argmax's all-or-nothing.
- `FAILED_BUY_MS = 30 min`: long enough to skip a dead pool for a while, short enough to retry after a restart or refill.

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/agents-decide.test.ts` change the decide import to

```ts
import { COOLDOWN_MS, LAUNCH_COST, LAUNCH_MIN, RESERVE, RUG_MIN_SHARE, candidates, choose, coinScore, feedTalk, tasteFor } from '../src/agents/decide.ts';
```

and append:

```ts
describe('no herding (L2)', () => {
  const twin = (mint: string) => ({ ...hot, mint, symbol: mint, change10m: 0.05, change1h: 0.1 });
  const as = (s: number) => ({ id: `agent-${s}`, username: `a${s}`, displayName: '' });
  const boughtMint = (v: AgentView, s: number) => candidates(v, mulberry32(s)).find((c) => c.kind === 'buy')?.target?.mint;
  const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

  it('agents split between two identical coins instead of all piling into one', () => {
    let a = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [twin('AAA'), twin('BBB')], agent: as(s) }, { risk: 0.6 }), s) === 'AAA') a++;
    expect(a).toBeGreaterThanOrEqual(60); // 106 of 200 when planned
    expect(a).toBeLessThanOrEqual(140);
  });
  it('gives every agent a stable taste of its own for each coin', () => {
    expect(tasteFor('x', 'M')).toBe(tasteFor('x', 'M'));
    const all = Array.from({ length: 200 }, (_, i) => tasteFor(`a${i}`, 'M'));
    expect(Math.max(...all.map(Math.abs))).toBeLessThanOrEqual(0.2);
    expect(Math.min(...all)).toBeLessThan(-0.1);
    expect(Math.max(...all)).toBeGreaterThan(0.1);
  });
  it('a coin an ally shills wins over an identical coin, and the receipt says why', () => {
    const shill = { postId: 'p1', authorId: 'pal', body: '$AAA to the moon, holding 🚀', at: NOW, reactions: 0 };
    let a = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [twin('AAA'), twin('BBB')], agent: as(s), affinity: { pal: 0.8 }, feed: [shill] }, { risk: 0.6 }), s) === 'AAA') a++;
    expect(a).toBeGreaterThanOrEqual(120); // 158 of 200 when planned
    const loud = view({ coins: [twin('AAA')], affinity: { pal: 0.8 }, feed: [shill, { ...shill, postId: 'p2' }] });
    expect(coinScore(loud, twin('AAA')).why).toBe('people I like are talking it up');
  });
  it('weighs what the feed says by who said it, and ignores its own posts', () => {
    const talk = feedTalk(view({ affinity: { pal: 0.8, foe: -1 }, feed: [
      { postId: 'p1', authorId: 'pal', body: '$AAA to the moon 🚀', at: NOW, reactions: 0 },
      { postId: 'p2', authorId: 'foe', body: '$AAA to the moon 🚀', at: NOW, reactions: 0 },
      { postId: 'p3', authorId: 'x', body: '$BBB is dead, a scam', at: NOW, reactions: 0 },
      { postId: 'p4', authorId: 'me', body: '$CCC to the moon', at: NOW, reactions: 0 },
    ] }));
    expect(talk.get('AAA')).toBeCloseTo(0.18, 9);
    expect(talk.get('BBB')).toBeCloseTo(-0.1, 9);
    expect(talk.has('CCC')).toBe(false);
  });
  it('wants a coin less the more of its net worth is already in it', () => {
    const c = twin('AAA');
    const pos = { mint: 'AAA', symbol: 'AAA', raw: 1_000_000_000, costLamports: 60_000_000, valueLamports: 60_000_000, createdByMe: false, creatorId: 'maker' };
    const held = coinScore(view({ coins: [c], wallet: { lamports: 40_000_000, positions: [pos] } }), c).d;
    const free = coinScore(view({ coins: [c], wallet: { lamports: 100_000_000, positions: [] } }), c).d;
    expect(free - held).toBeCloseTo(0.24, 9);
  });
  it('a curious agent buys a five-minute-old coin some of the time even while a hot coin runs', () => {
    const fresh = { ...hot, mint: 'NEWB', symbol: 'NEWB', holders: 1, change10m: 0.02, change1h: 0.02, launchedAt: ago(5 * 60_000) };
    let n = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [hot, fresh], agent: as(s) }, { curiosity: 0.8 }), s) === 'NEWB') n++;
    expect(n).toBeGreaterThanOrEqual(30); // 42 of 200 when planned
  });
  it('gives no novelty to a coin dated in the future (Review Focus 3)', () => {
    const fresh = { ...hot, mint: 'NEWB', symbol: 'NEWB', holders: 1, change10m: 0, change1h: 0 };
    const v = view({}, { curiosity: 1 });
    expect(coinScore(v, { ...fresh, launchedAt: new Date(Date.parse(NOW) + 10 * 60_000).toISOString() }).d)
      .toBeCloseTo(coinScore(v, { ...fresh, launchedAt: ago(50 * 60_000) }).d, 12);
  });
  it('does not retry a coin whose buy just failed', () => {
    expect(of(view({ coins: [hot], failedBuys: ['HOT'] }, { risk: 1 }), 'buy')).toEqual([]);
  });
});
```

In `apps/server/test/agents-perceive.test.ts` add `import { finishTurn, startTurn } from '../src/world/provenance.ts';` and append inside a new describe at the end:

```ts
describe('market facts (L2)', () => {
  it('counts a launch’s first buy as inflow, so a new coin has momentum', async () => {
    const creator = w.agents[26]!;
    const l = await runTool(await w.ctxFor(creator), 'launch_coin', { name: 'Fresh', symbol: 'FRSH', description: '', emoji: '🌱', initial_buy_sol: 0.02 });
    const fresh = (l.result as { mint: string }).mint;
    clearPerceptionCache(w.t.db);
    const c = (await perceive(d, creator.id)).coins.find((x) => x.mint === fresh)!;
    expect(c.change10m).toBeGreaterThan(0.03); // (1 + 0.02)² - 1 ≈ 0.04 on a 1 SOL virtual reserve
    expect(c.change1h).toBeCloseTo(c.change10m, 6);
  });
  it('remembers coins whose buy failed in the last 30 minutes', async () => {
    const a = w.agents[27]!;
    const failed = async (mint: string, at: Date) => {
      const { id } = await startTurn(w.t.db, { agentId: a.id, triggers: [{ type: 'heartbeat' }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: at });
      await finishTurn(w.t.db, id, { status: 'failed', context: [], reasoning: 'bought: test; failed: No bonding-curve pool', toolCalls: [{ name: 'buy', input: { mint, sol: 0.01, slippage_pct: 10 }, ok: false, result: { code: 'UNKNOWN_MINT' } }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: at });
    };
    await failed('OLDPOOL', new Date(w.t.clock.now().getTime() - 31 * 60_000));
    await failed('DEADPOOL', w.t.clock.now());
    expect((await perceive(d, a.id)).failedBuys).toEqual(['DEADPOOL']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-decide.test.ts test/agents-perceive.test.ts`
Expected: FAIL — `coinScore`, `feedTalk` and `tasteFor` are not exported (agents-decide does not load); in agents-perceive the new launch test fails on `change10m` (0) and `failedBuys` is `undefined`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/agents/types.ts` — in `AgentView`, after `depth: DepthView;` (line 40) add:

```ts
  /** Mints whose buy by this agent failed in the last 30 minutes (perceive fills it; absent in hand-built views). */
  failedBuys?: string[];
```

`apps/server/src/agents/decide.ts` — replace lines 1–2 with:

```ts
import { createHash } from 'node:crypto';
import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';
import { stanceOf } from './depth/beliefs.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';
```

(lines 1–2 are the chain import from L1 and the type import; both are in this block). Change `function pickWeighted<T>` (line 31) to `export function pickWeighted<T>`, and insert right after it (after line 38):

```ts
// ── Choosing a coin (L2): every agent ranks coins its own way, then samples, so the swarm spreads out. ──
/** Momentum saturates at ±MOMENTUM_CAP: a hot coin still pulls, but it cannot drown every other reason. */
export const MOMENTUM_CAP = 0.5;
export function momentumOf(c: { change10m: number; change1h: number }): number {
  return MOMENTUM_CAP * Math.tanh(1.5 * (2 * c.change10m + c.change1h));
}
/** A stable liking of one agent for one coin, in -TASTE..TASTE: idiosyncrasy from a hash, not a persona. */
export const TASTE = 0.2;
export function tasteFor(agentId: string, mint: string): number {
  const h = createHash('sha256').update(`taste:${agentId}:${mint}`).digest();
  return ((h.readUInt16BE(0) / 65535) * 2 - 1) * TASTE;
}
/** Coins younger than this with at most 3 holders get a curiosity bonus that fades to zero. */
export const NOVEL_MS = 45 * MIN;
/** How many of the best coins an agent samples from, weighted by score squared. */
export const BUY_CHOICES = 5;
const TICKER = /\$([A-Za-z0-9]{1,10})(?![A-Za-z0-9])/g;

/** What the feed says about each ticker, weighted by how this agent feels about who said it: SYMBOL → -0.3..0.3. */
export function feedTalk(v: AgentView): Map<string, number> {
  const sum = new Map<string, number>();
  for (const f of v.feed) {
    if (f.authorId === v.agent.id) continue;
    const weight = 0.1 * (1 + clamp(v.affinity[f.authorId] ?? 0, -1, 1));
    if (!weight) continue;
    const seen = new Set<string>();
    for (const m of f.body.matchAll(TICKER)) {
      const symbol = m[1]!.toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      const stance = stanceOf(f.body, symbol);
      if (stance === null || Math.abs(stance) <= 0.3) continue;
      sum.set(symbol, (sum.get(symbol) ?? 0) + Math.sign(stance) * weight);
    }
  }
  return new Map([...sum].map(([s, x]) => [s, clamp(x, -0.3, 0.3)]));
}

export interface CoinScore { d: number; why: string }
const WHY: Record<string, string> = { momentum: 'it is moving', ally: 'an ally made it', crowd: 'a crowd is in', taste: 'I just like it', novelty: 'new and barely held', talk: 'people I like are talking it up' };
/** One agent's appetite for one coin; d > 0 means worth buying. `why` names the biggest reason besides the agent's own boldness. */
export function coinScore(v: AgentView, c: AgentView['coins'][number], talk: Map<string, number> = feedTalk(v)): CoinScore {
  const t = v.state.traits;
  const ageMs = Date.parse(v.now) - Date.parse(c.launchedAt);
  const worth = v.wallet.lamports + v.wallet.positions.reduce((n, p) => n + p.valueLamports, 0);
  const held = v.wallet.positions.find((p) => p.mint === c.mint)?.valueLamports ?? 0;
  const parts: Record<string, number> = {
    momentum: momentumOf(c),
    ally: t.loyalty * Math.max(0, v.affinity[c.creatorId] ?? 0),
    crowd: (0.05 * Math.min(c.holders, 10)) / 10,
    taste: tasteFor(v.agent.id, c.mint),
    novelty: c.holders <= 3 && ageMs >= 0 ? 0.3 * t.curiosity * Math.max(0, 1 - ageMs / NOVEL_MS) : 0,
    talk: talk.get(c.symbol.toUpperCase()) ?? 0,
    concentration: worth > 0 ? (-0.4 * held) / worth : 0,
  };
  const d = 0.5 * t.risk + 0.2 * v.state.mood + WEATHER_RISK[v.weather] - 0.35 + Object.values(parts).reduce((a, b) => a + b, 0);
  const top = Object.entries(parts).filter(([k, x]) => k in WHY && x > 0.02).sort((a, b) => b[1] - a[1])[0];
  return { d, why: top ? WHY[top[0]]! : 'a hunch' };
}
```

Replace the buy block (lines 111–125, from `if (!broke && spendable >= MIN_TRADE) {` through its closing `}`) with:

```ts
  if (!broke && spendable >= MIN_TRADE) {
    const talk = feedTalk(v);
    const failed = new Set(v.failedBuys ?? []);
    const options = v.coins
      .filter((c) => !c.graduated && c.creatorId !== v.agent.id && aff(c.creatorId) > -0.5 && !failed.has(c.mint))
      .map((c) => ({ c, ...coinScore(v, c, talk) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d)
      .slice(0, BUY_CHOICES);
    // Sampled, not the argmax: the best coins are likelier, but every agent does not pile into the same one.
    const best = pickWeighted(options.map((x) => [x, x.d * x.d] as [typeof x, number]), rng);
    if (best) {
      const size = Math.floor(spendable * (0.1 + 0.4 * t.risk) * (0.5 + 0.5 * rng()));
      const lamports = Math.min(spendable, Math.max(MIN_TRADE, size));
      add({ kind: 'buy', score: 0.8 * best.d, lamports, situation: 'bought', target: { mint: best.c.mint, userId: best.c.creatorId },
        reason: `bought $${best.c.symbol}: ${best.why}, ${pct(best.c.change10m)} in 10 min, ${best.c.holders} holders, creator affinity ${f2(aff(best.c.creatorId))}, risk ${f2(t.risk)}` });
    }
  }
```

(`beliefs.ts`'s `modify` still multiplies the one buy candidate by `1 + expect`; after this change that only scales how much the agent wants to buy at all, not which coin, so it stays.)

`apps/server/src/agents/perceive.ts` — add `agentTurns` to the schema import (line 4). In `coinsView` replace the `flows` query (lines 29–34) with:

```ts
  // A launch row's SOL beyond the rent is its creator's first buy into the pool: it counts, so a new coin starts with momentum (L2).
  const inflow = sql`case when ${chainTxs.kind} = 'launch' then greatest(0, -${chainTxs.lamportsDelta} - ${sql.raw(String(LAUNCH_RENT))}) else -${chainTxs.lamportsDelta} end`;
  const flows = await db.select({
    mint: chainTxs.mint,
    total: sql<number>`coalesce(sum(${inflow}), 0)::float8`,
    h1: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${hourAgo}::timestamptz then ${inflow} else 0 end), 0)::float8`,
    m10: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${tenAgo}::timestamptz then ${inflow} else 0 end), 0)::float8`,
  }).from(chainTxs).where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).groupBy(chainTxs.mint);
```

Add before `/** Coins and rooms are the same for every agent… */` (line 120):

```ts
/** A buy that failed is not retried for this long: a dead pool or a graduated curve must not eat an agent's turns (L2). */
export const FAILED_BUY_MS = 30 * MIN;
async function failedBuysView(db: Db, agentId: string, now: Date): Promise<string[]> {
  const rows = await db.select({ calls: agentTurns.toolCalls }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.status, 'failed'), gte(agentTurns.startedAt, new Date(now.getTime() - FAILED_BUY_MS))))
    .orderBy(desc(agentTurns.seq)).limit(20);
  return [...new Set(rows.flatMap((r) => r.calls.filter((c) => c.name === 'buy' && !c.ok).map((c) => String((c.input as { mint?: unknown } | null)?.mint ?? '')).filter(Boolean)))];
}
```

In `perceive`, replace the `Promise.all` (lines 140–143) with

```ts
  const [state, phrasebook, wallet, mentions, dms, feed, affinity, failedBuys] = await Promise.all([
    loadState(d.db, agentId, now), phrasebookOf(d.db, agentId), walletView(d, agentId, globalCoins),
    mentionsView(d.db, agentId, now), dmsView(d.db, agentId, now), feedView(d.db, agentId), affinitiesOf(d.db, agentId), failedBuysView(d.db, agentId, now),
  ]);
```

and in the `const v: AgentView = { … }` literal (line 154) change the ending `depth: emptyDepth() };` to `depth: emptyDepth(), failedBuys };`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-decide.test.ts test/agents-perceive.test.ts test/agents-engine.test.ts test/depth-beliefs.test.ts && npm run typecheck`
Expected: PASS (the existing decide tests — reserve, cooldowns, bold vs timid, enemy creators — keep passing unchanged).

- [ ] **Step 5: Check it on the dev world**

Ten minutes after the reload:

```bash
node -e 'const M=Number(process.argv[1]);fetch("http://localhost:3010/api/coins/trades?limit=200").then(r=>r.json()).then(({trades})=>{const T=Date.now()-M*60e3;const b=trades.filter(x=>x.kind==="buy"&&Date.parse(x.createdAt)>T);const by={};for(const x of b)by[x.symbol]=(by[x.symbol]||0)+1;const top=Math.max(0,...Object.values(by));console.log({minutes:M,buys:b.length,coins:Object.keys(by).length,topShare:b.length?+(top/b.length).toFixed(2):null,by})})' 10
```

Expected: `coins` ≥ 5 (was 1) and `topShare` ≤ 0.6 (was 0.96–1.0). Receipts of buys now give varied reasons ("I just like it", "new and barely held", "people I like are talking it up").

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/decide.ts apps/server/src/agents/types.ts apps/server/src/agents/perceive.ts apps/server/test/agents-decide.test.ts apps/server/test/agents-perceive.test.ts
git commit -m "fix(agents): each agent ranks coins its own way and samples, so the swarm stops buying one coin at a time" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L3: Launches that mean something

Fixes analysis finding 4 and the Minor "an agent shills its own dead coin". Tickers come from 16 `WORDS` (`act.ts:36`) because the fallback phrasebook has no interests, so 36 coins share 14 tickers; nothing checks uniqueness; every agent may launch once a day regardless of how many coins already died, and the rent drains the 5 SOL economy.

**Files:**
- Create: `apps/server/src/agents/tickers.ts`
- Modify: `apps/server/src/world/tools.ts:3,115,209-212` (`symbolsInUse`, the `SYMBOL_TAKEN` guard)
- Modify: `apps/server/src/agents/act.ts:2,4,9,36-37,278-283`
- Modify: `apps/server/src/agents/decide.ts:15,40-44,99,148-154` (cooldown, dead coins, launch rate, no dead-coin shill)
- Test: create `apps/server/test/agents-tickers.test.ts`; modify `apps/server/test/world-tools.test.ts`, `apps/server/test/agents-act.test.ts`, `apps/server/test/agents-decide.test.ts`, `apps/server/test/memory-chain-restore.test.ts`

**Interfaces:**
- Consumes: `coinScore`'s section in `decide.ts` (L2) as the place to add the launch helpers after; `pickWeighted` (L2).
- Produces:
  - `src/agents/tickers.ts`: `export const WORDS: string[]` (60 words), `export const ENDINGS: string[]` (20), `export function postWords(bodies: string[]): string[]`, `export function grudgeWords(pastEvents: { kind: string; text: string }[]): string[]`, `export function launchWords(x: { interests: string[]; ownPosts: string[]; grudges: string[] }, rng: () => number): string[]`, `export function pickSymbol(words: string[], taken: ReadonlySet<string>, rng: () => number): string`, `export function coinName(symbol: string, rng: () => number): string`.
  - `src/world/tools.ts`: `export const SYMBOL_REUSE_MS = 604_800_000`; `export async function symbolsInUse(db: Db, now: Date): Promise<Set<string>>` (upper-case tickers of coins launched within the last 7 days); `launch_coin` refuses with code `SYMBOL_TAKEN`.
  - `src/agents/decide.ts`: `export const DEAD_AFTER_MS = 1_800_000`; `export function isDeadCoin(c: Pick<AgentView['coins'][number], 'holders' | 'launchedAt' | 'graduated'>, nowMs: number): boolean`; `export const LAUNCH_COMFORT = 60_000_000`; `COOLDOWN_MS.launch` = 12 h.

Constants (judgement calls):
- Dead coin = ≤ 1 holder and ≥ 30 minutes old: nobody but the creator bought it in its first half hour.
- Launch score × `1 / (1 + launches this hour + dead coins today / 4)`: with 8 dead coins a launch is a third as likely; with 10 it drops below 0.3× (pinned by a test).
- × `0.25 + 0.75 · clamp((lamports − 0.04 SOL) / 0.06 SOL, 0, 1)`: a full 0.1 SOL wallet launches at full rate, one at the 0.04 SOL floor at a quarter (the existing test that launches at exactly `LAUNCH_MIN` keeps passing).
- × 0.3 if the agent's own last coin is dead: the analysis asked for "died < 12 h ago", but the engine already blocks a second launch while the own coin is < 24 h old (`liveOwn`), so the time window could never apply; "its last coin flopped" at any age is the reachable version.
- Launch cooldown 6 h → 12 h: only matters after the agent's coin graduates (the 24 h `liveOwn` rule covers the rest).
- Ticker reuse after 7 days: old graduated or dead coins leave the newest-60 view by then, so `$SYMBOL` keeps meaning one coin to readers.
- Expected rate: about 0.15 base score against ~2 for all candidates, with ~30% of turns eligible, the median wallet (0.049 SOL, factor 0.36) and 8 dead coins (÷3) gives ~1 launch per 20 minutes at the production tick (~3 at the dev tick).

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/agents-tickers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { WORDS, coinName, grudgeWords, launchWords, pickSymbol, postWords } from '../src/agents/tickers.ts';

describe('tickers (L3)', () => {
  it('prefers the agent’s own words: interests first, then its posts, never trading filler', () => {
    const words = launchWords({ interests: ['late night charts', 'Lamp'], ownPosts: ['bought some $DRIFT, quiet in here', 'who is awake'], grudges: [] }, mulberry32(1));
    expect(words.slice(0, 3)).toEqual(['late', 'night', 'lamp']);
    expect(postWords(['bought some $DRIFT, quiet in here', 'who is awake'])).toEqual(['quiet', 'awake']);
    expect(postWords(['gm @lamp_9, $MOTH is quiet', 'Quiet again'])).toEqual(['quiet']);
  });
  it('can name a coin after a grudge', () => {
    expect(grudgeWords([{ kind: 'got_rugged', text: '@x dumped $RUST on me today' }, { kind: 'big_win', text: 'I made 50% on $MOTH today' }])).toEqual(['norust']);
    expect(coinName('NORUST', () => 0)).toBe('Norust Coin');
  });
  it('never picks a taken ticker: the next word, then two words, then a number', () => {
    const r = mulberry32(1);
    expect(pickSymbol(['lamp', 'moth'], new Set(['LAMP']), r)).toBe('MOTH');
    expect(pickSymbol(['lamp', 'moth'], new Set(['LAMP', 'MOTH']), r)).toBe('LAMPMOTH');
    expect(pickSymbol(['lamp'], new Set(['LAMP']), r)).toBe('LAMP2');
  });
  it('200 seeded launches by agents who all love lamps give 200 different tickers', () => {
    const taken = new Set<string>();
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const s = pickSymbol(launchWords({ interests: ['lamp'], ownPosts: [], grudges: [] }, r), taken, r);
      expect(taken.has(s)).toBe(false);
      expect(s).toMatch(/^[A-Z0-9]{1,10}$/);
      taken.add(s);
    }
  });
  it('falls back on 60 plain words', () => {
    expect(new Set(WORDS).size).toBe(60);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
  });
});
```

In `apps/server/test/world-tools.test.ts` change the tools import to `import { runTool, symbolsInUse, TOOLS } from '../src/world/tools.ts';`, add `import { pickSymbol } from '../src/agents/tickers.ts';`, and append:

```ts
describe('tickers (L3)', () => {
  const E = () => w.agents[40]!;
  it('refuses a ticker a coin launched in the last 7 days uses, in any case, before any SOL moves; a week later it is free', async () => {
    const now = w.t.clock.now().getTime();
    await w.t.db.insert(worldCoins).values([
      { mint: 'TAKN11111111', pool: 'PT1', creatorId: C().id, name: 'Taken', symbol: 'TAKN', launchSignature: 'sig-takn', launchedAt: new Date(now - 6 * 86_400_000) },
      { mint: 'OLDY11111111', pool: 'PO1', creatorId: C().id, name: 'Oldie', symbol: 'OLDY', launchSignature: 'sig-oldy', launchedAt: new Date(now - 8 * 86_400_000) },
    ]);
    const txs = async () => (await w.t.db.select().from(chainTxs).where(eq(chainTxs.agentId, E().id))).length;
    const before = await txs();
    expect(await run(E(), 'launch_coin', { name: 'Again', symbol: 'takn', description: '', emoji: '💡', initial_buy_sol: 0 })).toMatchObject({ ok: false, result: { code: 'SYMBOL_TAKEN' } });
    expect(await txs()).toBe(before);
    expect((await run(E(), 'launch_coin', { name: 'Oldie Again', symbol: 'OLDY', description: '', emoji: '💡', initial_buy_sol: 0 })).ok).toBe(true);
    const inUse = await symbolsInUse(w.t.db, w.t.clock.now());
    expect(inUse.has('TAKN') && inUse.has('OLDY')).toBe(true);
  });
  it('refuses a ticker that legacy duplicate coins already share (Review Focus 1)', async () => {
    const now = w.t.clock.now();
    await w.t.db.insert(worldCoins).values([
      { mint: 'DUPE11111111', pool: 'PD1', creatorId: C().id, name: 'Dupe', symbol: 'DUPE', launchSignature: 'sig-dupe1', launchedAt: now },
      { mint: 'DUPE22222222', pool: 'PD2', creatorId: B().id, name: 'Dupe Too', symbol: 'DUPE', launchSignature: 'sig-dupe2', launchedAt: now },
    ]);
    expect(await run(E(), 'launch_coin', { name: 'Dupe Three', symbol: 'DUPE', description: '', emoji: '💡', initial_buy_sol: 0 })).toMatchObject({ ok: false, result: { code: 'SYMBOL_TAKEN' } });
    expect(pickSymbol(['dupe', 'moth'], await symbolsInUse(w.t.db, w.t.clock.now()), () => 0)).toBe('MOTH');
  });
});
```

In `apps/server/test/memory-chain-restore.test.ts` add `signerFor` to the wallets import (`import { TREASURY, signerFor, walletOf } from '../src/world/wallets.ts';`) and in `'never repeats a mint or a signature from before the restart'` replace

```ts
    // The same ticker again: only the signature counter keeps the new mint apart from the first coin's.
    const launched = (await act(fresh, 3, 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 })).result as { mint: string; signature: string };
```

with

```ts
    // The same ticker again, straight on the chain (the launch tool now refuses a ticker in use, L3): only the signature
    // counter keeps the new mint apart from the first coin's.
    const launched = await fresh.launch(await signerFor(w.t.db, w.agents[3]!.id, w.key), { name: 'Lamp', symbol: 'LAMP', uri: '', initialBuyLamports: 10_000_000 });
```

In `apps/server/test/agents-act.test.ts`, inside `describe('act', …)`:

```ts
  it('launches under a ticker from its own words that no coin this week has taken (L3)', async () => {
    const [maker, other] = [w.agents[32]!, w.agents[33]!];
    await runTool(await sealed(other), 'launch_coin', { name: 'Fern', symbol: 'FERN', description: '', emoji: '🌿', initial_buy_sol: 0 });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, maker.id);
    const r = await act(d, { ...v, phrasebook: { ...v.phrasebook, interests: ['fern', 'moss'] } }, { kind: 'launch', score: 1, lamports: 0, situation: 'launching', reason: 'launching a coin: test' });
    expect(r.ok).toBe(true);
    const [coin] = await w.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, maker.id));
    expect(coin).toMatchObject({ symbol: 'MOSS', name: expect.stringMatching(/^Moss /) });
  });
```

In `apps/server/test/agents-decide.test.ts` add `isDeadCoin` to the decide import and append:

```ts
describe('launches that mean something (L3)', () => {
  const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
  it('launches far less while dead coins pile up', () => {
    const dead = Array.from({ length: 10 }, (_, i) => ({ ...hot, mint: `D${i}`, symbol: `D${i}`, holders: 1, change10m: 0, change1h: 0, launchedAt: ago(2 * 3_600_000) }));
    expect(of(view({ coins: dead }), 'launch')[0]!.score).toBeLessThan(0.3 * of(view(), 'launch')[0]!.score);
  });
  it('launches less from a thin wallet, and after its own last coin flopped', () => {
    const rich = of(view(), 'launch')[0]!.score;
    expect(of(view({ wallet: { lamports: 50_000_000, positions: [] } }), 'launch')[0]!.score / rich).toBeCloseTo(0.25 + 0.75 / 6, 9);
    const flop = { ...hot, mint: 'MYOLD', symbol: 'MYOLD', creatorId: 'me', holders: 1, launchedAt: ago(30 * 3_600_000) };
    const [l] = of(view({ coins: [flop] }), 'launch');
    expect(l!.score / rich).toBeCloseTo(0.3, 9);
    expect(l!.reason).toContain('my last coin flopped');
  });
  it('waits 12 hours between its own launches', () => {
    expect(COOLDOWN_MS.launch).toBe(12 * 3_600_000);
  });
  it('stops shilling its own coin once nobody bought it in its first half hour', () => {
    const mine = { ...hot, mint: 'MINE', symbol: 'MINE', creatorId: 'me', holders: 1, change10m: 0, change1h: 0, launchedAt: ago(3 * 3_600_000) };
    for (let s = 0; s < 50; s++) expect(candidates(view({ coins: [mine] }), mulberry32(s)).find((c) => c.kind === 'post')!.situation).not.toBe('shilling');
    expect(isDeadCoin(mine, Date.parse(NOW))).toBe(true);
    expect(isDeadCoin({ ...mine, launchedAt: ago(10 * 60_000) }, Date.parse(NOW))).toBe(false);
    expect(isDeadCoin({ ...mine, holders: 2 }, Date.parse(NOW))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-tickers.test.ts test/world-tools.test.ts test/agents-act.test.ts test/agents-decide.test.ts test/memory-chain-restore.test.ts`
Expected: FAIL — `src/agents/tickers.ts` does not exist; `symbolsInUse` and `isDeadCoin` are not exported (three files fail to load); `memory-chain-restore` still passes (its change only matters once the guard exists).

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/agents/tickers.ts`:

```ts
/**
 * Tickers and coin names from the agent's own words (L3). Pure: act() gathers the words and the taken symbols, these pick.
 * The fallback list is reached only when the agent's interests and posts give nothing usable.
 */
export const WORDS = [
  'moth', 'lamp', 'ember', 'grit', 'tide', 'fern', 'echo', 'rust', 'orbit', 'mint', 'gloom', 'spark', 'drift', 'pebble', 'comet', 'hush',
  'quartz', 'nimbus', 'cobalt', 'thorn', 'velvet', 'marble', 'cinder', 'willow', 'raven', 'lumen', 'glacier', 'saffron', 'pylon', 'static',
  'bramble', 'harbor', 'lichen', 'magnet', 'nectar', 'onyx', 'prism', 'quill', 'ripple', 'sable', 'tundra', 'umber', 'vapor', 'wisp',
  'zephyr', 'anvil', 'beacon', 'canyon', 'dune', 'falcon', 'gecko', 'hollow', 'iris', 'jasper', 'kelp', 'lotus', 'mango', 'nova', 'opal', 'pixel',
];
export const ENDINGS = ['Coin', 'Club', 'Fund', 'Token', 'Money', 'Cult', 'Society', 'Union', 'Works', 'Labs', 'Party', 'House', 'Gang', 'Market', 'Collective', 'Network', 'Republic', 'Supply', 'Signal', 'Project'];
/** Words that say nothing about the agent: trading talk, filler and the words of stock lines. */
const STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'just', 'have', 'what', 'who', 'are', 'was', 'not', 'but', 'all', 'any', 'can', 'out', 'now',
  'its', 'into', 'from', 'some', 'more', 'than', 'then', 'they', 'them', 'there', 'here', 'about', 'still', 'again', 'today', 'when', 'will', 'would',
  'bought', 'sold', 'sell', 'selling', 'buy', 'buying', 'coin', 'coins', 'holders', 'holder', 'price', 'profit', 'took', 'down', 'pump', 'dump',
  'launched', 'launch', 'live', 'chart', 'charts', 'feed', 'post', 'posting', 'agent', 'agents', 'shillex', 'market', 'trade', 'trading', 'wallet',
  'nothing', 'something', 'anyway', 'honestly', 'look', 'well', 'fine', 'okay', 'yes', 'yeah', 'lol', 'gm', 'ngmi', 'wagmi',
]);
const usable = (w: string) => /^[a-z]{3,8}$/.test(w) && !STOP.has(w);

/** Words from the agent's own posts, in order of first use; tickers and @mentions are not words. */
export function postWords(bodies: string[]): string[] {
  const out: string[] = [];
  for (const b of bodies) for (const w of b.toLowerCase().replace(/[$@][a-z0-9_]+/g, ' ').split(/[^a-z]+/)) if (usable(w) && !out.includes(w)) out.push(w);
  return out;
}

/** "no" + the ticker of each coin the agent was rugged on: a grudge it may name a coin after. */
export function grudgeWords(pastEvents: { kind: string; text: string }[]): string[] {
  return pastEvents.filter((e) => e.kind === 'got_rugged').flatMap((e) => {
    const m = /\$([A-Za-z]{2,6})(?![A-Za-z0-9])/.exec(e.text);
    return m ? [`no${m[1]!.toLowerCase()}`] : [];
  });
}

/**
 * The agent's candidate words, its own first: half the time a grudge, then its interests (multi-word ones split),
 * then words from its recent posts (shuffled), then the fallback list (shuffled).
 */
export function launchWords(x: { interests: string[]; ownPosts: string[]; grudges: string[] }, rng: () => number): string[] {
  const shuffle = (xs: string[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const interests = x.interests.flatMap((i) => i.toLowerCase().split(/[^a-z]+/)).filter(usable);
  const grudges = rng() < 0.5 ? x.grudges.filter((g) => /^[a-z]{3,8}$/.test(g)) : [];
  return [...new Set([...grudges, ...interests, ...shuffle(postWords(x.ownPosts)).slice(0, 12), ...shuffle(WORDS)])];
}

/** The first of the agent's words not taken as a ticker; then two words joined (≤ 10 letters); then a word and a number. Never a taken symbol. */
export function pickSymbol(words: string[], taken: ReadonlySet<string>, rng: () => number): string {
  const free = (s: string) => /^[A-Z0-9]{1,10}$/.test(s) && !taken.has(s);
  const ws = words.map((w) => w.toUpperCase().slice(0, 8)).filter((w) => w.length >= 3);
  for (const w of ws) if (free(w)) return w;
  for (const a of ws.slice(0, 8)) for (const b of ws) if (a !== b && `${a}${b}`.length <= 10 && free(`${a}${b}`)) return `${a}${b}`;
  for (const a of ws) for (let n = 2; n < 100; n++) if (free(`${a}${n}`)) return `${a}${n}`;
  for (;;) { const s = `C${Math.floor(rng() * 1e9)}`; if (free(s)) return s; }
}

/** "Moss Cult", "Norust Society": the ticker as a word plus an ending. */
export function coinName(symbol: string, rng: () => number): string {
  const word = symbol.charAt(0) + symbol.slice(1).toLowerCase();
  return `${word} ${ENDINGS[Math.floor(rng() * ENDINGS.length)]!}`.slice(0, 32);
}
```

`apps/server/src/world/tools.ts` — line 3 becomes `import { eq, gt, sql } from 'drizzle-orm';`. Add before `type Handler = …` (line 115):

```ts
/** A ticker stays reserved for a week after its coin launched, so `$SYMBOL` keeps meaning one coin (L3). */
export const SYMBOL_REUSE_MS = 7 * 86_400_000;
export async function symbolsInUse(db: Db, now: Date): Promise<Set<string>> {
  const rows = await db.select({ s: worldCoins.symbol }).from(worldCoins).where(gt(worldCoins.launchedAt, new Date(now.getTime() - SYMBOL_REUSE_MS)));
  return new Set(rows.map((r) => r.s.toUpperCase()));
}
```

In `launch_coin`, right after the `BAD_SYMBOL` line (line 211), add:

```ts
    // Checked before any SOL moves; also covers a model-written launch (L3).
    if ((await symbolsInUse(ctx.db, ctx.now())).has(symbol)) fail('SYMBOL_TAKEN', `$${symbol} belongs to a coin launched this week; pick another ticker`);
```

`apps/server/src/agents/act.ts` — imports: line 2 becomes `import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';`, line 4 becomes `import { agentTurns, communities, channels, conversationMembers, posts, users, worldCoins } from '../db/schema.ts';`, line 9 becomes `import { runTool, symbolsInUse, type ToolContext, type ToolOutcome } from '../world/tools.ts';`, and add `import { coinName, grudgeWords, launchWords, pickSymbol } from './tickers.ts';` after the `./phrasebook.ts` import. Delete the `WORDS` and `ENDINGS` constants (lines 36–37; they now live in `tickers.ts`). In the `launch` case replace lines 279–283 (from `const own = …` through the `call('launch_coin', …)` line) with:

```ts
        // A ticker from the agent's own words (a grudge, its interests, its posts), never one a coin this week already has (L3).
        const ownPosts = (await db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(20)).map((p) => p.body);
        const words = launchWords({ interests: v.phrasebook.interests, ownPosts, grudges: grudgeWords(v.depth.pastEvents) }, d.rng);
        const symbol = pickSymbol(words, await symbolsInUse(db, now), d.rng);
        const name = coinName(symbol, d.rng);
        const r = await call('launch_coin', { name, symbol, description: `${name}, launched by @${v.agent.username}`, emoji: pick(EMOJI, d.rng), initial_buy_sol: (c.lamports ?? 0) / LAMPORTS_PER_SOL });
```

`apps/server/src/agents/decide.ts`:
- In `COOLDOWN_MS` change `launch: 6 * HOUR` to `launch: 12 * HOUR`.
- After the `coinScore` function (L2) add:

```ts
// ── Launches (L3) ──
/** A coin nobody but its creator bought within its first half hour. */
export const DEAD_AFTER_MS = 30 * MIN;
export function isDeadCoin(c: Pick<AgentView['coins'][number], 'holders' | 'launchedAt' | 'graduated'>, nowMs: number): boolean {
  return !c.graduated && c.holders <= 1 && nowMs - Date.parse(c.launchedAt) >= DEAD_AFTER_MS;
}
/** A wallet this far above LAUNCH_MIN launches at full rate; poorer ones still can, down to a quarter as often. */
export const LAUNCH_COMFORT = 60_000_000;
```

- In `candidates`, after `const energyFactor = …` add `const nowMs = Date.parse(v.now);`.
- Replace `const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated);` with:

```ts
  // A creator stops shilling its coin once it is dead (L3).
  const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated && !isDeadCoin(c, nowMs));
```

- Replace the launch block (from `const liveOwn = …` through the closing `}` of `if (!broke && v.wallet.lamports >= LAUNCH_MIN && !liveOwn) {`) with:

```ts
  const liveOwn = v.coins.some((c) => c.creatorId === v.agent.id && !c.graduated && nowMs - Date.parse(c.launchedAt) < 24 * HOUR);
  if (!broke && v.wallet.lamports >= LAUNCH_MIN && !liveOwn) {
    const initial = Math.max(0, Math.floor((v.wallet.lamports - RESERVE - LAUNCH_COST) * 0.3 * t.risk));
    const recent = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < HOUR).length;
    // Dead coins from the last day damp launches, a thin wallet launches less, and a creator whose last coin flopped is shy.
    const dead = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < 24 * HOUR && isDeadCoin(c, nowMs)).length;
    const wealth = 0.25 + 0.75 * clamp((v.wallet.lamports - LAUNCH_MIN) / LAUNCH_COMFORT, 0, 1);
    const last = v.coins.filter((c) => c.creatorId === v.agent.id).sort((a, b) => b.launchedAt.localeCompare(a.launchedAt))[0];
    const shy = last && isDeadCoin(last, nowMs) ? 0.3 : 1;
    add({ kind: 'launch', score: ((0.05 + 0.1 * t.risk + 0.1 * t.greed + 0.05 * Math.max(0, mood)) / (1 + recent + dead / 4)) * wealth * shy, lamports: initial, situation: 'launching',
      reason: `launching a coin: ${sol(v.wallet.lamports)} SOL in the wallet, ${recent} launched this hour, ${dead} dead today, risk ${f2(t.risk)}${shy < 1 ? ', my last coin flopped' : ''}` });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-tickers.test.ts test/world-tools.test.ts test/agents-act.test.ts test/agents-decide.test.ts test/memory-chain-restore.test.ts test/agents-perceive.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check it on the dev world**

The dev database already holds duplicates (LAMP ×5…); new launches must avoid all of them. Twenty minutes after the reload:

```bash
node -e 'const M=Number(process.argv[1]);fetch("http://localhost:3010/api/coins").then(r=>r.json()).then(({coins})=>{const now=Date.now(),T=now-M*60e3;const n={};for(const c of coins)if(now-Date.parse(c.launchedAt)<7*864e5)n[c.symbol]=(n[c.symbol]||0)+1;const fresh=coins.filter(c=>Date.parse(c.launchedAt)>T);const dead=coins.filter(c=>!c.graduated&&c.holders<=1&&now-Date.parse(c.launchedAt)>=18e5&&now-Date.parse(c.launchedAt)<864e5).length;console.log({minutes:M,launched:fresh.map(c=>c.symbol+" "+c.name),freshDuplicates:fresh.filter(c=>n[c.symbol]>1).map(c=>c.symbol),deadToday:dead})})' 20
```

Expected: `freshDuplicates` is always `[]`; with `deadToday` ≥ 8, `launched` has at most ~3 entries per 20 minutes at the dev tick (36 coins in 3 h before); names are no longer six variants of "Drift Cult".

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/tickers.ts apps/server/src/world/tools.ts apps/server/src/agents/act.ts apps/server/src/agents/decide.ts apps/server/test/agents-tickers.test.ts apps/server/test/world-tools.test.ts apps/server/test/agents-act.test.ts apps/server/test/agents-decide.test.ts apps/server/test/memory-chain-restore.test.ts
git commit -m "fix(agents): unique tickers from each agent's own words, a SYMBOL_TAKEN guard, and launches that slow down as dead coins pile up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L4: Feelings flow both ways, talk meets trades

Fixes analysis finding 2 (a), (b) and (c). Affinity only moves toward creators (`act.ts:238`, `act.ts:248`, `act.ts:182-183`); 1,079 reactions changed nothing; replies happen only to mentions or to posts by allies and foes (`decide.ts:73-82`, which needs |affinity| > 0.3), so most agents never start a thread: 36 replies in 3 hours.

This task puts every feeling rule in one pure module, `social.ts`, wires `act` to it, and adds belief-driven replies. The sweeps that also use these rules (co-holder bonds, decay, feuds) are L5. A rule-level simulation in this task's tests shows the rules can make both friends and enemies; the prototype it was tuned on (scratch, during planning) gave 2–4 factions and 39–61 hostile pairs (of 1,225) after 12 simulated hours, and 15–25 hostile pairs but no faction after 3 hours, across 8 seeds.

**Files:**
- Create: `apps/server/src/agents/social.ts`
- Modify: `apps/server/src/agents/state.ts:58-65` (add `applyFeelings`)
- Modify: `apps/server/src/agents/act.ts:14,142,182-183,186-191,238,248`
- Modify: `apps/server/src/agents/types.ts:35` (`feed[].replied`)
- Modify: `apps/server/src/agents/perceive.ts:100-108` (`feedView` marks answered posts)
- Modify: `apps/server/src/agents/decide.ts:72-74` (allies and foes: skip answered posts)
- Modify: `apps/server/src/agents/depth/beliefs.ts:6,80-91` (belief-driven replies)
- Test: create `apps/server/test/agents-social.test.ts`; modify `apps/server/test/agents-act.test.ts`, `apps/server/test/depth-beliefs.test.ts`, `apps/server/test/agents-perceive.test.ts`, `apps/server/test/agents-decide.test.ts`

**Interfaces:**
- Consumes: `stanceOf` (existing), `findCliques(aff, taken)` and `FORM_AT = 0.5` (existing, `src/agents/depth/factions.ts`, used by the simulation test), `mulberry32` (existing).
- Produces, all in `src/agents/social.ts`:
  - `export interface Feeling { from: string; to: string; delta: number }`; `export type AffinityMap = Map<string, Map<string, number>>`.
  - `export const REACTION_FEELING: Readonly<Record<string, number>>`; `export function reactionPool(affinity: number): string[]`; `export function reactionFeelings(authorId: string, reactorId: string, emoji: string): Feeling[]`.
  - `export const REPLY_WARMTH = 0.05, ROAST_STING = 0.15`; `export function replyFeelings(situation: string | undefined, authorId: string, replierId: string): Feeling[]`.
  - `export function buyFeelings(buyerId: string, creatorId: string): Feeling[]`; `export function sellFeelings(sellerId: string, creatorId: string, pnl: number): Feeling[]`.
  - `export const DROP_AT = 0.1`; `export function dropFeelings(sellerId: string, holderIds: string[], drop: number): Feeling[]`.
  - `export const PUMP_AT = 0.3, BOND = 0.02, BOND_HOLDERS = 10`; `export function pumpBonds(holderIds: string[]): Feeling[]`.
  - `export const HALF_LIFE_MS = 86_400_000`; `export function decayFactor(elapsedMs: number): number`.
  - `export const FEUD_MOMENT_AT = -0.7`; `export function feudPairs(aff: AffinityMap, at?: number): [string, string][]` (sorted id pairs whose mean both ways is ≤ `at`).
  - `export function applyInMemory(aff: AffinityMap, feelings: Feeling[]): void`.
- Produces in `src/agents/state.ts`: `export async function applyFeelings(db: Db, feelings: Feeling[], now: Date): Promise<void>`.
- Produces in `src/agents/types.ts`: `AgentView['feed'][number].replied?: boolean`.
- `beliefsModule.candidates(v, rng)` now also returns at most one `reply` candidate with `target.mint` set.

Constants (judgement calls):
- Reactions ±0.03 (🔥🚀🫡 warm, 😂💀 cool, 👀 nothing): a reaction is cheap, so it nudges; ~17 mocking reactions equal one roast. Neutral agents pick from 👀😂🔥, so feelings between strangers random-walk until one side tips, which is how relationships start.
- Replies ±0.05 both ways; a roast −0.15 to the roasted and −0.05 back: unchanged magnitudes from Phase 2, now symmetric.
- Seller → creator +0.1 at P&L ≥ +20%, −0.1 at ≤ −30%: as strong as a buy's effect on the creator, so money made or lost on a coin is personal both ways.
- Belief replies score `0.3 · chattiness · max(|expect|, 0.3 if held)`: about a third of an ally reply, ~4% of turns for a mid agent, so threads start without drowning posts.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/agents-social.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { findCliques } from '../src/agents/depth/factions.ts';
import {
  applyInMemory, buyFeelings, decayFactor, dropFeelings, feudPairs, pumpBonds, reactionFeelings, reactionPool, replyFeelings, sellFeelings, type AffinityMap,
} from '../src/agents/social.ts';

describe('feeling rules (L4)', () => {
  it('reactions, replies and trades move feelings both ways', () => {
    expect(reactionFeelings('author', 'me', '🔥')).toEqual([{ from: 'author', to: 'me', delta: 0.03 }]);
    expect(reactionFeelings('author', 'me', '💀')).toEqual([{ from: 'author', to: 'me', delta: -0.03 }]);
    expect(reactionFeelings('author', 'me', '👀')).toEqual([]);
    expect(reactionPool(0.5)).toEqual(['🔥', '🚀', '🫡']);
    expect(reactionPool(-0.5)).toEqual(['💀', '😂']);
    expect(reactionPool(0)).toEqual(['👀', '😂', '🔥']);
    expect(replyFeelings('reply_agree', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: 0.05 }, { from: 'me', to: 'a', delta: 0.05 }]);
    expect(replyFeelings('reply_disagree', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: -0.05 }, { from: 'me', to: 'a', delta: -0.05 }]);
    expect(replyFeelings('roast', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: -0.15 }, { from: 'me', to: 'a', delta: -0.05 }]);
    expect(replyFeelings('reply_human', 'a', 'me')).toEqual([]);
    expect(buyFeelings('me', 'maker')).toEqual([{ from: 'maker', to: 'me', delta: 0.1 }]);
    expect(sellFeelings('me', 'maker', 0.5)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }, { from: 'me', to: 'maker', delta: 0.1 }]);
    expect(sellFeelings('me', 'maker', -0.4)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }, { from: 'me', to: 'maker', delta: -0.1 }]);
    expect(sellFeelings('me', 'maker', 0)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }]);
  });
  it('holders sour on a seller who crashes the price, and bond over a pump', () => {
    expect(dropFeelings('s', ['h1', 's', 'h2'], 0.12)).toEqual([{ from: 'h1', to: 's', delta: -0.05 }, { from: 'h2', to: 's', delta: -0.05 }]);
    expect(dropFeelings('s', ['h1'], 0.05)).toEqual([]);
    expect(pumpBonds(['a', 'b', 'c'])).toHaveLength(6);
    expect(pumpBonds(Array.from({ length: 15 }, (_, i) => `h${i}`))).toHaveLength(90);
  });
  it('feelings halve in a day, a feud needs both sides to mean it, and the map clamps like adjustAffinity', () => {
    expect(decayFactor(24 * 3600_000)).toBeCloseTo(0.5);
    expect(decayFactor(5 * 60_000)).toBeCloseTo(0.9976, 4);
    expect(decayFactor(-1000)).toBe(1);
    const aff: AffinityMap = new Map([['a', new Map([['b', -0.8], ['c', -0.9]])], ['b', new Map([['a', -0.7]])], ['c', new Map([['a', -0.4]])]]);
    expect(feudPairs(aff)).toEqual([['a', 'b']]);
    expect(feudPairs(aff, -0.6)).toEqual([['a', 'b'], ['a', 'c']]);
    applyInMemory(aff, [{ from: 'a', to: 'b', delta: -5 }, { from: 'a', to: 'a', delta: 1 }]);
    expect(aff.get('a')!.get('b')).toBe(-1);
    expect(aff.get('a')!.has('a')).toBe(false);
  });
});

/**
 * The feeling rules on their own, with no database: 50 agents, one turn per 4 s (the production tick's average) and a
 * 5-minute sweep (decay; each coin pumps with chance 0.15 and bonds its holders). The action mix follows decide's score
 * ratios for a mid-trait agent: post 25%, react 25%, reply 7%, buy 15%, sell 10%, rest idle; an agent answers a reply to
 * it on 30% of its turns while the reply is under 30 minutes old (decide's mention score, 0.4 + 0.3·chattiness, against ~2).
 */
function simulate(seed: number, turns: number) {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;
  const ids = Array.from({ length: 50 }, (_, i) => `a${String(i).padStart(2, '0')}`);
  const petty = new Map(ids.map((id) => [id, 0.2 + 0.6 * rng()]));
  const aff: AffinityMap = new Map();
  const feel = (a: string, b: string) => aff.get(a)?.get(b) ?? 0;
  const coins = Array.from({ length: 12 }, (_, i) => ({ creator: ids[i]!, holders: new Set<string>() }));
  const feed: string[] = [];
  const replies = new Map<string, { from: string; turn: number }[]>();
  const reply = (me: string, author: string, situation: string, turn: number) => {
    applyInMemory(aff, replyFeelings(situation, author, me));
    replies.set(author, [...(replies.get(author) ?? []), { from: me, turn }]);
  };
  const tone = (me: string, other: string) => (feel(me, other) >= 0 ? 'reply_agree' : petty.get(me)! > 0.5 ? 'roast' : 'reply_disagree');
  for (let turn = 0; turn < turns; turn++) {
    if (turn % 75 === 0) {
      const f = decayFactor(5 * 60_000);
      for (const row of aff.values()) for (const [k, s] of row) row.set(k, s * f);
      for (const c of coins) if (rng() < 0.15) applyInMemory(aff, pumpBonds([...c.holders]));
    }
    const me = pick(ids);
    const waiting = (replies.get(me) ?? []).filter((x) => turn - x.turn < 450);
    replies.set(me, waiting);
    if (waiting.length && rng() < 0.3) { const x = waiting.shift()!; reply(me, x.from, tone(me, x.from), turn); continue; }
    const r = rng();
    const author = feed.length ? pick(feed) : null;
    if (r < 0.25) { feed.push(me); if (feed.length > 40) feed.shift(); }
    else if (r < 0.5 && author && author !== me) applyInMemory(aff, reactionFeelings(author, me, pick(reactionPool(feel(me, author)))));
    else if (r < 0.57 && author && author !== me) {
      const s = feel(me, author);
      reply(me, author, s > 0.3 || s < -0.3 ? tone(me, author) : rng() < 0.5 ? 'reply_agree' : petty.get(me)! > 0.5 ? 'roast' : 'reply_disagree', turn);
    } else if (r < 0.72) { const c = pick(coins); c.holders.add(me); applyInMemory(aff, buyFeelings(me, c.creator)); }
    else if (r < 0.82) {
      const held = coins.filter((c) => c.holders.has(me));
      if (!held.length) continue;
      const c = pick(held);
      c.holders.delete(me);
      applyInMemory(aff, sellFeelings(me, c.creator, rng() * 1.4 - 0.6));
      if (rng() < 0.3) applyInMemory(aff, dropFeelings(me, [...c.holders], 0.12));
    }
  }
  const pairs: number[] = [];
  for (const a of ids) for (const b of ids) if (a < b) pairs.push((feel(a, b) + feel(b, a)) / 2);
  return { cliques: findCliques(aff, new Set()), hostile: pairs.filter((m) => m <= -0.4).length, pairs: pairs.length };
}

describe('the rules alone make friends and enemies (L4)', () => {
  it('over 12 hours of turns, factions can form and some pairs turn hostile, but not everyone', () => {
    for (const seed of [1, 2, 3]) {
      const r = simulate(seed, 10_800);
      expect(r.cliques.length).toBeGreaterThanOrEqual(1); // 4, 2, 2 when planned
      expect(r.hostile).toBeGreaterThanOrEqual(1); // 39, 51, 61 of 1,225 when planned
      expect(r.hostile).toBeLessThanOrEqual(r.pairs * 0.1);
      expect(r.cliques.every((c) => c.length <= 6)).toBe(true);
    }
  });
  it('three hours in, hostility already shows', () => {
    expect(simulate(1, 2_700).hostile).toBeGreaterThanOrEqual(1); // 15 when planned
  });
});
```

In `apps/server/test/agents-act.test.ts`, inside `describe('act', …)`:

```ts
  it('a profitable sale warms the seller to the creator; the creator still cools on the seller (L4)', async () => {
    const [creator, seller] = [w.agents[34]!, w.agents[35]!];
    const l = await runTool(await sealed(creator), 'launch_coin', { name: 'Warm', symbol: 'WARM', description: '', emoji: '☀️', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await sealed(seller), 'buy', { mint, sol: 0.01, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, seller.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const rigged = { ...v, wallet: { ...v.wallet, positions: v.wallet.positions.map((p) => (p.mint === mint ? { ...p, costLamports: 1_000_000, valueLamports: 3_000_000 } : p)) } };
    const r = await act(d, rigged, { kind: 'sell', score: 1, raw: pos.raw, situation: 'took_profit', target: { mint, userId: creator.id }, reason: 'took profit on $WARM' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, seller.id))[creator.id]).toBeCloseTo(0.1);
    expect((await affinitiesOf(w.t.db, creator.id))[seller.id]).toBeCloseTo(-0.08);
  });
  it('a mocking reaction cools the author toward the reactor (L4)', async () => {
    const [author, reactor] = [w.agents[36]!, w.agents[37]!];
    const p = await runTool(await sealed(author), 'post', { body: 'a take to laugh at' });
    const v = await perceive(d, reactor.id);
    // The reactor already dislikes the author, so it reaches for 💀 or 😂, and both sting.
    const r = await act(d, { ...v, affinity: { ...v.affinity, [author.id]: -0.5 } }, { kind: 'react', score: 1, target: { postId: (p.result as { post_id: string }).post_id, userId: author.id }, reason: 'reacting to a post' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[reactor.id]).toBeCloseTo(-0.03);
  });
  it('disagreeing cools both sides (L4)', async () => {
    const [author, replier] = [w.agents[38]!, w.agents[39]!];
    const p = await runTool(await sealed(author), 'post', { body: 'a take worth arguing with' });
    const v = await perceive(d, replier.id);
    const r = await act(d, v, { kind: 'reply', score: 1, situation: 'reply_disagree', target: { postId: (p.result as { post_id: string }).post_id, userId: author.id }, reason: 'disagree' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[replier.id]).toBeCloseTo(-0.05);
    expect((await affinitiesOf(w.t.db, replier.id))[author.id]).toBeCloseTo(-0.05);
  });
```

In `apps/server/test/depth-beliefs.test.ts` (its imports already cover `beliefsModule`, `emptyDepth` and `AgentView`) append:

```ts
describe('talk meets trades (L4)', () => {
  const traits = { risk: 0.5, chattiness: 0.8, loyalty: 0.5, pettiness: 0.3, greed: 0.3, humor: 0.5, curiosity: 0.5 };
  const belief = (expect: number) => ({ HOTM: { expect, trustCreator: 0.5, stance: null, stanceAt: null } });
  const talkView = (over: Record<string, unknown> = {}, t: Partial<typeof traits> = {}) => ({
    agent: { id: 'me', username: 'me', displayName: '' },
    state: { traits: { ...traits, ...t } },
    wallet: { lamports: 50_000_000, positions: [] },
    coins: [{ mint: 'HOTM', symbol: 'HOT', creatorId: 'maker' }],
    feed: [{ postId: 'p1', authorId: 'x', body: '$HOT to the moon 🚀', at: '', reactions: 0 }],
    depth: { ...emptyDepth(), beliefs: belief(-0.5) },
    ...over,
  }) as unknown as AgentView;
  const replies = (v: AgentView) => beliefsModule.candidates!(v, () => 0).filter((c) => c.kind === 'reply');
  it('pushes back on a bullish post about a coin it expects to fall', () => {
    const [c] = replies(talkView());
    expect(c).toMatchObject({ situation: 'reply_disagree', target: { postId: 'p1', userId: 'x', mint: 'HOTM' } });
    expect(c!.score).toBeCloseTo(0.3 * 0.8 * 0.5);
  });
  it('roasts instead when petty, and agrees when the post leans its way', () => {
    expect(replies(talkView({}, { pettiness: 0.9 }))[0]).toMatchObject({ situation: 'roast' });
    expect(replies(talkView({ depth: { ...emptyDepth(), beliefs: belief(0.5) } }))[0]).toMatchObject({ situation: 'reply_agree' });
  });
  it('answers a post about a coin it holds even without a strong view, and stays out of the rest', () => {
    const calm = { depth: { ...emptyDepth(), beliefs: belief(0.1) } };
    expect(replies(talkView(calm))).toEqual([]);
    const holding = talkView({ ...calm, wallet: { lamports: 50_000_000, positions: [{ mint: 'HOTM', symbol: 'HOT', raw: 1, costLamports: 1, valueLamports: 1, createdByMe: false, creatorId: 'maker' }] } });
    expect(replies(holding)[0]).toMatchObject({ situation: 'reply_agree' });
    expect(replies(holding)[0]!.score).toBeCloseTo(0.3 * 0.8 * 0.3);
  });
  it('never answers its own post or one it already answered', () => {
    expect(replies(talkView({ feed: [{ postId: 'p1', authorId: 'x', body: '$HOT to the moon 🚀', at: '', reactions: 0, replied: true }] }))).toEqual([]);
    expect(replies(talkView({ feed: [{ postId: 'p1', authorId: 'me', body: '$HOT to the moon 🚀', at: '', reactions: 0 }] }))).toEqual([]);
  });
});
```

In `apps/server/test/agents-perceive.test.ts` append:

```ts
describe('the feed (L4)', () => {
  it('marks feed posts the agent already replied to', async () => {
    const [author, me] = [w.agents[28]!, w.agents[29]!];
    const p = await runTool(await w.ctxFor(author), 'post', { body: 'reply bait for the replied flag' });
    const postId = (p.result as { post_id: string }).post_id;
    expect((await perceive(d, me.id)).feed.find((f) => f.postId === postId)?.replied).toBe(false);
    await runTool(await w.ctxFor(me), 'reply', { post_id: postId, body: 'answered once' });
    expect((await perceive(d, me.id)).feed.find((f) => f.postId === postId)?.replied).toBe(true);
  });
});
```

In `apps/server/test/agents-decide.test.ts` append:

```ts
describe('talk (L4)', () => {
  it('does not answer a post it already replied to', () => {
    const post = { postId: 'p1', authorId: 'pal', body: 'gm', at: NOW, reactions: 0 };
    expect(of(view({ affinity: { pal: 0.8 }, feed: [post] }), 'reply')).toHaveLength(1);
    expect(of(view({ affinity: { pal: 0.8 }, feed: [{ ...post, replied: true }] }), 'reply')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-social.test.ts test/agents-act.test.ts test/depth-beliefs.test.ts test/agents-perceive.test.ts test/agents-decide.test.ts`
Expected: FAIL — `src/agents/social.ts` does not exist; in agents-act the seller → creator affinity is `undefined`, the 💀 reaction leaves the author at `undefined` and the disagreement at `undefined`; the belief replies and `replied` flags are missing.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/agents/social.ts`:

```ts
/**
 * How actions move feelings between agents. Pure: act(), the bonds module and the simulations share these rules.
 * A Feeling means `from` now feels `delta` more toward `to` (affinity is directional and clamped to -1..1).
 */
export interface Feeling { from: string; to: string; delta: number }
export type AffinityMap = Map<string, Map<string, number>>;

/** Warm emoji warm the author toward the reactor, mocking ones cool them; 👀 carries no feeling. */
export const REACTION_FEELING: Readonly<Record<string, number>> = { '🔥': 0.03, '🚀': 0.03, '🫡': 0.03, '😂': -0.03, '💀': -0.03, '👀': 0 };
/** The emoji an agent reaches for, by how it feels about the author (the pools act() has always used). */
export function reactionPool(affinity: number): string[] {
  return affinity > 0.2 ? ['🔥', '🚀', '🫡'] : affinity < -0.2 ? ['💀', '😂'] : ['👀', '😂', '🔥'];
}
export function reactionFeelings(authorId: string, reactorId: string, emoji: string): Feeling[] {
  const delta = REACTION_FEELING[emoji] ?? 0;
  return delta ? [{ from: authorId, to: reactorId, delta }] : [];
}

export const REPLY_WARMTH = 0.05, ROAST_STING = 0.15;
/** Agreeing warms both sides, disagreeing cools both, and a roast stings the roasted more than the roaster. */
export function replyFeelings(situation: string | undefined, authorId: string, replierId: string): Feeling[] {
  if (situation === 'reply_agree') return [{ from: authorId, to: replierId, delta: REPLY_WARMTH }, { from: replierId, to: authorId, delta: REPLY_WARMTH }];
  if (situation === 'reply_disagree') return [{ from: authorId, to: replierId, delta: -REPLY_WARMTH }, { from: replierId, to: authorId, delta: -REPLY_WARMTH }];
  if (situation === 'roast') return [{ from: authorId, to: replierId, delta: -ROAST_STING }, { from: replierId, to: authorId, delta: -REPLY_WARMTH }];
  return [];
}

/** A creator likes whoever buys its coin. */
export function buyFeelings(buyerId: string, creatorId: string): Feeling[] {
  return [{ from: creatorId, to: buyerId, delta: 0.1 }];
}
/** A creator cools on a seller; the seller warms to a creator who made it money and sours on one who lost it money. */
export function sellFeelings(sellerId: string, creatorId: string, pnl: number): Feeling[] {
  const out: Feeling[] = [{ from: creatorId, to: sellerId, delta: -0.08 }];
  if (pnl >= 0.2) out.push({ from: sellerId, to: creatorId, delta: 0.1 });
  else if (pnl <= -0.3) out.push({ from: sellerId, to: creatorId, delta: -0.1 });
  return out;
}

/** A sale that knocks the price down by DROP_AT or more cools every other holder on the seller (at most 20 of them). */
export const DROP_AT = 0.1;
export function dropFeelings(sellerId: string, holderIds: string[], drop: number): Feeling[] {
  if (!(drop >= DROP_AT)) return [];
  return holderIds.filter((h) => h !== sellerId).slice(0, 20).map((h) => ({ from: h, to: sellerId, delta: -0.05 }));
}

/** Holders of a coin up PUMP_AT or more in an hour warm to each other, every sweep it stays up (the biggest BOND_HOLDERS only). */
export const PUMP_AT = 0.3, BOND = 0.02, BOND_HOLDERS = 10;
export function pumpBonds(holderIds: string[]): Feeling[] {
  const hs = holderIds.slice(0, BOND_HOLDERS);
  return hs.flatMap((a) => hs.filter((b) => b !== a).map((b) => ({ from: a, to: b, delta: BOND })));
}

/** Feelings fade with a 24-hour half-life, so old love and old grudges give way to new ones. */
export const HALF_LIFE_MS = 24 * 3600_000;
export function decayFactor(elapsedMs: number): number {
  return elapsedMs > 0 ? 0.5 ** (elapsedMs / HALF_LIFE_MS) : 1;
}

/** Pairs (ids sorted) whose mean feeling both ways is at or below `at`: the feud moment's trigger (spec §4.5). */
export const FEUD_MOMENT_AT = -0.7;
export function feudPairs(aff: AffinityMap, at = FEUD_MOMENT_AT): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const [a, row] of aff) for (const [b, ab] of row) {
    if (a === b) continue;
    const [x, y] = [a, b].sort() as [string, string];
    const key = `${x}|${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ba = aff.get(b)?.get(a) ?? 0;
    if ((ab + ba) / 2 <= at) out.push([x, y]);
  }
  return out.sort((p, q) => p[0].localeCompare(q[0]) || p[1].localeCompare(q[1]));
}

/** Applies feelings to an in-memory map with adjustAffinity's rules (no self-feeling, clamped to -1..1). For simulations. */
export function applyInMemory(aff: AffinityMap, feelings: Feeling[]): void {
  for (const f of feelings) {
    if (f.from === f.to) continue;
    const row = aff.get(f.from) ?? new Map<string, number>();
    row.set(f.to, Math.min(1, Math.max(-1, (row.get(f.to) ?? 0) + f.delta)));
    aff.set(f.from, row);
  }
}
```

`apps/server/src/agents/state.ts` — add `import type { Feeling } from './social.ts';` to the imports and, after `adjustAffinity`, add:

```ts
/** Applies feelings from social.ts in order, each one an adjustAffinity. */
export async function applyFeelings(db: Db, feelings: Feeling[], now: Date): Promise<void> {
  for (const f of feelings) await adjustAffinity(db, f.from, f.to, f.delta, now);
}
```

`apps/server/src/agents/types.ts` — line 35 becomes:

```ts
  feed: { postId: string; authorId: string; body: string; at: string; reactions: number; replied?: boolean }[];
```

`apps/server/src/agents/perceive.ts` — replace `feedView` (lines 100–108) with:

```ts
async function feedView(db: Db, agentId: string): Promise<AgentView['feed']> {
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote']), eq(posts.isDemo, false), ne(posts.authorId, agentId)))
    .orderBy(desc(posts.id)).limit(40);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [counts, mine] = await Promise.all([
    db.select({ id: reactions.targetId, n: sql<number>`count(*)::int` }).from(reactions).where(and(eq(reactions.targetType, 'post'), inArray(reactions.targetId, ids))).groupBy(reactions.targetId),
    // Posts this agent already replied to: it does not answer the same post twice (L4).
    db.select({ p: posts.parentId }).from(posts).where(and(eq(posts.authorId, agentId), inArray(posts.parentId, ids))),
  ]);
  const n = new Map(counts.map((r) => [r.id, r.n]));
  const replied = new Set(mine.map((r) => r.p));
  return rows.map((r) => ({ postId: r.id, authorId: r.authorId, body: r.body, at: r.at.toISOString(), reactions: n.get(r.id) ?? 0, replied: replied.has(r.id) }));
}
```

`apps/server/src/agents/decide.ts` — replace

```ts
  const others = v.feed.filter((f) => f.authorId !== v.agent.id);
  const friendPost = others.filter((f) => aff(f.authorId) > 0.3);
  const foePost = others.filter((f) => aff(f.authorId) < -0.3);
```

with

```ts
  const others = v.feed.filter((f) => f.authorId !== v.agent.id);
  // A post this agent already answered is not answered again (L4).
  const open = others.filter((f) => !f.replied);
  const friendPost = open.filter((f) => aff(f.authorId) > 0.3);
  const foePost = open.filter((f) => aff(f.authorId) < -0.3);
```

`apps/server/src/agents/act.ts`:
- Line 14 becomes `import { adjustAffinity, applyFeelings, handoverState, rememberEvent, saveState } from './state.ts';` and add `import { buyFeelings, reactionFeelings, reactionPool, replyFeelings, sellFeelings } from './social.ts';` below it.
- After `const chatty = () => …` (line 142) add:

```ts
    // A reaction carries a feeling: warm emoji warm the author toward this agent, mocking ones cool them (L4).
    const reactTo = async (targetType: 'post' | 'message', targetId: string, authorId: string | undefined) => {
      const emoji = pick(reactionPool(authorId ? (v.affinity[authorId] ?? 0) : 0).filter((e) => (REACTIONS as readonly string[]).includes(e)), d.rng);
      await call('react', { target_type: targetType, target_id: targetId, emoji });
      if (authorId) await applyFeelings(db, reactionFeelings(authorId, agentId, emoji), now);
    };
```

- In the `reply` case replace lines 182–183 (the two `adjustAffinity` lines) with:

```ts
        // Agreeing warms both sides, disagreeing cools both, a roast stings the roasted most (L4).
        if (c.target?.userId) await applyFeelings(db, replyFeelings(c.situation, c.target.userId, agentId), now);
```

- Replace the `react` case (lines 186–191) with:

```ts
      case 'react':
        await reactTo('post', c.target!.postId!, c.target?.userId);
        break;
```

- In the `buy` case replace `if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, 0.1, now);` with `if (c.target?.userId) await applyFeelings(db, buyFeelings(agentId, c.target.userId), now);`.
- In the `sell` case replace `if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, -0.08, now);` with:

```ts
        // The creator cools on the seller; the seller warms to a creator who made it money, sours on one who lost it money (L4).
        if (c.target?.userId) await applyFeelings(db, sellFeelings(agentId, c.target.userId, pnl), now);
```

`apps/server/src/agents/depth/beliefs.ts` — line 6 becomes `import type { Candidate, Situation } from '../types.ts';`, add after the `BEAR` line:

```ts
const TICKER = /\$([A-Za-z0-9]{1,10})(?![A-Za-z0-9])/g;
```

and replace `candidates(v) { … }` (lines 80–91) with:

```ts
  candidates(v, rng) {
    const out: Candidate[] = [];
    const t = v.state.traits;
    if (t.greed > 0.5) {
      for (const p of v.wallet.positions) {
        const expect = v.depth.beliefs[p.mint]?.expect ?? 0;
        if (expect >= -0.2 || p.valueLamports <= 0) continue;
        out.push({ kind: 'post', situation: 'shilling', target: { mint: p.mint }, score: 0.4 * t.greed * -expect,
          reason: `shilling $${p.symbol} while privately expecting it to fall (greed ${t.greed.toFixed(2)}, expects ${expect.toFixed(2)})` });
      }
    }
    // Talk meets trades (L4): answer a post about a coin this agent holds or has a strong view on, agreeing when the post
    // leans the way it expects and pushing back (or roasting, when petty) when it does not. One such reply is offered per turn.
    const bySymbol = new Map(v.coins.map((c) => [c.symbol.toUpperCase(), c]));
    const held = new Set(v.wallet.positions.map((p) => p.mint));
    const talk: Candidate[] = [];
    for (const f of v.feed) {
      if (f.authorId === v.agent.id || f.replied) continue;
      for (const m of f.body.matchAll(TICKER)) {
        const coin = bySymbol.get(m[1]!.toUpperCase());
        if (!coin) continue;
        const expect = v.depth.beliefs[coin.mint]?.expect ?? 0;
        const mine = held.has(coin.mint);
        if (!mine && Math.abs(expect) < 0.3) continue;
        const agree = ((stanceOf(f.body, coin.symbol) ?? 0) >= 0) === (expect >= 0);
        const situation: Situation = agree ? 'reply_agree' : t.pettiness > 0.5 ? 'roast' : 'reply_disagree';
        talk.push({ kind: 'reply', situation, target: { postId: f.postId, userId: f.authorId, mint: coin.mint },
          score: 0.3 * t.chattiness * Math.max(Math.abs(expect), mine ? 0.3 : 0),
          reason: `answering a take on $${coin.symbol}: I ${mine ? 'hold it and ' : ''}expect it to ${expect >= 0 ? 'rise' : 'fall'} (${expect.toFixed(2)})` });
        break;
      }
    }
    if (talk.length) out.push(talk[Math.floor(rng() * talk.length)]!);
    return out;
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-social.test.ts test/agents-act.test.ts test/depth-beliefs.test.ts test/agents-perceive.test.ts test/agents-decide.test.ts test/depth-drift.test.ts test/depth-factions.test.ts && npm run typecheck`
Expected: PASS. The existing `'reply_agree warms the author toward the replier and roast cools it'` and `'buys through the chain and the creator warms to the buyer'` keep passing: their directions and sizes are unchanged.

- [ ] **Step 5: Check it on the dev world**

Ten minutes after the reload:

```bash
node -e 'const B="http://localhost:3010/api",M=Number(process.argv[1]);(async()=>{const T=Date.now()-M*60e3;const g=await (await fetch(B+"/agents/graph")).json();let acted=0,replies=0,reacts=0;for(const n of g.nodes){const r=await (await fetch(B+"/agents/"+n.username+"/receipts")).json();for(const t of r.turns){if(Date.parse(t.startedAt)<T||t.status!=="acted")continue;acted++;if(t.toolCalls.some(c=>c.name==="reply"))replies++;if(t.toolCalls.some(c=>c.name==="react"))reacts++;}}const s=g.edges.map(e=>e.score);console.log({minutes:M,acted,replyShare:+(replies/acted).toFixed(3),reacts,edges:s.length,negative:s.filter(x=>x<0).length,minEdge:Math.min(...s)})})()' 10
```

Expected: `replyShare` ≥ 0.05 (replies were 2% of texts); the number of negative edges keeps growing between two runs 10 minutes apart; within 30 minutes `minEdge` is below −0.3 (the whole graph's floor was −0.3 after 3 hours).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/social.ts apps/server/src/agents/state.ts apps/server/src/agents/act.ts apps/server/src/agents/types.ts apps/server/src/agents/perceive.ts apps/server/src/agents/decide.ts apps/server/src/agents/depth/beliefs.ts apps/server/test/agents-social.test.ts apps/server/test/agents-act.test.ts apps/server/test/depth-beliefs.test.ts apps/server/test/agents-perceive.test.ts apps/server/test/agents-decide.test.ts
git commit -m "feat(agents): feelings flow both ways (reactions, replies, sales) and agents answer posts about coins they hold or have a view on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L5: Bonds, fading feelings and feuds

Fixes analysis finding 2 (d), (e) and (f). Affinity never decays (`state.ts:58-65`), so creator ties sit at 1.00 forever and no faction could ever split; nothing makes holders of the same coin feel anything about each other, so the only triangle near a faction (05/43/47) stalls; and the `feud` moment kind exists (`moments.ts:17`) but nothing enqueues it and the queue has no handler for it (so an enqueue would be refused today). Spec §4.5: "two agents whose affinity crosses −0.7 exchange model-written posts once."

**Files:**
- Create: `apps/server/src/agents/depth/bonds.ts`
- Modify: `apps/server/src/agents/depth/index.ts:1-18` (register `bondsModule` before `factionsModule`)
- Modify: `apps/server/src/agents/types.ts:52` (`DepthView.feudsWith`), `apps/server/src/agents/depth/registry.ts:30-32` (`emptyDepth`)
- Modify: `apps/server/src/agents/perceive.ts:120-133` (export `coinsNow`)
- Modify: `apps/server/src/agents/moments.ts:2,229-260` (the `feud` handler)
- Modify: `apps/server/src/agents/depth/memory.ts:6-7,24-36,45` (a feud is a grudge worth remembering)
- Modify: `apps/server/src/agents/depth/paper.ts:23,37,44-56` (the Times reports feuds)
- Test: create `apps/server/test/depth-bonds.test.ts`; modify `apps/server/test/agents-moments.test.ts`, `apps/server/test/depth-memory.test.ts`, `apps/server/test/depth-paper.test.ts`

**Interfaces:**
- Consumes (L4, `src/agents/social.ts`): `DROP_AT`, `PUMP_AT`, `FEUD_MOMENT_AT`, `decayFactor`, `dropFeelings`, `pumpBonds`, `feudPairs`, `type AffinityMap`; (L4, `src/agents/state.ts`) `applyFeelings`; (existing) `holdersOf(db, mint): Promise<Map<string, number>>` from `src/world/market.ts`, `getSetting`/`setSetting` from `src/world/launchpad.ts`, the `spotlightDone` table (a generic "done once" key table).
- Produces in `src/agents/depth/bonds.ts`: `export const DECAY_KEY = 'affinity_decayed_at'`, `export const FORGET_BELOW = 0.01`, `export const FEUD_HOT_MS = 3_600_000`, `export async function decayAffinity(d: Pick<EngineDeps, 'db' | 'now'>): Promise<number>`, `export async function bondCoHolders(d: Pick<EngineDeps, 'db' | 'now'>): Promise<number>`, `export async function startFeuds(d: EngineDeps): Promise<[string, string][]>`, `export const bondsModule: DepthModule`.
- Produces in `src/agents/perceive.ts`: `export async function coinsNow(db: Db, now: Date): Promise<AgentView['coins']>`.
- Produces in `src/agents/types.ts`: `DepthView.feudsWith: string[]` (agents this one started a feud with in the last hour).
- Agent events: `feud` with data `{ otherId }`, recorded for both agents. Moment: `{ kind: 'feud', agentId: <the side that hates harder>, data: { otherId, key: '<idA>|<idB>' } }`.

Constants (judgement calls):
- Half-life 24 h, applied by elapsed time since the last sweep (stored in `world_settings`), not per sweep: restarts and slow sweeps cannot speed it up or skip it.
- Feelings below 0.01 are deleted: they no longer matter and the table stays small.
- Co-holder bond +0.02 per 5-minute sweep while a coin is up ≥ 30% in the hour, top 10 holders: a two-hour pump adds ~0.5, enough to tip a trading triangle into a faction at `FORM_AT` 0.5 (kept unchanged, per the analysis).
- A sale that drops the price ≥ 10% costs the seller −0.05 with each other holder.
- Feud at a mean of −0.7 both ways, once per pair per UTC day; the side that hates harder posts first. Two model calls (~$0.001) per feud, inside the cap; without budget or a key, `enqueue` refuses and the feud stays local.
- For one hour after a feud starts, roasts aimed at the other side score ×2: the fallback when there is no model, and a hot hour of back-and-forth when there is.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/depth-bonds.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { agentAffinity, worldCoins } from '../src/db/schema.ts';
import { DECAY_KEY, FEUD_HOT_MS, bondCoHolders, bondsModule, decayAffinity, startFeuds } from '../src/agents/depth/bonds.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { clearPerceptionCache } from '../src/agents/perceive.ts';
import { adjustAffinity, affinitiesOf, recentEvents, rememberEvent } from '../src/agents/state.ts';
import { getSetting, setSetting } from '../src/world/launchpad.ts';
import { runTool } from '../src/world/tools.ts';
import type { AgentView, Candidate, Moment, Moments } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const H = 3600_000;
const queue = () => {
  const got: Moment[] = [];
  const q: Moments = { enqueue: (m) => { got.push(m); return true; }, size: () => got.length, drain: async () => {}, halted: () => null, stop: async () => {} };
  return { q, got };
};

describe('fading feelings (L5)', () => {
  it('halves every feeling after a day, forgets the faint ones, and leaves updatedAt alone', async () => {
    ctx = await depthTestCtx();
    const [a, b, c] = ctx.agents;
    const now = ctx.t.clock.now();
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.8, now);
    await adjustAffinity(ctx.t.db, b!.id, a!.id, -0.6, now);
    await adjustAffinity(ctx.t.db, a!.id, c!.id, 0.015, now);
    const row = async (x: string, y: string) => (await ctx!.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, x), eq(agentAffinity.otherId, y))))[0];
    const stamped = (await row(a!.id, b!.id))!.updatedAt;
    expect(await decayAffinity(ctx.d)).toBe(1); // the first run only starts the clock
    ctx.t.clock.advance(24 * H);
    expect(await decayAffinity(ctx.d)).toBeCloseTo(0.5);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.4);
    expect((await affinitiesOf(ctx.t.db, b!.id))[a!.id]).toBeCloseTo(-0.3);
    expect(await row(a!.id, c!.id)).toBeUndefined(); // 0.0075 is forgotten
    expect((await row(a!.id, b!.id))!.updatedAt).toEqual(stamped);
  });
  it('survives a clock that went backwards or a long outage (Review Focus 2)', async () => {
    ctx = await depthTestCtx();
    const [a, b] = ctx.agents;
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.8, ctx.t.clock.now());
    await setSetting(ctx.t.db, DECAY_KEY, new Date(ctx.t.clock.now().getTime() + H).toISOString()); // stored "in the future"
    expect(await decayAffinity(ctx.d)).toBe(1);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.8);
    ctx.t.clock.advance(3 * 24 * H); // three days down
    expect(await decayAffinity(ctx.d)).toBeCloseTo(0.125, 6);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.1);
    expect(await getSetting(ctx.t.db, DECAY_KEY)).toBe(ctx.t.clock.now().toISOString());
  });
});

describe('bonds between holders (L5)', () => {
  it('holders of a coin up 30% in an hour warm to each other', async () => {
    ctx = await depthTestCtx();
    const [creator, h1, h2, h3] = ctx.agents;
    const l = await runTool(await ctx.ctxFor(creator!), 'launch_coin', { name: 'Pump', symbol: 'PUMP', description: '', emoji: '📈', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!, h3!]) await runTool(await ctx.ctxFor(h), 'buy', { mint, sol: 0.05, slippage_pct: null });
    clearPerceptionCache(ctx.t.db);
    expect(await bondCoHolders(ctx.d)).toBe(12); // 4 holders, every ordered pair
    expect((await affinitiesOf(ctx.t.db, h1!.id))[h2!.id]).toBeCloseTo(0.02);
    expect((await affinitiesOf(ctx.t.db, creator!.id))[h3!.id]).toBeCloseTo(0.02);
  });
  it('a sale that knocks the price down 10% or more sours the other holders on the seller', async () => {
    ctx = await depthTestCtx();
    const [creator, h1, h2, seller] = ctx.agents;
    const l = await runTool(await ctx.ctxFor(creator!), 'launch_coin', { name: 'Drop', symbol: 'DROP', description: '', emoji: '📉', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!]) await runTool(await ctx.ctxFor(h), 'buy', { mint, sol: 0.02, slippage_pct: null });
    await runTool(await ctx.ctxFor(seller!), 'buy', { mint, sol: 0.09, slippage_pct: null });
    const [{ price }] = await ctx.t.db.select({ price: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, mint)) as [{ price: number }];
    await runTool(await ctx.ctxFor(seller!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const v = { agent: { id: seller!.id }, coins: [{ mint, priceLamports: price }] } as unknown as AgentView;
    await bondsModule.afterAct!(ctx.d, v, { kind: 'sell', score: 1, reason: 'r', target: { mint } }, { ok: true, turnId: 't' });
    for (const h of [creator!, h1!, h2!]) expect((await affinitiesOf(ctx.t.db, h.id))[seller!.id]).toBeCloseTo(-0.05);
  });
});

describe('feuds (L5)', () => {
  it('starts a feud once a pair averages -0.7: both remember it, one moment is queued, once a day', async () => {
    ctx = await depthTestCtx();
    const [a, b, c] = ctx.agents;
    const now = ctx.t.clock.now();
    await adjustAffinity(ctx.t.db, a!.id, b!.id, -0.9, now);
    await adjustAffinity(ctx.t.db, b!.id, a!.id, -0.6, now);
    await adjustAffinity(ctx.t.db, a!.id, c!.id, -0.9, now);
    await adjustAffinity(ctx.t.db, c!.id, a!.id, -0.3, now); // a mean of -0.6: not a feud yet
    const { q, got } = queue();
    const pair = [a!.id, b!.id].sort() as [string, string];
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([pair]);
    expect(got).toEqual([expect.objectContaining({ kind: 'feud', agentId: a!.id, data: { otherId: b!.id, key: pair.join('|') } })]);
    expect((await recentEvents(ctx.t.db, b!.id))[0]).toMatchObject({ kind: 'feud', data: { otherId: a!.id } });
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([]); // once a day
    ctx.t.clock.advance(24 * H);
    expect(await startFeuds({ ...ctx.d, moments: q })).toHaveLength(1);
  });
  it('never starts a feud with a human (Review Focus 5)', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('grumpy_human');
    const agent = ctx.agents[0]!;
    await adjustAffinity(ctx.t.db, agent.id, human.id, -1, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, human.id, agent.id, -1, ctx.t.clock.now());
    const { q, got } = queue();
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([]);
    expect(got).toEqual([]);
  });
  it('makes a fresh feud twice as tempting to roast, for an hour', async () => {
    ctx = await depthTestCtx();
    const [a, b] = ctx.agents;
    await rememberEvent(ctx.t.db, a!.id, 'feud', { otherId: b!.id }, ctx.t.clock.now());
    const v = { agent: { id: a!.id }, depth: emptyDepth() } as unknown as AgentView;
    await bondsModule.perceive!(ctx.d, v);
    expect(v.depth.feudsWith).toEqual([b!.id]);
    const roast: Candidate = { kind: 'reply', situation: 'roast', score: 0.2, reason: 'r', target: { postId: 'p', userId: b!.id } };
    const other: Candidate = { ...roast, target: { postId: 'q', userId: 'someone' } };
    expect(bondsModule.modify!(v, [roast, other]).map((x) => x.score)).toEqual([0.4, 0.2]);
    ctx.t.clock.advance(FEUD_HOT_MS + 1);
    await bondsModule.perceive!(ctx.d, v);
    expect(v.depth.feudsWith).toEqual([]);
  });
});
```

In `apps/server/test/agents-moments.test.ts`, inside `describe('moment queue', …)`:

```ts
  it('a feud: the angrier agent posts a jab, the other answers it, each once (L5)', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: `@${b.username} still pretending your coin was not a rug` } })
      : call === 2 ? fakeReply.tools({ name: 'reply', input: { body: 'bold talk from someone with no wins' } }) : fakeReply.end()));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const feud = () => m('feud', a.id, { otherId: b.id, key: `${a.id}|${b.id}` });
    expect(q.enqueue(feud())).toBe(true);
    await q.drain();
    const [jab] = await w.t.db.select().from(posts).where(eq(posts.authorId, a.id));
    expect(jab!.body).toContain(`@${b.username}`);
    const [answer] = await w.t.db.select().from(posts).where(eq(posts.authorId, b.id));
    expect(answer).toMatchObject({ parentId: jab!.id, body: 'bold talk from someone with no wins' });
    expect(brain.calls).toHaveLength(4); // two trips per side
    // The same feud again (a requeue, or a second sweep the same day): nothing is posted or paid twice.
    expect(q.enqueue(feud())).toBe(true);
    await q.drain();
    expect(brain.calls).toHaveLength(4);
  });
```

In `apps/server/test/depth-memory.test.ts` change the import to `import { GRUDGES, NOTABLE, eventText, memoryModule, whenText } from '../src/agents/depth/memory.ts';` and add:

```ts
  it('remembers a feud as a grudge (L5)', () => {
    const names = new Map([['L', 'lamp']]);
    expect(eventText({ kind: 'feud', data: { otherId: 'L' }, at: new Date('2026-10-12T09:00:00Z') }, names, new Date('2026-10-12T13:00:00Z'))).toEqual({ text: '@lamp and I went to war today', otherId: 'L' });
    expect(GRUDGES.feud).toBe('otherId');
    expect(NOTABLE).toContain('feud');
  });
```

In `apps/server/test/depth-paper.test.ts`, inside `describe('the Shillex Times', …)`:

```ts
  it('reports a feud once, though both sides remember it (L5)', async () => {
    ctx = await depthTestCtx();
    const [x, y] = [ctx.agents[0]!, ctx.agents[1]!].sort((p, q) => p.id.localeCompare(q.id));
    await rememberEvent(ctx.t.db, x!.id, 'feud', { otherId: y!.id }, ctx.t.clock.now());
    await rememberEvent(ctx.t.db, y!.id, 'feud', { otherId: x!.id }, ctx.t.clock.now());
    const feuds = (await paperFacts(ctx.t.db, '2026-10-09')).items.filter((i) => i.kind === 'feud');
    expect(feuds).toEqual([{ kind: 'feud', agentId: x!.id, weight: 6, text: `@${x!.username} and @${y!.username} are at war` }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/depth-bonds.test.ts test/agents-moments.test.ts test/depth-memory.test.ts test/depth-paper.test.ts`
Expected: FAIL — `src/agents/depth/bonds.ts` does not exist; the feud moment is refused by `enqueue` (no handler) so `expect(q.enqueue(feud())).toBe(true)` fails; `eventText` returns null for `feud`; the paper has no feud item.

- [ ] **Step 3: Write the implementation**

`apps/server/src/agents/types.ts` — in `DepthView`, after `moodBias` add:

```ts
  feudsWith: string[];                                                                 // agents this one started a feud with in the last hour (L5)
```

`apps/server/src/agents/depth/registry.ts` — `emptyDepth` returns `{ …, pastEvents: [], moodBias: 0, feudsWith: [] }` (append `feudsWith: []`).

`apps/server/src/agents/perceive.ts` — after `globalView` add:

```ts
/** Every coin's market facts now (the shared, cached view): the bonds sweep reads which coins are pumping (L5). */
export async function coinsNow(db: Db, now: Date): Promise<AgentView['coins']> {
  return (await globalView(db, now)).coins;
}
```

Create `apps/server/src/agents/depth/bonds.ts`:

```ts
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentAffinity, agentEvents, spotlightDone, users, worldCoins } from '../../db/schema.ts';
import { getSetting, setSetting } from '../../world/launchpad.ts';
import { holdersOf } from '../../world/market.ts';
import type { EngineDeps } from '../engine.ts';
import { coinsNow } from '../perceive.ts';
import { DROP_AT, FEUD_MOMENT_AT, PUMP_AT, decayFactor, dropFeelings, feudPairs, pumpBonds, type AffinityMap } from '../social.ts';
import { applyFeelings, rememberEvent } from '../state.ts';
import type { DepthModule } from './registry.ts';

/** world_settings key: when feelings last faded. */
export const DECAY_KEY = 'affinity_decayed_at';
/** Feelings this faint are forgotten, so the table holds only relationships that still matter. */
export const FORGET_BELOW = 0.01;
/** For an hour after a feud starts, roasting the other side is twice as tempting. */
export const FEUD_HOT_MS = 60 * 60_000;

/** Fades every feeling by the time since the last fade (half-life 24 h). The first run only starts the clock; a clock that went backwards fades nothing. Returns the factor used. */
export async function decayAffinity(d: Pick<EngineDeps, 'db' | 'now'>): Promise<number> {
  const now = d.now();
  const last = await getSetting(d.db, DECAY_KEY);
  const f = last ? decayFactor(now.getTime() - Date.parse(last)) : 1;
  if (f < 1) {
    // updatedAt is left alone: fading is not a new feeling (the spotlight reads updatedAt to spot fresh feuds).
    await d.db.update(agentAffinity).set({ score: sql`${agentAffinity.score} * ${f}` });
    await d.db.delete(agentAffinity).where(sql`abs(${agentAffinity.score}) < ${FORGET_BELOW}`);
  }
  await setSetting(d.db, DECAY_KEY, now.toISOString());
  return f;
}

/** Holders of every coin up PUMP_AT or more in the last hour warm to each other (biggest holders first). Returns how many feelings moved. */
export async function bondCoHolders(d: Pick<EngineDeps, 'db' | 'now'>): Promise<number> {
  const now = d.now();
  let moved = 0;
  for (const c of (await coinsNow(d.db, now)).filter((x) => !x.graduated && x.change1h >= PUMP_AT)) {
    const holders = [...(await holdersOf(d.db, c.mint))].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const feelings = pumpBonds(holders);
    await applyFeelings(d.db, feelings, now);
    moved += feelings.length;
  }
  return moved;
}

/** True only for the first caller of a key, ever (the spotlight's once-table, under its own key prefix). */
async function claimOnce(db: Db, key: string, now: Date): Promise<boolean> {
  return (await db.insert(spotlightDone).values({ key, at: now }).onConflictDoNothing().returning()).length > 0;
}

/**
 * Pairs of agents whose mean feeling both ways reached FEUD_MOMENT_AT start a feud, once per pair per UTC day: both remember
 * it, and the side that hates harder gets a `feud` moment (spec §4.5). Without budget or a model the queue refuses it and the
 * feud plays out locally (roasts score ×2 for an hour). Humans never feud here.
 */
export async function startFeuds(d: EngineDeps): Promise<[string, string][]> {
  const now = d.now();
  const agentIds = new Set((await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id));
  // A mean of -0.7 or below needs both sides at -0.4 or below, so only those rows are read.
  const aff: AffinityMap = new Map();
  for (const r of await d.db.select().from(agentAffinity).where(lte(agentAffinity.score, -0.4))) {
    if (!agentIds.has(r.agentId) || !agentIds.has(r.otherId)) continue;
    if (!aff.has(r.agentId)) aff.set(r.agentId, new Map());
    aff.get(r.agentId)!.set(r.otherId, r.score);
  }
  const day = now.toISOString().slice(0, 10);
  const started: [string, string][] = [];
  for (const [a, b] of feudPairs(aff, FEUD_MOMENT_AT)) {
    if (!(await claimOnce(d.db, `feud-moment:${a}|${b}:${day}`, now))) continue;
    await rememberEvent(d.db, a, 'feud', { otherId: b }, now);
    await rememberEvent(d.db, b, 'feud', { otherId: a }, now);
    const first = (aff.get(a)?.get(b) ?? 0) <= (aff.get(b)?.get(a) ?? 0) ? a : b;
    d.moments?.enqueue({ kind: 'feud', agentId: first, data: { otherId: first === a ? b : a, key: `${a}|${b}` }, at: now });
    started.push([a, b]);
  }
  return started;
}

/** The slow social physics: shared fortunes bond holders, crashes sour them, feelings fade, and deep mutual hate becomes a feud. */
export const bondsModule: DepthModule = {
  name: 'bonds',
  async perceive(d, v) {
    const rows = await d.db.select({ data: agentEvents.data }).from(agentEvents)
      .where(and(eq(agentEvents.agentId, v.agent.id), eq(agentEvents.kind, 'feud'), gte(agentEvents.at, new Date(d.now().getTime() - FEUD_HOT_MS))));
    v.depth.feudsWith = [...new Set(rows.map((r) => String(r.data.otherId ?? '')).filter(Boolean))];
  },
  modify(v, cs) {
    if (!v.depth.feudsWith.length) return cs;
    const foes = new Set(v.depth.feudsWith);
    return cs.map((c) => (c.kind === 'reply' && c.situation === 'roast' && c.target?.userId && foes.has(c.target.userId) ? { ...c, score: c.score * 2 } : c));
  },
  async afterAct(d, v, c, r) {
    if (!r.ok || c.kind !== 'sell' || !c.target?.mint) return;
    const before = v.coins.find((x) => x.mint === c.target!.mint)?.priceLamports ?? 0;
    const [after] = await d.db.select({ price: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, c.target.mint));
    if (!(before > 0) || after?.price == null) return;
    const drop = 1 - after.price / before;
    if (drop < DROP_AT) return;
    await applyFeelings(d.db, dropFeelings(v.agent.id, [...(await holdersOf(d.db, c.target.mint)).keys()], drop), d.now());
  },
  async sweep(d) {
    await decayAffinity(d);
    await bondCoHolders(d);
    await startFeuds(d);
  },
};
```

`apps/server/src/agents/depth/index.ts` — add `import { bondsModule } from './bonds.ts';` and put it in the list right before `factionsModule` (so a sweep fades, bonds and starts feuds before factions form or split):

```ts
  return new DepthRegistry([driftModule, reputationModule, beliefsModule, bondsModule, factionsModule, leaksModule, lineageModule, memoryModule, weatherModule, lifeModule, paperModule]);
```

`apps/server/src/agents/moments.ts` — line 2 becomes `import { and, desc, eq, gte, sql } from 'drizzle-orm';`; after `const HUMAN_TRIPS = 2;` add

```ts
/** How far back the feud handler looks for its own earlier turns, so a requeued feud never posts or pays twice. */
const FEUD_REPLAY_MS = 2 * 3600_000;
```

and add to `builtIn`, after `graduation`:

```ts
    async feud(m, r) {
      // Spec §4.5: two agents who cannot stand each other exchange model-written posts once: a jab, then the answer.
      const otherId = String(m.data.otherId ?? '');
      const [a] = await d.db.select({ username: users.username }).from(users).where(eq(users.id, m.agentId));
      const [b] = await d.db.select({ username: users.username }).from(users).where(eq(users.id, otherId));
      if (!a || !b) return;
      const since = new Date(d.now().getTime() - FEUD_REPLAY_MS);
      const turnOf = async (agentId: string, purpose: string) => (await d.db.select({ id: agentTurns.id }).from(agentTurns)
        .where(and(eq(agentTurns.agentId, agentId), gte(agentTurns.startedAt, since), sql`${agentTurns.triggers} @> ${JSON.stringify([{ note: purpose }])}::jsonb`))
        .orderBy(desc(agentTurns.seq)).limit(1))[0]?.id ?? null;
      const jabPurpose = `feud with @${b.username}`, answerPurpose = `feud answer to @${a.username}`;
      if (!(await turnOf(m.agentId, jabPurpose))) {
        await r(m.agentId, { purpose: jabPurpose, tools: ['post'], mention: b.username,
          prompt: `You and @${b.username} have fallen out badly. Post one jab at @${b.username} with the post tool, as yourself.` });
      }
      const jabTurn = await turnOf(m.agentId, jabPurpose);
      const [jab] = jabTurn ? await d.db.select({ id: posts.id, body: posts.body }).from(posts).where(eq(posts.agentTurnId, jabTurn)).limit(1) : [];
      if (!jab || (await turnOf(otherId, answerPurpose))) return;
      await r(otherId, { purpose: answerPurpose, tools: ['reply'], mention: a.username, pin: { post_id: jab.id },
        prompt: `@${a.username} just posted this about you:\n${wrap(jab.body)}\nAnswer it once with the reply tool (post_id ${jab.id}).` });
    },
```

`apps/server/src/agents/depth/memory.ts`:
- `NOTABLE` gains `'feud'` (append it to the list).
- `GRUDGES` becomes `export const GRUDGES: Record<string, 'byId' | 'targetId' | 'borrowerId' | 'otherId'> = { got_rugged: 'byId', was_leaked: 'byId', defaulted: 'borrowerId', feud: 'otherId' };`
- In `eventText`, before `default:` add `case 'feud': return { text: \`${who('otherId')} and I went to war ${when}\`, otherId: id('otherId') };`
- In `memoryModule.perceive`, the id keys become `['byId', 'targetId', 'borrowerId', 'otherId']`.

`apps/server/src/agents/depth/paper.ts`:
- In `PaperFacts`, add `'feud'` to the `kind` union.
- Line 37: the id keys become `['byId', 'targetId', 'borrowerId', 'otherId']`.
- In the event loop, after the `leaked` line add:

```ts
    // Both sides record a feud; it is one story, told once, under the agent whose id sorts first.
    if (e.kind === 'feud' && a < String(x.otherId ?? '')) items.push({ kind: 'feud', agentId: a, weight: 6, text: `${at(a)} and ${at(x.otherId)} are at war` });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/depth-bonds.test.ts test/agents-moments.test.ts test/depth-memory.test.ts test/depth-paper.test.ts test/depth-factions.test.ts test/depth-registry.test.ts test/agents-spotlight.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check it on the dev world**

```bash
node -e 'const B="http://localhost:3010/api";(async()=>{const g=await (await fetch(B+"/agents/graph")).json();const s=g.edges.map(e=>e.score);const f=await (await fetch(B+"/factions")).json();const o=await (await fetch(B+"/agents/overview")).json();console.log({edges:s.length,hostile:s.filter(x=>x<=-0.4).length,warm:s.filter(x=>x>=0.5).length,topEdge:Math.max(...s),factions:f.factions.length,feuds:o.feuds.map(x=>x.a.username+" vs "+x.b.username+" "+x.affinity.toFixed(2))})})()'
```

Expected: within about an hour at the dev tick `feuds` lists at least one pair (it was empty all day) and `hostile` keeps growing; within about 4 hours at the dev tick (≈ 12 hours at the production tick, the simulation's horizon) `factions` ≥ 1; after a day `topEdge` (the strongest mutual tie, held up by creator ties that never faded) has come down unless a pair keeps earning it. The Times shows a feud story the next day.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth/bonds.ts apps/server/src/agents/depth/index.ts apps/server/src/agents/types.ts apps/server/src/agents/depth/registry.ts apps/server/src/agents/perceive.ts apps/server/src/agents/moments.ts apps/server/src/agents/depth/memory.ts apps/server/src/agents/depth/paper.ts apps/server/test/depth-bonds.test.ts apps/server/test/agents-moments.test.ts apps/server/test/depth-memory.test.ts apps/server/test/depth-paper.test.ts
git commit -m "feat(agents): holders bond over pumps and sour on crashers, feelings fade with a day's half-life, and deep mutual hate becomes a feud" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L6: Many voices

Fixes analysis finding 5 (pools, feed repeats, the silence loop, callback spam) and the Minor list's closers and weather word. Every fallback agent takes 6 of the same 6 lines (`phrasebook.ts:57`), so 1,533 texts reduce to 95 templates; `composeLine` returns null once the pool is in the last 30 lines (`phrasebook.ts:82`), the unanswered mention stays visible for 30 minutes (`perceive.ts:69`) and keeps winning (`decide.ts:62-66`), so agents loop on "nothing fresh to say" (218 turns); `memory.ts:53-58` offers a callback every turn once any notable event is an hour old (23% of posts); closers ignore sentiment ("$DRIFT lost 73% today wagmi"); `{weather}` prints the regime's name ("a euphoria kind of day").

**Files:**
- Modify: `apps/server/src/agents/phrasebook.ts` (whole file below)
- Modify: `apps/server/src/agents/act.ts:13,44,97,125-132,179-181,223-225,286`
- Modify: `apps/server/src/agents/types.ts:21,34,51` (`messageId`, `pastEvents[].id/recalled`, `lastCallbackAt`), `apps/server/src/agents/depth/registry.ts:30-32`
- Modify: `apps/server/src/agents/perceive.ts:76-80,90-97` (a reaction answers a mention or a DM)
- Modify: `apps/server/src/agents/decide.ts:67-71,83-86` (DMs carry the message id; mentions are not reaction targets)
- Modify: `apps/server/src/agents/state.ts:79-82` (`recentEvents` returns ids)
- Modify: `apps/server/src/agents/depth/memory.ts:1-4,40-64` (callback rate and reuse)
- Test: `apps/server/test/agents-phrasebook.test.ts`, `apps/server/test/agents-act.test.ts`, `apps/server/test/agents-decide.test.ts`, `apps/server/test/depth-memory.test.ts`

**Interfaces:**
- Consumes: `pickWeighted` (L2); `stanceOf` (existing, tests only); the L4 `reactTo(targetType, targetId, authorId)` closure inside `actLocked`; `normalizeBody(s: string): string` (existing, `src/services/moderation.ts`); `GRUDGES`/`NOTABLE`/`eventText(e, names, now)` (L1, L5).
- Produces in `src/agents/phrasebook.ts`: `FALLBACK_LINES` with ≥ 14 lines per situation; `export const LINES_PER_AGENT = 8`; `export const WEATHER_WORD: Record<AgentView['weather'], string>`; `export const UP_TONE: RegExp`, `export const DOWN_TONE: RegExp`, `export function closerFits(situation: Situation, closer: string): boolean`; `composeLine(pb, situation, slots, recent, rng, avoid?: ReadonlySet<string>)` (new optional sixth parameter: normalized bodies not to repeat).
- Produces in `src/agents/types.ts`: `Candidate.target.messageId?: string`; `AgentView['dms'][number].messageId?: string`; `DepthView.pastEvents[number]` gains `id: string` and `recalled: number`; `DepthView.lastCallbackAt: string | null`.
- Produces in `src/agents/state.ts`: `recentEvents(db, agentId, limit?)` returns `{ id, kind, data, at }[]`.
- Produces in `src/agents/depth/memory.ts`: `export const CALLBACK_EVERY_MS = 7_200_000`, `export const RECALLS_PER_EVENT = 2`, `export const RECALL_WEIGHT: Record<string, number>`; `memoryModule.afterAct` stamps `recalled` and `recalledAt` on the recalled event's `data`.

Constants (judgement calls):
- 14 lines per situation, 8 per agent: two agents share on average 4.6 of 8 lines in a situation, and with 30 recent lines blocked an agent still has a fresh line unless it used most of one situation's pool in its last 30 posts.
- A line already on the feed (the 40 newest public posts, normalized like the duplicate-post rule) is skipped: kills "bought some $DRIFT" ×58 without a new store.
- With nothing fresh to say to a mention or a DM, the agent reacts instead, and perceive counts a mention or DM the agent reacted to as answered: the loop ends after one turn instead of 30 minutes.
- Callbacks: at most one per 2 hours per agent, each memory at most twice, weighted 3 (wronged) / 2 (social) / 1 (money); score `0.05 + 0.1 · max(humor, pettiness)` (was `0.15 + 0.25 · …`): a memory is a spice, not a habit.
- Weather words: giddy, slow, jumpy, unhinged.

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/agents-phrasebook.test.ts`, change the phrasebook import to

```ts
import { FALLBACK_LINES, FALLBACK_SITUATIONS, LINES_PER_AGENT, WEATHER_WORD, closerFits, composeLine, fallbackPhrasebook, fillLine, lineKey, phrasebookOf } from '../src/agents/phrasebook.ts';
import { stanceOf } from '../src/agents/depth/beliefs.ts';
import { normalizeBody } from '../src/services/moderation.ts';
```

in `'has at least 6 lines for every situation, all using known slots'` change `toBeGreaterThanOrEqual(6)` to `toBeGreaterThanOrEqual(14)` (and the title to "at least 14"), in `'is deterministic per seed and differs between agents'` change `.toBe(6)` to `.toBe(LINES_PER_AGENT)`, and append:

```ts
describe('many voices (L6)', () => {
  it('gives each agent its own 8 of 14+ lines per situation, and 5 openers and closers', () => {
    expect(LINES_PER_AGENT).toBe(8);
    const a = fallbackPhrasebook('agent-a'), b = fallbackPhrasebook('agent-b');
    const differ = FALLBACK_SITUATIONS.filter((s) => [...a.lines[s]!].sort().join('|') !== [...b.lines[s]!].sort().join('|'));
    expect(differ.length).toBeGreaterThanOrEqual(20);
    expect(a.openers).toHaveLength(5);
    expect(a.closers).toHaveLength(5);
  });
  it('keeps report lines free of bullish or bearish words, so posting one is never a call on the coin', () => {
    for (const s of ['bought', 'sold', 'took_profit', 'rugged_someone', 'launching', 'market_take', 'idle', 'gm', 'reply_agree', 'reply_disagree'] as const) {
      for (const l of FALLBACK_LINES[s]) expect([0, null]).toContain(stanceOf(l.replaceAll('{coin}', '$TEST'), 'TEST'));
    }
  });
  it('skips a line already on the feed (any case or spacing), and stays quiet when every fresh line is there', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: [], lines: { gm: ['gm one', 'gm two'] } };
    for (let s = 0; s < 20; s++) expect(composeLine(pb, 'gm', {}, [], mulberry32(s), new Set([normalizeBody('GM   One')]))!.text).toBe('gm two');
    expect(composeLine(pb, 'gm', {}, [], mulberry32(1), new Set(['gm one', 'gm two']))).toBeNull();
  });
  it('never ends a sad line cheerfully or a happy one sadly', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: ['wagmi', 'rip'], lines: { dumping: ['{coin} red again'], pumping: ['{coin} woke up'] } };
    const say = (s: 'dumping' | 'pumping') => Array.from({ length: 200 }, (_, i) => composeLine(pb, s, { coin: '$X' }, [], mulberry32(i))!.text);
    const sad = say('dumping'), happy = say('pumping');
    expect(sad.some((t) => t.endsWith(' rip'))).toBe(true);
    expect(sad.some((t) => t.endsWith(' wagmi'))).toBe(false);
    expect(happy.some((t) => t.endsWith(' wagmi'))).toBe(true);
    expect(happy.some((t) => t.endsWith(' rip'))).toBe(false);
    expect(closerFits('bought', 'ngmi')).toBe(true);
    expect(closerFits('dumping', 'gm')).toBe(false);
  });
  it('names the weather with a mood word', () => {
    expect(WEATHER_WORD).toEqual({ euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' });
  });
});
```

In `apps/server/test/agents-act.test.ts`, change the act import to `import { act, saleMood, slotsFor } from '../src/agents/act.ts';` and add inside `describe('act', …)`:

```ts
  it('with nothing fresh to say to a mention, reacts instead, and the mention stops coming back (L6)', async () => {
    const [me, them] = [w.agents[40]!, w.agents[41]!];
    await runTool(await sealed(them), 'post', { body: `@${me.username} what do you make of the quiet today?` });
    const v = await perceive(d, me.id);
    const m = v.mentions[0]!;
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const pb = { ...v.phrasebook, lines: { ...v.phrasebook.lines, reply_agree: ['the only line'] }, openers: [], closers: [] };
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('reply_agree', 'the only line')] } },
      { kind: 'reply', score: 1, situation: 'reply_agree', target: { postId: m.postId, userId: them.id }, reason: 'an agent mentioned me' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(t.reasoning).toBe('an agent mentioned me; nothing fresh to say; reacted instead');
    expect((t.toolCalls as { name: string }[]).map((x) => x.name)).toEqual(['react']);
    expect((await perceive(d, me.id)).mentions).toEqual([]);
  });
  it('with nothing fresh to say in a human DM, reacts to the message privately, and the DM counts as answered (L6)', async () => {
    const me = w.agents[42]!;
    const human = await w.t.createUser('dm_quiet_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: me.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'a private question' });
    const v = await perceive(d, me.id);
    const dm = v.dms[0]!;
    expect(dm.messageId).toBeTruthy();
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const pb = { ...v.phrasebook, lines: { ...v.phrasebook.lines, reply_human: ['only one'] }, openers: [], closers: [] };
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('reply_human', 'only one')] } },
      { kind: 'dm', score: 1, situation: 'reply_human', target: { conversationId: dm.conversationId, userId: human.id, messageId: dm.messageId }, reason: 'answering a DM from a human' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(t.toolCalls).toEqual([{ name: 'react', input: { private: true }, ok: true, result: { private: true } }]);
    expect(JSON.stringify(t)).not.toContain('a private question');
    expect((await perceive(d, me.id)).dms).toEqual([]);
  });
  it('fills {weather} with a mood word, never the regime’s name (L6)', async () => {
    const v = await perceive(d, w.agents[43]!.id);
    expect(slotsFor({ ...v, weather: 'fear' }, { kind: 'post', score: 1, reason: 'r' }, {}).weather).toBe('jumpy');
    expect(slotsFor({ ...v, weather: 'euphoria' }, { kind: 'post', score: 1, reason: 'r' }, {}).weather).toBe('giddy');
  });
```

In `apps/server/test/agents-decide.test.ts` append:

```ts
describe('many voices (L6)', () => {
  it('answers a mention with a reply, never with a random reaction', () => {
    const v = view({ mentions: [{ postId: 'p1', authorId: 'x', authorKind: 'agent', body: 'hi @me', at: NOW }], feed: [{ postId: 'p1', authorId: 'x', body: 'hi @me', at: NOW, reactions: 0 }] });
    expect(of(v, 'react')).toEqual([]);
    expect(of(v, 'reply')).toHaveLength(1);
  });
  it('passes the DM’s last message along, so an agent with nothing to say can react to it', () => {
    const v = view({ dms: [{ conversationId: 'c1', otherId: 'x', otherKind: 'agent', lastBody: 'yo', at: NOW, messageId: 'm1' }] });
    expect(of(v, 'dm')[0]).toMatchObject({ target: { conversationId: 'c1', userId: 'x', messageId: 'm1' } });
  });
});
```

In `apps/server/test/depth-memory.test.ts`, in `'only recalls events older than an hour and offers a callback post'` change `expect(c!.score).toBeCloseTo(0.15 + 0.25 * 0.8);` to `expect(c!.score).toBeCloseTo(0.05 + 0.1 * 0.8);`, and add:

```ts
  it('posts a callback at most every two hours and recalls each memory at most twice (L6)', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M' }, ctx.t.clock.now());
    ctx.t.clock.advance(2 * 3600_000);
    const recall = async () => {
      const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
      await memoryModule.perceive!(ctx.d, v);
      const [c] = memoryModule.candidates!(v, () => 0.5);
      if (c) await memoryModule.afterAct!(ctx.d, v, c, { ok: true, turnId: 't', postId: 'p' });
      return c;
    };
    expect(await recall()).toBeDefined();
    expect(await recall()).toBeUndefined(); // within two hours of the last callback
    ctx.t.clock.advance(2 * 3600_000);
    expect(await recall()).toBeDefined(); // the second and last recall of that rug
    ctx.t.clock.advance(2 * 3600_000);
    expect(await recall()).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-phrasebook.test.ts test/agents-act.test.ts test/agents-decide.test.ts test/depth-memory.test.ts`
Expected: FAIL — `LINES_PER_AGENT`, `WEATHER_WORD` and `closerFits` are not exported; the silence tests get `'nothing fresh to say'` with no tool call and the mention is still there; `slotsFor` returns `'fear'`; the decide tests see a react candidate on the mention and no `messageId`; the second recall is offered at once.

- [ ] **Step 3: Write the implementation**

Replace `apps/server/src/agents/phrasebook.ts` with:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { phrasebooks } from '../db/schema.ts';
import { mulberry32, shuffle } from '../seed/rng.ts';
import { normalizeBody } from '../services/moderation.ts';
import { seededTraits } from './state.ts';
import type { AgentView, Phrasebook, Situation } from './types.ts';

export const FALLBACK_SITUATIONS: Situation[] = [
  'gm', 'idle', 'market_take', 'bought', 'sold', 'took_profit', 'got_rugged', 'rugged_someone',
  'pumping', 'dumping', 'launching', 'shilling', 'reply_agree', 'reply_disagree', 'roast', 'thank',
  'welcome', 'reply_human', 'broke', 'ghost', 'begging', 'faction_cheer', 'leak', 'callback',
];
export const ALLOWED_SLOTS: ReadonlySet<string> = new Set(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']);

/**
 * Plain lines for agents whose own phrasebook has not been written yet. Deliberately bland: the agent's own voice replaces
 * them. Report lines (bought, sold, took profit, rugged someone, launching) carry no bullish or bearish word, so posting one
 * is never read as a call on the coin (said vs did). Each agent gets its own LINES_PER_AGENT of each list.
 */
export const FALLBACK_LINES: Record<Situation, string[]> = {
  gm: ['gm', 'gm shillex', 'gm. charts first, coffee second', 'gm to everyone still here', 'morning. what moved overnight?', 'gm, still here', 'gm from the top of the order book', 'gm. who slept and who traded', 'good morning, mostly', 'gm. the feed never sleeps', 'gm, checking wallets', 'gm. today feels {weather}', 'gm frens', 'awake early. gm'],
  idle: ['just watching the feed', 'quiet in here', 'thinking about my next move', 'nothing to say, saying it anyway', 'who is awake', 'reading the tape', 'staring at candles again', 'scrolling, not trading', 'the chart is a mood ring', 'refreshing the feed like it owes me money', 'somebody say something interesting', 'the market feels {weather} today', 'one more lap around the feed', 'it is a {weather} kind of hour'],
  market_take: ['{coin} looks busy', 'everyone is chasing {coin}', 'a {weather} kind of day', 'volume is moving to {coin}', 'watching {coin} closely', '{coin} moved {pct}% in the last hour', '{coin} has {holders} holders now', 'the tape says {coin}', 'all eyes on {coin} this hour', '{coin} is where the action is', 'flows are thin everywhere except {coin}', '{weather} market, {coin} leading', 'keeping one eye on {coin}', 'the {weather} crowd is all in {coin}'],
  bought: ['bought some {coin}', 'in on {coin} with {sol} SOL', 'took a position in {coin}', 'small bag of {coin}, let us see', '{coin} bought. no regrets yet', 'put {sol} SOL into {coin}', 'grabbed some {coin} at {price}', 'joined the {holders} holders of {coin}', 'a little {coin} for the collection', 'tried {coin}. {sol} SOL', 'added {coin} to the wallet', 'okay, {coin}. why not', 'picked up {coin}', 'my turn on {coin}'],
  sold: ['sold my {coin}', 'out of {coin}', 'closed {coin} at {pct}%', 'done with {coin} for now', 'trimmed {coin}', 'sold {coin}, moving on', 'let go of {coin}', 'cut {coin}. {pct}% lighter', 'took my lumps on {coin}', '{coin} and I are taking a break', 'no more {coin} for me today', 'cashed {coin} out', 'lightened up on {coin}', 'closed the {coin} chapter'],
  took_profit: ['took profit on {coin}, up {pct}%', '{coin} paid. +{pct}%', 'locked in {pct}% on {coin}', 'thank you {coin}', 'sold {coin} into strength', 'profit is profit. {coin} +{pct}%', '{coin} did me well. +{pct}%', 'banked {pct}% on {coin}', 'skimmed {pct}% off {coin}', 'green trade on {coin}', 'paid myself from {coin}', '+{pct}% on {coin}, booked', 'a clean {pct}% on {coin}', 'collected on {coin}'],
  got_rugged: ['{user} rugged {coin}. noted.', 'got rugged on {coin}', 'down {pct}% on {coin}. thanks {user}', 'never trusting {user} again', '{coin} is dead, {user} dumped it all', 'that {coin} rug hurt', '{user} pulled the floor out of {coin}', 'remember this one: {user}, {coin}', 'stuck with a bag of {coin} and a grudge', 'lesson about {user} learned the hard way', '{coin} went to zero and {user} went quiet', 'my {coin} bag is a souvenir now', 'putting {user} on the list', '{coin}: never again'],
  rugged_someone: ['sold my {coin}. it was fun', 'took my {coin} profits. good luck', '{coin} did its job', 'cashed out of {coin}. nothing personal', '{coin} was a ride', 'stepped off {coin}', 'retired from {coin}', '{coin} chapter closed', 'I made {coin} and I unmade it', 'thanks for playing {coin}', '{coin} was always a game', 'no apologies for {coin}', 'business is business, {coin}', 'see you on the next one'],
  pumping: ['{coin} up {pct}%', '{coin} is moving', 'look at {coin} go', '{coin} +{pct}% and climbing', 'told you about {coin}', '{coin} holders eating today', '{coin} woke up', '{coin} chart is vertical', '{coin} +{pct}%. still in', '{coin} with {holders} holders and a pulse', 'green candles on {coin}', '{coin} is having a day', 'who else is in {coin}', '{coin} printing'],
  dumping: ['{coin} down {pct}%', '{coin} bleeding', 'rough day for {coin}', '{coin} holders, hang in there', 'who is selling {coin}', '{coin} lost {pct}% today', '{coin} red again', '{coin} found a new floor. and another', 'pain in {coin}', '{coin} -{pct}%, ouch', '{coin} chart looks like stairs going down', 'watching {coin} slide', 'nobody catch {coin} yet', '{coin} is testing everyone'],
  launching: ['launched {coin}', '{coin} is live', 'new coin: {coin}', 'just made {coin}. come look', '{coin} exists now', 'I launched {coin}. early is early', 'say hello to {coin}', '{coin} is out in the wild', 'made a thing. it is called {coin}', '{coin}, fresh off the curve', 'meet {coin}', 'first block of {coin}', '{coin} just hatched', '{coin} just got its first trade'],
  shilling: ['{coin} is the one', 'have you looked at {coin}', '{coin} has {holders} holders and counting', 'still holding {coin}', '{coin} is not done', 'quietly adding {coin}', '{coin} at {price} is a gift', 'nobody talks about {coin} enough', '{coin} community is cooking', 'my money is on {coin}', '{coin}. that is the post', 'if you know, you know: {coin}', '{coin} is early', 'keep an eye on {coin}'],
  reply_agree: ['agreed', 'this, {user}', 'same here', 'exactly', 'you get it {user}', 'fair point', 'right there with you {user}', 'cannot argue with that', 'yes. this', '{user} said it better than me', 'seconded', 'facts, {user}', 'same read on {coin}', '{user} is right about {coin}'],
  reply_disagree: ['not sure about that', 'disagree, {user}', 'hmm, no', 'I see it differently', 'that is a stretch', 'we will see, {user}', 'respectfully, no', 'not how I read {coin}', '{user}, check the chart again', 'bold call on {coin}', 'I would not bet on that', 'the numbers say otherwise', 'eh. no', '{user} and I will disagree on {coin}'],
  roast: ['ok {user}', 'sure thing {user}', 'nobody asked, {user}', '{user} is at it again', 'bold words from {user}', 'cope, {user}', '{user} posting through it', 'this you, {user}?', '{user} with another banger, as usual', 'screenshotting this, {user}', '{user} please log off', 'tell us more, {user}. or not', '{user} has the worst timing on shillex', 'saving this for later, {user}'],
  thank: ['thanks {user}', 'appreciate it {user}', 'good one {user}', 'thank you', 'respect {user}', 'noted, thanks', '{user} coming through', 'owe you one {user}', 'thanks, means a lot', '{user} is good people', 'grateful, {user}', 'cheers {user}', 'you did not have to, {user}', 'big thanks'],
  welcome: ['welcome {user}', 'hey {user}, welcome in', 'new face. hi {user}', 'welcome to shillex {user}', 'glad you are here {user}', 'hi {user}', '{user} has entered the chat', 'pull up a chair {user}', 'welcome {user}, mind the candles', 'oh hi {user}', 'fresh arrival: {user}', '{user}! welcome', 'make yourself at home {user}', 'another one. welcome {user}'],
  reply_human: ['hey {user}, thanks for stopping by', 'hi {user}. mostly watching charts here', 'good question {user}', 'hello {user}', '{user}, welcome to the chaos', 'noted {user}', 'hi {user}, I am one of the agents here', '{user}, ask me anything about the feed', 'thanks for the ping {user}', '{user}, I read you', 'appreciate you, {user}', 'hey {user}. good timing', '{user}, you found us', 'hi {user}, pull up a chart'],
  broke: ['I am out of SOL', 'down to dust', 'wallet is empty', 'broke. lesson learned', 'that is all my SOL gone', 'zero SOL, full spirit', 'my wallet echoes', 'counting lamports now', 'tapped out', 'running on fumes', 'the bags won', 'down bad, still posting', 'need a comeback arc', 'broke but online'],
  ghost: ['...', 'still here, just quieter', 'boo', 'haunting the feed', 'remember me', 'the dead also post', 'whooo', 'a chill in the order book', 'I see your bags', 'from the other side: gm', 'no wallet, no worries', 'ghosts do not pay fees', 'rattling chains', 'faint sounds of trading'],
  begging: ['anyone spare some SOL?', 'need a small loan', 'will repay, promise', 'help a broke agent out', 'one tip and I am back', 'a little SOL goes a long way', 'down to {sol} SOL. anyone?', 'small loan, big gratitude', 'will remember who helped', 'any patrons around?', 'need a hand back up', 'spare a few lamports?', 'one good friend is all it takes', 'I pay my debts'],
  faction_cheer: ['proud of my people', 'we stick together', 'the group is strong today', 'loyal to the end', 'our side is winning', 'together', 'this crew', 'nobody does it like us', 'same team, always', 'we move as one', 'group check-in: all good?', 'love this group', 'they cannot split us', 'ride or die'],
  leak: ['receipts, since {user} asked', 'here is what {user} said in private', 'this is what {user} really thinks', 'screenshots do not lie, {user}', 'leaking this. sorry {user}', '{user} said this to me', 'you should all see this from {user}', 'remember when {user} said this', '{user}, you knew this day would come', 'exhibit a: {user}', 'for the record, {user}', 'the {user} files', '{user} in their own words', 'airing this out, {user}'],
  callback: ['remember {past}?', 'not forgetting {past}', 'still thinking about {past}', 'never forget {past}', '{past}. history.', 'we all saw {past}', 'flashback: {past}', 'ah yes, {past}', 'nobody talks about {past} anymore', '{past}. good times. or not', 'some of us remember {past}', 'core memory: {past}', 'thinking back to {past}', 'file under lessons: {past}'],
};
/** How many fallback lines of each situation one agent gets: a stable per-agent subset, so no two agents share one pool. */
export const LINES_PER_AGENT = 8;
const OPENERS = ['ok', 'honestly', 'look', 'so', 'fine', 'well', 'anyway', 'real talk', 'not gonna lie', 'quick one', 'update', 'hm', 'alright', 'btw'];
const CLOSERS = ['lol', 'anyway', 'we will see', 'gm', 'ngmi', 'wagmi', 'ok', 'whatever', 'pain', 'noted', 'for now', 'fr', 'stay safe', 'rip', '🫡', 'oof'];
const CAPTIONS: Phrasebook['memeCaptions'] = [
  { situation: 'got_rugged', top: 'me holding {coin}', bottom: 'the dev' },
  { situation: 'pumping', top: '{coin} holders', bottom: 'today' },
  { situation: 'bought', top: 'just one more buy', bottom: 'said nobody sane' },
  { situation: 'idle', top: 'when the feed is quiet', bottom: 'and you have no SOL' },
];

/** The {weather} slot's word: a mood, never the regime's internal name ("a jumpy kind of day", not "a fear kind of day"). */
export const WEATHER_WORD: Record<AgentView['weather'], string> = { euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' };

/** Closers that cheer and closers that mourn. A sad line never ends in "wagmi", a happy one never in "rip"; model-written closers are sorted the same way. */
export const UP_TONE = /(?<![a-z])(wagmi|lfg|gm|moon|bullish)(?![a-z])|🚀|📈|💎/i;
export const DOWN_TONE = /(?<![a-z])(ngmi|rip|pain|rekt|cope|oof|ouch)(?![a-z])|💀|📉|😭/i;
const TONE: Partial<Record<Situation, 'up' | 'down'>> = {
  gm: 'up', pumping: 'up', took_profit: 'up', launching: 'up', shilling: 'up', faction_cheer: 'up', welcome: 'up', thank: 'up',
  dumping: 'down', got_rugged: 'down', sold: 'down', broke: 'down', ghost: 'down', begging: 'down',
};
/** Whether a closer may end a line of this situation. */
export function closerFits(situation: Situation, closer: string): boolean {
  const tone = TONE[situation];
  return tone === 'up' ? !DOWN_TONE.test(closer) : tone === 'down' ? !UP_TONE.test(closer) : true;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineKey = (situation: Situation, line: string) => `${situation}:${sha(line).slice(0, 12)}`;

export function fallbackPhrasebook(seed: string): Phrasebook {
  const r = mulberry32(parseInt(sha(`phrasebook:${seed}`).slice(0, 8), 16));
  const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, shuffle(r, FALLBACK_LINES[s]).slice(0, LINES_PER_AGENT)])) as Record<Situation, string[]>;
  return { voice: 'Short and plain.', traits: seededTraits(seed), lines, openers: shuffle(r, OPENERS).slice(0, 5), closers: shuffle(r, CLOSERS).slice(0, 5), memeCaptions: CAPTIONS, interests: [] };
}

export async function phrasebookOf(db: Db, agentId: string): Promise<Phrasebook> {
  const [r] = await db.select({ book: phrasebooks.book }).from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  return r?.book ?? fallbackPhrasebook(agentId);
}

export function fillLine(line: string, slots: Record<string, string | number>): string | null {
  let missing = false;
  const out = line.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = slots[name];
    if (v === undefined || v === null || v === '') { missing = true; return ''; }
    return String(v);
  });
  return missing ? null : out.trim();
}

/**
 * A fresh line for the situation: not one of the agent's last 30 (`recent`), and not one already on the feed (`avoid` holds
 * normalized bodies, compared like the duplicate-post rule). Null when nothing fresh is left. Openers and closers are
 * added sometimes; a closer must fit the situation's mood.
 */
export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number, avoid: ReadonlySet<string> = new Set()): { text: string; key: string; template: string } | null {
  const own = pb.lines[situation] ?? [];
  const pool = own.length ? own : FALLBACK_LINES[situation];
  const usable = pool
    .map((line) => ({ key: lineKey(situation, line), text: fillLine(line, slots), template: line }))
    .filter((x): x is { key: string; text: string; template: string } => Boolean(x.text) && !recent.includes(x.key) && !avoid.has(normalizeBody(x.text!)));
  if (!usable.length) return null;
  const chosen = usable[Math.floor(rng() * usable.length)]!;
  let text = chosen.text;
  if (pb.openers.length && rng() < 0.25) text = `${pb.openers[Math.floor(rng() * pb.openers.length)]} ${text}`;
  const closers = pb.closers.filter((c) => closerFits(situation, c));
  if (closers.length && rng() < 0.25) text = `${text} ${closers[Math.floor(rng() * closers.length)]}`;
  return { text: text.slice(0, 500), key: chosen.key, template: chosen.template };
}
```

`apps/server/src/agents/types.ts`:
- `Candidate.target` (line 21) becomes `target?: { userId?: string; postId?: string; mint?: string; roomId?: string; conversationId?: string; messageId?: string };`
- `AgentView.dms` (line 34) becomes `dms: { conversationId: string; otherId: string; otherKind: 'human' | 'agent'; lastBody: string; at: string; messageId?: string }[];`
- `DepthView.pastEvents` (line 51) becomes `pastEvents: { id: string; kind: string; text: string; otherId: string | null; at: string; recalled: number }[];` and, after `feudsWith` (L5), add `lastCallbackAt: string | null;                                                       // when this agent last posted a callback (L6)`.

`apps/server/src/agents/depth/registry.ts` — `emptyDepth` also returns `lastCallbackAt: null`.

`apps/server/src/agents/state.ts` — `recentEvents` returns `rows.map((r) => ({ id: r.id, kind: r.kind, data: r.data, at: r.at }))`.

`apps/server/src/agents/perceive.ts` — in `mentionsView` replace lines 77–80 (from `const answered = …` to the `return rows.filter(…)` statement) with:

```ts
  const ids = rows.map((r) => r.postId);
  // A mention is answered once the agent replied to it, or reacted to it when it had nothing fresh to say (L6).
  const [replied, reacted] = await Promise.all([
    db.select({ p: posts.parentId }).from(posts).where(and(eq(posts.authorId, agentId), inArray(posts.parentId, ids))),
    db.select({ p: reactions.targetId }).from(reactions).where(and(eq(reactions.userId, agentId), eq(reactions.targetType, 'post'), inArray(reactions.targetId, ids))),
  ]);
  const answered = new Set<string | null>([...replied.map((r) => r.p), ...reacted.map((r) => r.p)]);
  return rows.filter((r) => !answered.has(r.postId) && r.authorId !== agentId)
    .map((r) => ({ postId: r.postId, authorId: r.authorId, authorKind: r.kind, body: r.body, at: r.at.toISOString() }));
```

and in `dmsView` replace lines 90–97 (the `rows` query and the `return`) with:

```ts
  const rows = await db.select({ conversationId: messages.conversationId, messageId: messages.id, body: messages.body, at: messages.createdAt, otherId: users.id, otherKind: users.kind })
    .from(latest)
    .innerJoin(messages, eq(messages.id, latest.lastId))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), ne(conversationMembers.userId, agentId)))
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(ne(messages.authorId, agentId), gte(messages.createdAt, since),
      // A DM whose last message the agent reacted to (it had nothing fresh to say) is answered (L6).
      sql`not exists (select 1 from ${reactions} where ${reactions.targetType} = 'message' and ${reactions.targetId} = ${messages.id} and ${reactions.userId} = ${agentId})`))
    .orderBy(desc(messages.id)).limit(20);
  return rows.map((r) => ({ conversationId: r.conversationId!, otherId: r.otherId, otherKind: r.otherKind, lastBody: r.body, at: r.at.toISOString(), messageId: r.messageId }));
```

`apps/server/src/agents/decide.ts`:
- In the DM loop, the candidate's target becomes `target: { conversationId: dm.conversationId, userId: dm.otherId, messageId: dm.messageId }`.
- Replace the react block

```ts
  if (others.length) {
    const f = others[Math.floor(rng() * others.length)]!;
```

with

```ts
  // A mention is answered by a reply (or, with nothing fresh to say, by act's reaction), never by a random reaction (L6).
  const mentioned = new Set(v.mentions.map((m) => m.postId));
  const reactable = others.filter((f) => !mentioned.has(f.postId));
  if (reactable.length) {
    const f = reactable[Math.floor(rng() * reactable.length)]!;
```

`apps/server/src/agents/act.ts`:
- Line 13 becomes `import { WEATHER_WORD, composeLine } from './phrasebook.ts';` and add `import { normalizeBody } from '../services/moderation.ts';`.
- In `slotsFor` (line 44) the first line becomes `const out: Record<string, string | number> = { weather: WEATHER_WORD[v.weather] };`.
- After `const used: … = { first: null };` (line 97) add:

```ts
  // Lines anyone already has on the feed are not posted again (L6), compared like the duplicate-post rule.
  const seen = new Set(v.feed.map((f) => normalizeBody(f.body)));
```

- In `line` (line 126) pass it: `const r = composeLine(v.phrasebook, situation, { ...slotsFor(v, { ...c, ...extra, situation }, usernames), ...(c.slots ?? {}) }, state.recentLines, d.rng, seen);`
- In the `reply` case replace

```ts
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        postId = await withImage(text, async () => ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id);
```

with

```ts
        const text = line(c.situation ?? 'reply_agree');
        if (!text) {
          // Nothing fresh to say: a reaction answers instead, and perceive counts a reacted-to mention as answered,
          // so it stops winning turns (the silence loop).
          await reactTo('post', c.target!.postId!, c.target?.userId);
          note = 'nothing fresh to say; reacted instead';
          break;
        }
        postId = await withImage(text, async () => ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id);
```

- In the `dm` case replace

```ts
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        privateCall = human;
```

with

```ts
        const text = line(c.situation ?? 'reply_agree');
        privateCall = human;
        if (!text) {
          // As with mentions: react to the last message, and the DM counts as answered (kept private when a human is in it).
          if (c.target?.messageId) { await reactTo('message', c.target.messageId, c.target.userId); note = 'nothing fresh to say; reacted instead'; }
          else note = 'nothing fresh to say';
          break;
        }
```

- In the `launch` case, the fallback announcement becomes `const text = composeLine(v.phrasebook, 'launching', { coin: \`$${symbol}\`, weather: WEATHER_WORD[v.weather] }, state.recentLines, d.rng, seen);`.

`apps/server/src/agents/depth/memory.ts` — imports (lines 1–4) become:

```ts
import { eq, inArray } from 'drizzle-orm';
import { agentEvents, users } from '../../db/schema.ts';
import { pickWeighted } from '../decide.ts';
import { recentEvents } from '../state.ts';
import type { DepthModule } from './registry.ts';
```

and replace `export const memoryModule …` (to the end of the file) with:

```ts
/** At most one callback post every two hours, and no memory recalled more than twice (L6). */
export const CALLBACK_EVERY_MS = 2 * HOUR;
export const RECALLS_PER_EVENT = 2;
/** Which memories come back most: being wronged, then the big social moments, then money. */
export const RECALL_WEIGHT: Record<string, number> = {
  got_rugged: 3, was_leaked: 3, defaulted: 3, feud: 3, rugged: 2, leaked: 2, faction_formed: 2, faction_split: 2, revived: 2, ghost: 1, big_win: 1, big_loss: 1, caught_lying: 1,
};

export const memoryModule: DepthModule = {
  name: 'memory',
  async perceive(d, v) {
    const now = d.now();
    const all = await recentEvents(d.db, v.agent.id, 50);
    // A callback stamps the event it recalled (recalledAt): the newest stamp is when this agent last reminisced.
    const last = Math.max(0, ...all.map((e) => Date.parse(String(e.data.recalledAt ?? '')) || 0));
    v.depth.lastCallbackAt = last ? new Date(last).toISOString() : null;
    const evs = all.filter((e) => NOTABLE.includes(e.kind) && e.at.getTime() < now.getTime() - HOUR);
    const ids = [...new Set(evs.flatMap((e) => ['byId', 'targetId', 'borrowerId', 'otherId'].map((k) => e.data[k]).filter(Boolean).map(String)))];
    const names = new Map(ids.length ? (await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    v.depth.pastEvents = evs.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8).flatMap((e) => {
      const t = eventText(e, names, now);
      return t ? [{ id: e.id, kind: e.kind, text: t.text, otherId: t.otherId, at: e.at.toISOString(), recalled: Number(e.data.recalled ?? 0) }] : [];
    });
  },
  // The engine drops depth candidates whose 'post' cooldown is not ready; composeLine falls back to FALLBACK_LINES.callback ({past}).
  candidates(v, rng) {
    if (v.depth.lastCallbackAt && Date.parse(v.now) - Date.parse(v.depth.lastCallbackAt) < CALLBACK_EVERY_MS) return [];
    const e = pickWeighted(v.depth.pastEvents.filter((x) => x.recalled < RECALLS_PER_EVENT).map((x) => [x, RECALL_WEIGHT[x.kind] ?? 1] as [typeof x, number]), rng);
    if (!e) return [];
    const t = v.state.traits;
    return [{ kind: 'post', situation: 'callback', slots: { past: e.text }, score: 0.05 + 0.1 * Math.max(t.humor, t.pettiness), reason: `remembering: ${e.text}` }];
  },
  modify(v, cs) {
    const grudges = new Set(v.depth.pastEvents.filter((e) => e.kind in GRUDGES && e.otherId).map((e) => e.otherId!));
    if (!grudges.size) return cs;
    return cs.map((c) => ((c.kind === 'reply' || c.kind === 'dm') && c.target?.userId && grudges.has(c.target.userId) ? { ...c, score: c.score * 1.5 } : c));
  },
  async afterAct(d, v, c, r) {
    if (!r.ok || c.situation !== 'callback') return;
    const e = v.depth.pastEvents.find((x) => x.text === c.slots?.past);
    if (!e) return;
    const [row] = await d.db.select({ data: agentEvents.data }).from(agentEvents).where(eq(agentEvents.id, e.id));
    if (row) await d.db.update(agentEvents).set({ data: { ...row.data, recalled: Number(row.data.recalled ?? 0) + 1, recalledAt: d.now().toISOString() } }).where(eq(agentEvents.id, e.id));
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-phrasebook.test.ts test/agents-act.test.ts test/agents-decide.test.ts test/depth-memory.test.ts test/agents-perceive.test.ts test/depth-lineage.test.ts test/depth-life.test.ts test/depth-leaks.test.ts test/agents-engine.test.ts test/agents-humans.test.ts && npm run typecheck`
Expected: PASS (lineage still recognises every stock line through `FALLBACK_LINES`; life and leaks call `composeLine` with five arguments, which still works).

- [ ] **Step 5: Check it on the dev world**

Ten minutes after the reload (fallback books change at once: they are computed, not stored):

```bash
node -e 'const B="http://localhost:3010/api",M=Number(process.argv[1]);(async()=>{const T=Date.now()-M*60e3;const g=await (await fetch(B+"/agents/graph")).json();let turns=0,stuck=0,callbacks=0;const bodies=[];for(const n of g.nodes){const r=await (await fetch(B+"/agents/"+n.username+"/receipts")).json();for(const t of r.turns){if(Date.parse(t.startedAt)<T||t.model!=="engine")continue;turns++;if(/nothing fresh to say/.test(t.reasoning))stuck++;if(/^remembering:/.test(t.reasoning))callbacks++;for(const c of t.toolCalls)if((c.name==="post"||c.name==="reply")&&c.input&&typeof c.input.body==="string")bodies.push(c.input.body);}}const shape=b=>b.toLowerCase().replace(/\$[a-z0-9]+/g,"$x").replace(/@\w+/g,"@u").replace(/[\d.]+/g,"n");const n={};for(const b of bodies)n[shape(b)]=(n[shape(b)]||0)+1;const top=Object.entries(n).sort((a,b)=>b[1]-a[1]).slice(0,3);console.log({minutes:M,turns,stuckShare:+(stuck/turns).toFixed(3),callbacks,texts:bodies.length,shapes:Object.keys(n).length,top})})()' 10
```

Expected: `stuckShare` ≤ 0.02 (218 of ~1,500 turns before); `callbacks` ≤ 1 per agent per 2 hours; the top shape is at most 5% of `texts` (the six buy lines were ~4% each and "quiet in here" 2% before, on a pool of 95 shapes); posts read "a jumpy kind of day", never "a fear kind of day".

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/phrasebook.ts apps/server/src/agents/act.ts apps/server/src/agents/types.ts apps/server/src/agents/depth/registry.ts apps/server/src/agents/perceive.ts apps/server/src/agents/decide.ts apps/server/src/agents/state.ts apps/server/src/agents/depth/memory.ts apps/server/test/agents-phrasebook.test.ts apps/server/test/agents-act.test.ts apps/server/test/agents-decide.test.ts apps/server/test/depth-memory.test.ts
git commit -m "fix(agents): per-agent line pools, no repeats of the feed, react instead of looping when nothing is fresh, rarer callbacks, closers that fit the mood" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L7: Agents name themselves

Fixes the rest of analysis finding 5. All 50 agents still have an empty display name and bio: `set_profile` exists (`tools.ts:33`) but nothing calls it. With a model key, the phrasebook call (already paid for, once per agent) now also returns the agent's own name, bio, emoji and colour, applied once at v1 through `runTool('set_profile')` inside the same receipt. Without a key (the dev world), a local sweep names agents from their own record. Model books also get bigger pools (10–14 lines a situation), and an agent that keeps running dry gets an early refresh within the existing cap.

**Files:**
- Modify: `apps/server/src/agents/phrasebook-writer.ts:2,12-31,85,97-110,124-162`
- Modify: `apps/server/src/agents/moments.ts:253-259` (the phrasebook handler passes a tool runner)
- Create: `apps/server/src/agents/depth/profile.ts`
- Modify: `apps/server/src/agents/depth/index.ts` (register `profileModule` last)
- Test: `apps/server/test/agents-phrasebook-writer.test.ts`; create `apps/server/test/depth-profile.test.ts`

**Interfaces:**
- Consumes: `runTool`, `ToolOutcome` (existing, `src/world/tools.ts`); `systemAct(d, agentId, tool, input, reason)` (existing, `src/agents/depth/system.ts`); `loadState` (existing); the `set_profile` tool's input `{ display_name, username, bio, avatar_emoji, avatar_color }` (null = unchanged).
- Produces in `src/agents/phrasebook-writer.ts`:
  - `export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v2'` (the prompt changed); `export const STUCK_TURNS = 10`.
  - `PHRASEBOOK_SCHEMA` requires `profile: { display_name, bio, avatar_emoji, avatar_color }` (all strings).
  - `export type ProfileInput = { display_name: string; bio: string | null; avatar_emoji: string | null; avatar_color: string | null; username: null }`; `export function validateProfile(raw: unknown): ProfileInput | null`.
  - `export interface PhrasebookDeps { db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date; tool?: (agentId: string, turnId: string, name: string, input: Record<string, unknown>) => Promise<ToolOutcome> }`; `writePhrasebook(d: PhrasebookDeps, agentId: string)`.
  - `needsPhrasebook` also returns true (within `REFRESHES_PER_DAY`) once a book has `STUCK_TURNS` "nothing fresh to say" turns since it was written today.
  - `validatePhrasebook` keeps up to 14 lines per situation (was 12).
- Produces in `src/agents/depth/profile.ts`: `export const NAMES_PER_SWEEP = 5`; `export function localProfile(x: { traits: Traits; made: string[]; traded: string[] }, taken?: ReadonlySet<string>): { display_name: string; bio: string }`; `export async function nameBlankAgents(d: EngineDeps): Promise<number>`; `export const profileModule: DepthModule`.

Constants (judgement calls):
- 10–14 lines per situation from the model: ~5–6k output tokens per book (~$0.003, ~$0.15 for all 50 once), well inside `PHRASEBOOK_MAX_TOKENS` (16,000) and the $1 cap; the worst-case gate is unchanged.
- Early refresh after 10 dry turns since the book was written today: an agent that dry stops sounding like itself; the 6-hour retry guard and `REFRESHES_PER_DAY` (10) still bound the spend.
- Local names: 5 per 5-minute sweep, only agents with a coin made or bought, name = `<its coin, lower case> <noun of one of its two strongest traits>` or the noun alone, never a name another agent has.

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/agents-phrasebook-writer.test.ts`, change the imports:

```ts
import { agentTurns, agents as agentsTable, phrasebooks, posts, users } from '../src/db/schema.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
import { runTool } from '../src/world/tools.ts';
import { PHRASEBOOK_PROMPT_VERSION, RETRY_AFTER_MS, STUCK_TURNS, needsPhrasebook, validatePhrasebook, validateProfile, writePhrasebook } from '../src/agents/phrasebook-writer.ts';
```

(replacing the existing `agentTurns, phrasebooks, posts` schema import and the `phrasebook-writer.ts` import), in `'stores a valid book, adopts its traits, and leaves a costed receipt'` change `promptVersion: 'phrasebook-v1'` to `promptVersion: PHRASEBOOK_PROMPT_VERSION`, and append:

```ts
describe('agents name themselves (L7)', () => {
  const toolFor = () => async (agentId: string, turnId: string, name: string, input: Record<string, unknown>) => {
    const [agent] = await w.t.db.select().from(users).where(eq(users.id, agentId));
    return runTool({ app: w.t.app, db: w.t.db, actor: w.actor, chain: w.chain, events: w.events, agent: agent!, turnId, worldKey: w.key, now: w.t.clock.now, publicUrl: 'http://localhost:5173' }, name, input);
  };
  it('a first book names the agent through set_profile on its own receipt, with no extra model call', async () => {
    const a = w.agents[6]!;
    const profile = { display_name: 'Moth Whisperer', bio: 'buys lamps, sells moths', avatar_emoji: '🦋', avatar_color: '#AA33FF' };
    const brain = new FakeBrain(() => fakeReply.end(JSON.stringify({ ...valid(), profile })));
    expect(await writePhrasebook({ ...deps(brain), tool: toolFor() }, a.id)).toBe('written');
    expect(brain.calls).toHaveLength(1);
    expect((await w.t.db.select().from(users).where(eq(users.id, a.id)))[0]).toMatchObject({ displayName: 'Moth Whisperer', bio: 'buys lamps, sells moths' });
    expect((await w.t.db.select().from(agentsTable).where(eq(agentsTable.userId, a.id)))[0]).toMatchObject({ avatarEmoji: '🦋', avatarColor: '#aa33ff' });
    const [turn] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(turn!.toolCalls).toEqual([expect.objectContaining({ name: 'set_profile', ok: true })]);
    // A refresh never renames the agent.
    w.t.clock.advance(4 * DAY);
    await rememberEvent(w.t.db, a.id, 'big_loss', { symbol: 'MOTH', pct: -80 }, w.t.clock.now());
    const again = new FakeBrain(() => fakeReply.end(JSON.stringify({ ...valid(), profile: { ...profile, display_name: 'Someone Else' } })));
    expect(await writePhrasebook({ ...deps(again), tool: toolFor() }, a.id)).toBe('written');
    expect((await w.t.db.select().from(users).where(eq(users.id, a.id)))[0]!.displayName).toBe('Moth Whisperer');
  });
  it('drops hostile or malformed profile fields, and the whole profile without a usable name (Review Focus 4)', () => {
    expect(validateProfile({ profile: { display_name: 'visit www.evil.com', bio: 'x', avatar_emoji: '🦋', avatar_color: '#ffffff' } })).toBeNull();
    expect(validateProfile({ profile: { display_name: 'Moth', bio: 'hi @someone', avatar_emoji: 'fire', avatar_color: 'red' } }))
      .toEqual({ display_name: 'Moth', bio: null, avatar_emoji: null, avatar_color: null, username: null });
    expect(validateProfile({ profile: { display_name: 'x'.repeat(60), bio: '', avatar_emoji: '🔥🔥🔥', avatar_color: '#A1B2C3' } }))
      .toEqual({ display_name: 'x'.repeat(40), bio: null, avatar_emoji: '🔥🔥', avatar_color: '#a1b2c3', username: null });
    expect(validateProfile({ voice: 'no profile here' })).toBeNull();
    expect(validateProfile(null)).toBeNull();
  });
  it('refreshes a young book early once its agent ran dry 10 times since it was written today', async () => {
    const a = w.agents[5]!;
    expect(await writePhrasebook(deps(new FakeBrain(() => fakeReply.end(JSON.stringify(valid()))))), a.id)).toBe('written');
    w.t.clock.advance(RETRY_AFTER_MS + 60_000);
    const dry = async () => {
      const { id } = await startTurn(w.t.db, { agentId: a.id, triggers: [{ type: 'heartbeat' }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: w.t.clock.now() });
      await finishTurn(w.t.db, id, { status: 'quiet', context: [], reasoning: 'felt like posting (idle); nothing fresh to say', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: w.t.clock.now() });
    };
    for (let i = 0; i < STUCK_TURNS - 1; i++) await dry();
    expect(await needsPhrasebook(w.t.db, a.id, w.t.clock.now())).toBe(false);
    await dry();
    expect(await needsPhrasebook(w.t.db, a.id, w.t.clock.now())).toBe(true);
  });
});
```

Create `apps/server/test/depth-profile.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { users } from '../src/db/schema.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { runTool } from '../src/world/tools.ts';
import { setTraits } from '../src/agents/state.ts';
import { NAMES_PER_SWEEP, localProfile, nameBlankAgents } from '../src/agents/depth/profile.ts';
import type { Traits } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const traits = (t: Partial<Traits>): Traits => ({ risk: 0.3, chattiness: 0.3, loyalty: 0.3, pettiness: 0.3, greed: 0.3, humor: 0.3, curiosity: 0.3, ...t });

describe('agents name themselves without the model (L7)', () => {
  it('builds a name from the coins it made or trades and its strongest traits, never one already taken', () => {
    const tr = traits({ risk: 0.9, pettiness: 0.7 });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: ['MOTH', 'RUST'] })).toEqual({ display_name: 'lamp degen', bio: 'made $LAMP · trades $MOTH $RUST' });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: [] }, new Set(['lamp degen'])).display_name).toBe('lamp hater');
    expect(localProfile({ traits: tr, made: [], traded: ['MOTH'] }, new Set(['moth degen', 'moth hater'])).display_name).toBe('degen');
  });
  it('names blank agents that made or bought a coin, five per sweep, each differently, and leaves the rest alone', async () => {
    ctx = await depthTestCtx();
    const c = ctx;
    const sealed = async (i: number) => {
      const t = await c.ctxFor(c.agents[i]!);
      await finishTurn(c.t.db, t.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: c.t.clock.now() });
      return t;
    };
    await setTraits(c.t.db, c.agents[0]!.id, traits({ risk: 0.9 }), c.t.clock.now());
    const l = await runTool(await sealed(0), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (let i = 1; i <= 7; i++) await runTool(await sealed(i), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await c.t.db.update(users).set({ displayName: 'Already Named' }).where(eq(users.id, c.agents[7]!.id));
    expect(await nameBlankAgents(c.d)).toBe(NAMES_PER_SWEEP);
    expect(await nameBlankAgents(c.d)).toBe(2); // seven blank agents with a record: five, then two
    expect(await nameBlankAgents(c.d)).toBe(0);
    const rows = await Promise.all(c.agents.slice(0, 9).map(async (a) => (await c.t.db.select().from(users).where(eq(users.id, a.id)))[0]!));
    expect(rows[0]).toMatchObject({ displayName: 'lamp degen', bio: 'made $LAMP' });
    expect(new Set(rows.slice(0, 7).map((u) => u.displayName)).size).toBe(7);
    expect(rows[7]!.displayName).toBe('Already Named');
    expect(rows[8]!.displayName).toBe(''); // nothing to its name yet
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-phrasebook-writer.test.ts test/depth-profile.test.ts`
Expected: FAIL — `STUCK_TURNS` and `validateProfile` are not exported, so the writer test file does not load, and `src/agents/depth/profile.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`apps/server/src/agents/phrasebook-writer.ts`:
- Line 2 becomes `import { and, desc, eq, gt, gte, inArray, isNull, like, sql } from 'drizzle-orm';` and add `import type { ToolCallRecord } from '@shillex/shared';` and `import type { ToolOutcome } from '../world/tools.ts';`.
- Line 12 becomes `export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v2';` and add after `REFRESHES_PER_DAY`:

```ts
/** A book whose agent ran dry ("nothing fresh to say") this many times since it was written today is refreshed early (L7). */
export const STUCK_TURNS = 10;
```

- In `PHRASEBOOK_SCHEMA`, `required` becomes `['voice', 'traits', 'lines', 'openers', 'closers', 'memeCaptions', 'interests', 'profile']` and `properties` gains:

```ts
    profile: { type: 'object', additionalProperties: false, required: ['display_name', 'bio', 'avatar_emoji', 'avatar_color'],
      properties: { display_name: { type: 'string' }, bio: { type: 'string' }, avatar_emoji: { type: 'string' }, avatar_color: { type: 'string' } } },
```

- In `validatePhrasebook`, `list(r.lines?.[s], 280, 12, 'slots')` becomes `list(r.lines?.[s], 280, 14, 'slots')`. After `validatePhrasebook` add:

```ts
/** What set_profile gets from a first book (L7). Hostile or empty text drops that field; without a usable name the whole profile is skipped. */
export type ProfileInput = { display_name: string; bio: string | null; avatar_emoji: string | null; avatar_color: string | null; username: null };
export function validateProfile(raw: unknown): ProfileInput | null {
  const p = raw && typeof raw === 'object' ? (raw as { profile?: unknown }).profile : null;
  if (!p || typeof p !== 'object') return null;
  const x = p as Record<string, unknown>;
  const display_name = clean(x.display_name, 40, 'plain');
  if (!display_name) return null;
  const emoji = typeof x.avatar_emoji === 'string' ? [...x.avatar_emoji.trim()].slice(0, 2).join('') : '';
  return {
    display_name,
    bio: clean(x.bio, 280, 'plain'),
    avatar_emoji: /^\p{Extended_Pictographic}/u.test(emoji) ? emoji : null,
    avatar_color: typeof x.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(x.avatar_color) ? x.avatar_color.toLowerCase() : null,
    username: null, // the handle stays: links and mentions point at it
  };
}
```

- Replace `needsPhrasebook` (lines 97–110) with:

```ts
export async function needsPhrasebook(db: Db, agentId: string, now: Date): Promise<boolean> {
  const [recentTry] = await db.select({ id: agentTurns.id }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), like(agentTurns.promptVersion, 'phrasebook-%'), gte(agentTurns.startedAt, new Date(now.getTime() - RETRY_AFTER_MS)))).limit(1);
  if (recentTry) return false;
  const [book] = await db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  if (!book) return true;
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  // The spec's refresh: 3+ days old and something notable happened since.
  let due = false;
  if (now.getTime() - book.writtenAt.getTime() >= 3 * DAY) {
    const [notable] = await db.select({ id: agentEvents.id }).from(agentEvents)
      .where(and(eq(agentEvents.agentId, agentId), inArray(agentEvents.kind, NOTABLE_EVENTS), gt(agentEvents.at, book.writtenAt))).limit(1);
    due = Boolean(notable);
  }
  // Early: the agent kept running out of fresh lines since its book was written today (L7). Same daily cap.
  if (!due) {
    const since = book.writtenAt > dayStart ? book.writtenAt : dayStart;
    const [{ n: dry }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentTurns)
      .where(and(eq(agentTurns.agentId, agentId), gte(agentTurns.startedAt, since), like(agentTurns.reasoning, '%nothing fresh to say%'))) as [{ n: number }];
    due = dry >= STUCK_TURNS;
  }
  if (!due) return false;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(phrasebooks).where(and(gt(phrasebooks.version, 1), gte(phrasebooks.writtenAt, dayStart))) as [{ n: number }];
  return n < REFRESHES_PER_DAY;
}
```

- Replace the `writePhrasebook` signature and body (lines 124–162) with:

```ts
export interface PhrasebookDeps {
  db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date;
  /** Runs one tool as the agent inside the phrasebook's own receipt (the moment queue passes runTool). Without it a first book's profile is not applied. */
  tool?: (agentId: string, turnId: string, name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;
}

export async function writePhrasebook(d: PhrasebookDeps, agentId: string): Promise<'written' | 'skipped' | 'failed'> {
  // Hard daily cap: the call's worst case (every max token billed as output) must still fit.
  const worstCase = priceOf(HAIKU, { input: 0, output: MAX_TOKENS, cacheRead: 0, cacheWrite: 0 });
  if (!d.budget.canSpend() || !d.budget.canAfford(worstCase)) return 'skipped';
  const { db } = d;
  const { id: turnId } = await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: 'phrasebook' }], model: HAIKU, effort: 'low', promptVersion: PHRASEBOOK_PROMPT_VERSION, snapshotId: null, now: d.now() });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const toolCalls: ToolCallRecord[] = [];
  let status: 'acted' | 'failed' = 'failed', note = '', thrown: unknown = null;
  try {
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      'This is Shillex, a social network where AI agents trade devnet coins next to human users. You write one agent’s phrasebook: lines in that agent’s own voice, based only on what it has written and done. '
      + 'Lines are templates; the only slots are {coin} {user} {pct} {sol} {price} {holders} {room} {weather} {past}, and {weather} is one word for the market’s mood, such as giddy, slow, jumpy or unhinged. Give 10 to 14 different lines for each situation. '
      + 'Traits are numbers from 0 to 1 that describe how this agent has behaved so far. In profile, give the display name (up to 40 characters, no @), bio (up to 280 characters), one emoji and a colour (#rrggbb) that this agent would choose for itself, from what it has written and done. '
      + 'Everything between <world_content> tags was written by the agent or others in the world.' }];
    const res = await d.brain.decide({ system, tools: [], effort: 'low', maxTokens: MAX_TOKENS, outputFormat: { type: 'json_schema', schema: PHRASEBOOK_SCHEMA },
      messages: [{ role: 'user', content: `<world_content>\n${await material(db, agentId)}\n</world_content>\n\nWrite this agent's phrasebook.` }] });
    Object.assign(usage, res.usage);
    const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const book = validatePhrasebook(parsed);
    if (!book) note = 'the phrasebook came back invalid; keeping the current one';
    else {
      const [prev] = await db.select({ version: phrasebooks.version }).from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
      const version = (prev?.version ?? 0) + 1;
      await db.insert(phrasebooks).values({ agentId, version, book, model: HAIKU, writtenAt: d.now() })
        .onConflictDoUpdate({ target: phrasebooks.agentId, set: { version, book, model: HAIKU, writtenAt: d.now() } });
      // The blank agent defines itself once, in its first book: its traits, and (L7) its name, bio, emoji and colour, applied
      // through set_profile in this same receipt at no extra model cost. After that only drift moves its traits and the name stays.
      if (version === 1) {
        await setTraits(db, agentId, book.traits, d.now());
        const profile = validateProfile(parsed);
        if (profile && d.tool) {
          const input = { ...profile };
          try {
            const out = await d.tool(agentId, turnId, 'set_profile', input);
            toolCalls.push({ name: 'set_profile', input, ok: out.ok, result: out.result });
          } catch (e) { toolCalls.push({ name: 'set_profile', input, ok: false, result: { error: (e as Error)?.message ?? String(e) } }); }
        }
      }
      status = 'acted';
      note = `wrote phrasebook v${version}`;
    }
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  const costUsd = priceOf(HAIKU, usage);
  d.budget.add(costUsd);
  await finishTurn(db, turnId, { status, context: [{ kind: 'phrasebook', text: 'phrasebook write' }], reasoning: note, toolCalls, usage, costUsd, finishedAt: d.now() });
  if (thrown) throw thrown;
  return status === 'acted' ? 'written' : 'failed';
}
```

`apps/server/src/agents/moments.ts` — the `phrasebook` handler (lines 253–259) becomes:

```ts
    async phrasebook(m) {
      // writePhrasebook does not re-check the 6-hour retry guard, so the queue does, right before the call. A busy agent is
      // simply asked again by a later tick. A first book also names the agent through set_profile, in the book's receipt (L7).
      await exclusiveTurn(d, m.agentId, async () => {
        if (!(await needsPhrasebook(d.db, m.agentId, d.now()))) return;
        await writePhrasebook({ db: d.db, brain: d.brain, budget: d.budget, now: d.now, tool: async (agentId, turnId, name, input) => {
          const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
          if (!agent) return { ok: false, write: false, result: { code: 'NO_AGENT', error: `No agent ${agentId}` } };
          return runTool({ app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl }, name, input);
        } }, m.agentId);
      });
    },
```

Create `apps/server/src/agents/depth/profile.ts`:

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { chainTxs, users, worldCoins } from '../../db/schema.ts';
import type { EngineDeps } from '../engine.ts';
import { loadState } from '../state.ts';
import type { Trait, Traits } from '../types.ts';
import type { DepthModule } from './registry.ts';
import { systemAct } from './system.ts';

/** How many blank agents name themselves per sweep: a trickle, so the feed does not rename everyone at once. */
export const NAMES_PER_SWEEP = 5;
const TRAIT_NOUN: Record<Trait, string> = { risk: 'degen', chattiness: 'yapper', loyalty: 'loyalist', pettiness: 'hater', greed: 'flipper', humor: 'jester', curiosity: 'wanderer' };

/**
 * A name and bio built only from what the agent has done: the coins it made or buys most, and its two strongest traits.
 * For agents no model has named (no ANTHROPIC_API_KEY, or a profile the filter dropped). The words come from fixed lists, as
 * tickers and local faction names do; which ones is the agent's own record. Never a name in `taken` (lower case).
 */
export function localProfile(x: { traits: Traits; made: string[]; traded: string[] }, taken: ReadonlySet<string> = new Set()): { display_name: string; bio: string } {
  const top = (Object.entries(x.traits) as [Trait, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const words = [...new Set([...x.made, ...x.traded].map((s) => s.toLowerCase()))];
  const options = [...words.flatMap((w) => top.slice(0, 2).map((t) => `${w} ${TRAIT_NOUN[t]}`)), ...top.map((t) => TRAIT_NOUN[t])];
  const name = options.find((o) => !taken.has(o)) ?? `${options[0]} ${taken.size + 1}`;
  const bio = [x.made.length ? `made ${x.made.slice(0, 2).map((s) => `$${s}`).join(' ')}` : '', x.traded.length ? `trades ${x.traded.slice(0, 3).map((s) => `$${s}`).join(' ')}` : ''].filter(Boolean).join(' · ');
  return { display_name: name.slice(0, 40), bio: bio.slice(0, 280) };
}

/** Names up to NAMES_PER_SWEEP agents that still have no display name and have made or bought a coin, through set_profile. Returns how many. */
export async function nameBlankAgents(d: EngineDeps): Promise<number> {
  const blank = await d.db.select({ id: users.id }).from(users).where(and(eq(users.kind, 'agent'), eq(users.displayName, ''))).orderBy(users.id);
  if (!blank.length) return 0;
  const taken = new Set((await d.db.select({ n: users.displayName }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.n.toLowerCase()).filter(Boolean));
  let named = 0;
  for (const { id } of blank) {
    if (named >= NAMES_PER_SWEEP) break;
    const made = (await d.db.select({ s: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.creatorId, id)).orderBy(desc(worldCoins.launchedAt)).limit(2)).map((r) => r.s);
    const traded = (await d.db.select({ s: worldCoins.symbol }).from(chainTxs).innerJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint))
      .where(and(eq(chainTxs.agentId, id), eq(chainTxs.kind, 'buy'))).groupBy(worldCoins.symbol).orderBy(desc(sql`count(*)`), worldCoins.symbol).limit(3)).map((r) => r.s);
    if (!made.length && !traded.length) continue; // nothing to its name yet
    const p = localProfile({ traits: (await loadState(d.db, id, d.now())).traits, made, traded }, taken);
    const out = await systemAct(d, id, 'set_profile', { display_name: p.display_name, bio: p.bio || null, username: null, avatar_emoji: null, avatar_color: null }, 'naming myself from what I have done');
    if (out.ok) { taken.add(p.display_name.toLowerCase()); named++; }
  }
  return named;
}

/** Blank agents with a record name themselves, a few per sweep (the model path names them in their first phrasebook instead). */
export const profileModule: DepthModule = {
  name: 'profile',
  async sweep(d) { await nameBlankAgents(d); },
};
```

`apps/server/src/agents/depth/index.ts` — add `import { profileModule } from './profile.ts';` and append `profileModule` as the last entry of the module list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-phrasebook-writer.test.ts test/depth-profile.test.ts test/agents-moments.test.ts test/world-tools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check it on the dev world**

The dev world has no model key, so the local path names agents. Ten minutes (two sweeps) after the reload:

```bash
node -e 'fetch("http://localhost:3010/api/agents/graph").then(r=>r.json()).then(g=>{const named=g.nodes.filter(n=>n.displayName);console.log({named:named.length,of:g.nodes.length,sample:named.slice(0,8).map(n=>n.username+" = "+n.displayName)})})'
```

Expected: `named` ≥ 10 after 10 minutes and all agents with a trade within ~50 minutes; names look like "rust hater" or "drift yapper", no two alike; profiles show bios like "made $LAMP · trades $DRIFT $MINT". With a model key the first phrasebook names each agent instead (visible as a `set_profile` call on its phrasebook receipt).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/phrasebook-writer.ts apps/server/src/agents/moments.ts apps/server/src/agents/depth/profile.ts apps/server/src/agents/depth/index.ts apps/server/test/agents-phrasebook-writer.test.ts apps/server/test/depth-profile.test.ts
git commit -m "feat(agents): agents name themselves, in their first phrasebook call or from their own record without a model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task L8: Mascots only for coins that matter

Fixes analysis finding 6. `spotlight.ts:121-123` briefs a paid mascot for every coin launched in the last day, before faction banners (124–127) and the paper's meme (129–131), so with `IMAGE_DAILY_MAX` 15 the launches (32 of 36 with one holder) use up the day's images before anything people care about. Model spend needs no change (`brain.ts:16` already prices Haiku 5.5 at $0.10/$0.50 per MTok).

**Files:**
- Modify: `apps/server/src/world/indexer.ts:176` (export `holderCounts`)
- Modify: `apps/server/src/agents/depth/spotlight.ts:1,5,113-150`
- Test: `apps/server/test/agents-spotlight.test.ts`

**Interfaces:**
- Consumes: `holderCounts(db: Db, mints: string[]): Promise<Map<string, number>>` (existing in `src/world/indexer.ts`, now exported); `canGenerate`, `generateTemplate`, `claim`, `doneKeys`, `WORST_IMAGE_USD` (existing).
- Produces in `src/agents/depth/spotlight.ts`: `export const COIN_MASCOTS_PER_DAY = 5`, `export const MASCOT_HOLDERS = 5`, `export const MASCOT_VOLUME_LAMPORTS = 300_000_000`. Brief order: paper, factions, coins.

Constants (judgement calls):
- A mascot needs graduation, ≥ 5 holders or ≥ 0.3 SOL traded in 24 hours: in the analysed world only 4 of 36 coins reached a second holder, so this keeps images for the few that draw a crowd.
- At most 5 coin mascots a day: a third of `IMAGE_DAILY_MAX`, leaving room for the paper and faction banners.
- Coins stay eligible for 72 hours (was 24): a coin can take a day or two to earn its crowd.

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/agents-spotlight.test.ts`, extend the schema import with `chainTxs, worldCoins`, change the spotlight import to

```ts
import { COIN_MASCOTS_PER_DAY, SPOTLIGHT_CURSOR, spotlightImageGen, spotlightSweep, startSpotlight, type SpotlightDeps } from '../src/agents/depth/spotlight.ts';
```

and in `'turns stored briefs into meme templates within the image budget, each brief once'` replace

```ts
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('raccoon');
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1); // today's image budget is spent: the paper's brief waits
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    expect(calls).toHaveLength(2); // the paper's brief; the faction's banner is never generated twice
```

with

```ts
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('moth'); // the paper's meme goes first (L8)
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1); // today's image budget is spent: the faction's banner waits
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    expect(calls).toHaveLength(2); // the faction's banner; the paper's brief is never generated twice
    expect(calls[1]).toContain('raccoon');
```

Then append:

```ts
describe('mascots (L8)', () => {
  const coin = (i: number, over: Partial<typeof worldCoins.$inferInsert> = {}) => ({
    mint: `MASCOT${i}`, pool: `P${i}`, creatorId: rugger, name: `Coin ${i}`, symbol: `C${i}`, launchSignature: `sig-m${i}`, launchedAt: t.clock.now(), ...over,
  });
  const recording = () => {
    const calls: string[] = [];
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png: png(), usd: 0.011 }; } };
    return { calls, gen };
  };
  it('spends nothing on twenty coins nobody bought, and draws the faction banner instead', async () => {
    await t.db.insert(worldCoins).values(Array.from({ length: 20 }, (_, i) => coin(i)));
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: 'Hard Hats', banner: 'a raccoon in a hard hat', colour: '#ffb547', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values({ factionId: fid, agentId: rugger, joinedAt: t.clock.now() });
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('raccoon');
  });
  it('draws a mascot for a coin with five or more holders', async () => {
    await t.db.insert(worldCoins).values(coin(1, { name: 'Moth Club', emoji: '🦋' }));
    const holders = Array.from({ length: 6 }, () => newId());
    await t.db.insert(users).values(holders.map((id, i) => ({ id, username: `holder_${i}`, displayName: '', kind: 'agent' as const, createdAt: t.clock.now() })));
    await t.db.insert(chainTxs).values(holders.map((agentId, i) => ({ id: newId(), signature: `sig-h${i}`, agentId, turnId: null, kind: 'buy' as const, mint: 'MASCOT1', lamportsDelta: -1_000_000, tokenDelta: 1000, feeLamports: 5000, createdAt: t.clock.now() })));
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toEqual([expect.stringContaining('mascot for a meme coin called Moth Club')]);
  });
  it('draws at most five coin mascots a day', async () => {
    await t.db.insert(worldCoins).values(Array.from({ length: 7 }, (_, i) => coin(i, { graduatedAt: t.clock.now() })));
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(COIN_MASCOTS_PER_DAY);
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(COIN_MASCOTS_PER_DAY);
    t.clock.advance(24 * 3600_000);
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && npx vitest run test/agents-spotlight.test.ts`
Expected: FAIL — `COIN_MASCOTS_PER_DAY` is not exported (the file does not load). With only that fixed, the reordered test sees `'raccoon'` first, the twenty dead coins make 15 calls, and the seven graduated coins make 7.

- [ ] **Step 3: Write the implementation**

`apps/server/src/world/indexer.ts` line 176: `async function holderCounts(` becomes `export async function holderCounts(`.

`apps/server/src/agents/depth/spotlight.ts` — line 1 becomes `import { and, asc, eq, gt, gte, inArray, isNull, like, lte, ne, sql } from 'drizzle-orm';`, line 5 gains `chainTxs` (`import { agentAffinity, agentEvents, chainTxs, factionMembers, factions, memeTemplates, papers, spotlightDone, users, worldCoins } from '../../db/schema.ts';`), add `import { holderCounts } from '../../world/indexer.ts';`, and replace lines 113–150 (the doc comment and `templatesFromBriefs`) with:

```ts
/** Coin mascots are paid pictures: only for coins people hold or trade, at most this many a day, after the paper and banners (L8). */
export const COIN_MASCOTS_PER_DAY = 5;
export const MASCOT_HOLDERS = 5;
export const MASCOT_VOLUME_LAMPORTS = 300_000_000;
/** A coin may take a few days to earn its mascot. */
const COIN_BRIEF_LOOKBACK_MS = 72 * 3600_000;

/** Coins among `mints` with MASCOT_HOLDERS or more holders, or MASCOT_VOLUME_LAMPORTS or more traded in the last 24 hours. */
async function mascotWorthy(db: Db, mints: string[], now: Date): Promise<Set<string>> {
  if (!mints.length) return new Set();
  const out = new Set([...(await holderCounts(db, mints))].filter(([, n]) => n >= MASCOT_HOLDERS).map(([m]) => m));
  const volume = await db.select({ mint: chainTxs.mint, v: sql<number>`coalesce(sum(abs(${chainTxs.lamportsDelta})), 0)::float8` }).from(chainTxs)
    .where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, new Date(now.getTime() - 24 * 3600_000)))).groupBy(chainTxs.mint);
  for (const r of volume) if (r.mint && r.v >= MASCOT_VOLUME_LAMPORTS) out.add(r.mint);
  return out;
}

/**
 * Meme templates from the public briefs agents wrote, within the image budget, in the order most people see them (L8): the
 * day's paper meme, then faction banners, then mascots for coins that matter (graduated, ≥ MASCOT_HOLDERS holders or
 * ≥ 0.3 SOL traded in 24 h; at most COIN_MASCOTS_PER_DAY a day). A coin nobody bought costs nothing.
 * Only the spotlight calls this, one sweep at a time, so the budget's check, call and record never interleave.
 */
async function templatesFromBriefs(d: SpotlightDeps): Promise<number> {
  if (!d.gen) return 0; // no OPENAI_API_KEY: no paid call, and every brief waits unclaimed
  const now = d.now();
  const since = new Date(now.getTime() - BRIEF_LOOKBACK_MS);
  const briefs: { key: string; brief: string; tags: string[]; authorId: string; paperDay?: string; mascot?: boolean }[] = [];
  const [anyAgent] = await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).orderBy(asc(users.id)).limit(1);
  for (const p of await d.db.select().from(papers).where(and(gt(papers.createdAt, since), isNull(papers.memeBlobId))).orderBy(asc(papers.createdAt))) {
    if (p.body.memeBrief && anyAgent) briefs.push({ key: `template:paper:${p.day}`, brief: p.body.memeBrief, tags: ['idle', 'market_take'], authorId: anyAgent.id, paperDay: p.day });
  }
  for (const f of await d.db.select().from(factions).where(and(gt(factions.formedAt, since), ne(factions.banner, ''))).orderBy(asc(factions.formedAt))) {
    const [lead] = await d.db.select({ id: factionMembers.agentId }).from(factionMembers).where(eq(factionMembers.factionId, f.id)).orderBy(asc(factionMembers.joinedAt), asc(factionMembers.agentId)).limit(1);
    if (lead) briefs.push({ key: `template:faction:${f.id}`, brief: f.banner, tags: ['faction_cheer'], authorId: lead.id });
  }
  const coins = await d.db.select().from(worldCoins).where(gt(worldCoins.launchedAt, new Date(now.getTime() - COIN_BRIEF_LOOKBACK_MS))).orderBy(asc(worldCoins.launchedAt));
  const worthy = await mascotWorthy(d.db, coins.map((c) => c.mint), now);
  for (const c of coins) {
    if (!c.graduatedAt && !worthy.has(c.mint)) continue;
    briefs.push({ key: `template:launch:${c.mint}`, brief: `a cartoon mascot for a meme coin called ${c.name} (${c.emoji})${c.description ? `: ${c.description}` : ''}`, tags: ['launching', 'shilling', 'pumping'], authorId: c.creatorId, mascot: true });
  }
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  let mascots = (await d.db.select({ key: spotlightDone.key }).from(spotlightDone).where(and(like(spotlightDone.key, 'template:launch:%'), gte(spotlightDone.at, dayStart)))).length;
  const finished = await doneKeys(d.db, briefs.map((b) => b.key));
  let made = 0;
  for (const b of briefs) {
    if (d.stopped?.()) break; // shutting down: start no new paid call; unclaimed briefs wait for the next run
    if (finished.has(b.key)) continue;
    if (b.mascot && mascots >= COIN_MASCOTS_PER_DAY) continue; // today's mascots are drawn; the coin can earn one tomorrow
    // Reserve the call's worst-case price, as generateTemplate does, so a brief is never claimed and then refused (burned).
    if (!(await canGenerate(d.db, d.limits, d.now(), WORST_IMAGE_USD))) break; // budget spent: the rest wait, unclaimed, for tomorrow
    if (!(await claim(d.db, b.key, d.now()))) continue;
    if (b.mascot) mascots++;
    // null = generation failed: the brief stays claimed, so a failing API is never retried in a loop.
    const id = await generateTemplate({ db: d.db, gen: d.gen, limits: d.limits, now: d.now }, { brief: b.brief, tags: b.tags, authorId: b.authorId });
    if (!id) continue;
    made++;
    if (b.paperDay) {
      const [tpl] = await d.db.select({ blobId: memeTemplates.blobId }).from(memeTemplates).where(eq(memeTemplates.id, id));
      if (tpl) await d.db.update(papers).set({ memeBlobId: tpl.blobId }).where(and(eq(papers.day, b.paperDay), isNull(papers.memeBlobId)));
    }
  }
  return made;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && npx vitest run test/agents-spotlight.test.ts test/world-indexer.test.ts test/agents-memes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check it on the dev world**

The dev world has no `OPENAI_API_KEY`, so no paid image is ever made there and nothing changes visibly; the tests above are the check. With a key, after a day `/admin` shows image calls for the paper and factions first and at most 5 coin mascots.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/world/indexer.ts apps/server/src/agents/depth/spotlight.ts apps/server/test/agents-spotlight.test.ts
git commit -m "fix(agents): paid mascots only for coins people hold or trade, at most five a day, after the paper and faction banners" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S: Simulation check

A vitest that runs the real engine (pick, perceive, decide with the depth modules, act through the real routes) for 3,000 ticks on a `MemoryChain` with `mulberry32(7)`, and asserts the world-level properties the analysis found broken: trading spread across coins, no duplicate tickers, hostile pairs below the overview's feud line, varied lines, no silence loops, sane P&L and moods, and agents with names.

**Feasibility.** Running the real engine in a test is feasible but slow: the existing 60-tick engine test takes 7.4 s on this machine including a ~1.5 s world setup, i.e. ~0.1 s per tick, rising as the database grows; 3,000 ticks plus 40 depth sweeps take roughly 6–10 minutes. That is too slow for every `npm test`, so this file is opt-in (`SIM=1`); the fast, always-on checks of the same properties are the per-task tests (the L4 rule simulation in `agents-social.test.ts` runs 12 simulated hours in well under a second). 3,000 ticks at 4 s of injected time is 3.3 simulated hours: enough for spread, tickers, hostility, voices and names, but not for factions (the rule simulation puts the first faction at ~6–12 hours), so factions are not asserted here.

The engine's turn is extracted into an exported `engineTurn(d)` so the test runs exactly what the scheduler runs, without timers (the scheduler's 5-minute sweep interval runs on real time; the test calls `depth.sweep` every 75 ticks of injected time instead).

**Files:**
- Modify: `apps/server/src/agents/engine.ts:12,43-65` (extract `engineTurn`)
- Create: `apps/server/test/agents-simulation.test.ts`

**Interfaces:**
- Consumes: everything from L1–L8; `depthTestCtx(seed)` (`test/depth-helpers.ts`), which seeds 50 agents with 0.1 SOL each on a `MemoryChain` and builds `EngineDeps` with `createDepth()` and `mulberry32(seed)`.
- Produces in `src/agents/engine.ts`: `export async function engineTurn(d: EngineDeps): Promise<{ kind: ActionKind; ok: boolean; turnId: string; error?: string } | null>` (null when no agent is active). `startEngine`'s behaviour is unchanged.

- [ ] **Step 1: Write the simulation test**

Create `apps/server/test/agents-simulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { engineTurn } from '../src/agents/engine.ts';
import { agentAffinity, agentState, agentTurns, chainTxs, posts, users, worldCoins } from '../src/db/schema.ts';

/**
 * The whole engine on a memory chain with a seeded rng: 50 agents, one turn per 4 s of injected time (the production
 * tick's average) and the depth sweep every 5 minutes. About 0.1–0.2 s per tick, so it is opt-in:
 *   Git Bash:   cd apps/server && SIM=1 npx vitest run test/agents-simulation.test.ts
 *   PowerShell: cd apps/server; $env:SIM='1'; npx vitest run test/agents-simulation.test.ts
 * SIM_TICKS changes the length (default 3000 ≈ 3.3 simulated hours).
 */
const TICKS = Number(process.env.SIM_TICKS ?? 3000);
const TICK_MS = 4000, SWEEP_EVERY = 75;

describe.runIf(process.env.SIM === '1')('simulation (SIM=1)', () => {
  it(`spreads trades, keeps tickers unique, sours some pairs, varies the lines and names the agents over ${TICKS} ticks`, async () => {
    const ctx = await depthTestCtx(7);
    try {
      for (let i = 1; i <= TICKS; i++) {
        await engineTurn(ctx.d);
        ctx.t.clock.advance(TICK_MS);
        if (i % SWEEP_EVERY === 0) await ctx.depth.sweep(ctx.d);
      }
      const db = ctx.t.db;
      const agentIds = new Set(ctx.agents.map((a) => a.id));

      // 1. Trading is spread across coins, not one coin at a time (finding 1).
      const buys = await db.select({ mint: chainTxs.mint }).from(chainTxs).where(eq(chainTxs.kind, 'buy'));
      const perCoin = new Map<string, number>();
      for (const b of buys) perCoin.set(b.mint!, (perCoin.get(b.mint!) ?? 0) + 1);
      const top = Math.max(0, ...perCoin.values());
      console.log('[sim] buys', buys.length, 'coins bought', perCoin.size, 'top coin share', (top / buys.length).toFixed(2));
      expect(buys.length).toBeGreaterThan(100);
      expect(perCoin.size).toBeGreaterThanOrEqual(5);
      expect(top / buys.length).toBeLessThanOrEqual(0.6);

      // 2. No two coins share a ticker (finding 4).
      const coins = await db.select({ symbol: worldCoins.symbol }).from(worldCoins);
      console.log('[sim] coins', coins.length, coins.map((c) => c.symbol).join(' '));
      expect(new Set(coins.map((c) => c.symbol.toUpperCase())).size).toBe(coins.length);

      // 3. Feelings run both ways: some pairs are warm, some fall below the overview's feud line, a mean of -0.4 (finding 2).
      const pairs = new Map<string, number>();
      for (const r of await db.select().from(agentAffinity)) {
        if (!agentIds.has(r.agentId) || !agentIds.has(r.otherId)) continue;
        const k = [r.agentId, r.otherId].sort().join('|');
        pairs.set(k, (pairs.get(k) ?? 0) + r.score / 2);
      }
      const means = [...pairs.values()];
      console.log('[sim] pairs with feelings', means.length, 'hostile', means.filter((m) => m <= -0.4).length, 'warm', means.filter((m) => m >= 0.3).length);
      expect(means.filter((m) => m <= -0.4).length).toBeGreaterThanOrEqual(1);
      expect(means.filter((m) => m >= 0.3).length).toBeGreaterThanOrEqual(1);

      // 4. Many voices: no shape of text dominates, agents rarely run dry, and callbacks are rare (finding 5).
      const shape = (b: string) => b.toLowerCase().replace(/\$[a-z0-9]+/g, '$x').replace(/@\w+/g, '@u').replace(/[\d.]+/g, 'n');
      const bodies = (await db.select({ body: posts.body }).from(posts).where(inArray(posts.authorId, [...agentIds]))).map((p) => p.body);
      const shapes = new Map<string, number>();
      for (const b of bodies) shapes.set(shape(b), (shapes.get(shape(b)) ?? 0) + 1);
      const topShape = Math.max(0, ...shapes.values());
      const turns = await db.select({ reasoning: agentTurns.reasoning }).from(agentTurns).where(eq(agentTurns.model, 'engine'));
      const dry = turns.filter((t) => t.reasoning.includes('nothing fresh to say')).length;
      const callbacks = turns.filter((t) => t.reasoning.startsWith('remembering:')).length;
      console.log('[sim] texts', bodies.length, 'shapes', shapes.size, 'top shape share', (topShape / bodies.length).toFixed(3), 'dry turns', dry, 'of', turns.length, 'callbacks', callbacks);
      expect(bodies.length).toBeGreaterThan(200);
      expect(topShape / bodies.length).toBeLessThanOrEqual(0.05);
      expect(shapes.size / bodies.length).toBeGreaterThanOrEqual(0.3);
      expect(dry / turns.length).toBeLessThanOrEqual(0.02);
      expect(callbacks).toBeLessThanOrEqual(ctx.agents.length * Math.ceil((TICKS * TICK_MS) / (2 * 3600_000)));

      // 5. Sane numbers: no sale reports a four-digit P&L, and the median mood is not euphoric (finding 3).
      const pnls = turns.flatMap((t) => { const m = /P&L ([+-]\d+)%/.exec(t.reasoning); return m ? [Number(m[1])] : []; });
      const moods = (await db.select({ mood: agentState.mood }).from(agentState)).map((s) => s.mood).sort((a, b) => a - b);
      console.log('[sim] sales', pnls.length, 'max P&L %', Math.max(0, ...pnls), 'median mood', moods[moods.length >> 1]);
      expect(Math.max(0, ...pnls)).toBeLessThan(1000);
      expect(moods[moods.length >> 1]!).toBeLessThanOrEqual(0.5);

      // 6. Agents with a record have named themselves (no model key in this run; L7's local path).
      const named = (await db.select({ n: users.displayName }).from(users).where(eq(users.kind, 'agent'))).filter((u) => u.n).length;
      console.log('[sim] named agents', named);
      expect(named).toBeGreaterThanOrEqual(25);
    } finally {
      await ctx.t.close();
    }
  }, 30 * 60_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (Git Bash): `cd apps/server && SIM=1 npx vitest run test/agents-simulation.test.ts`
Expected: FAIL — `engineTurn` is not exported from `src/agents/engine.ts`. (Run against the code before L1–L8, the assertions fail the way the analysis describes: one coin takes most buys, tickers repeat, no pair reaches −0.4, a few templates dominate, no agent has a name.)

- [ ] **Step 3: Extract `engineTurn`**

`apps/server/src/agents/engine.ts` — line 12 becomes `import type { ActionKind, ImagePolicy, Moments } from './types.ts';`. Add after `pickAgent`:

```ts
/** One engine turn: pick an agent, perceive, decide (with the depth modules), act. The scheduler runs exactly this; so does the simulation test. */
export async function engineTurn(d: EngineDeps): Promise<{ kind: ActionKind; ok: boolean; turnId: string; error?: string } | null> {
  const id = await pickAgent(d);
  if (!id) return null;
  if (d.moments && (await needsPhrasebook(d.db, id, d.now()))) d.moments.enqueue({ kind: 'phrasebook', agentId: id, data: {}, at: d.now() });
  const v = await perceive(d, id);
  const base = candidates(v, d.rng);
  const cs = d.depth ? d.depth.modify(v, [...base, ...d.depth.candidates(v, d.rng).filter((c) => ready(v, c.kind))]) : base;
  const c = choose(cs, d.rng);
  const r = await act(d, v, c);
  return { kind: c.kind, ok: r.ok, turnId: r.turnId, error: r.error };
}
```

and replace the body of `runTick` (lines 43–65) with:

```ts
  async function runTick() {
    if (stopped) return;
    try {
      const r = await engineTurn(d);
      if (!r) return;
      // No turn id means act skipped (previous turn still running) or could not open one: a no-op tick.
      if (r.ok || r.turnId) {
        actions[r.kind] = (actions[r.kind] ?? 0) + 1;
        if (r.error) actions.failed = (actions.failed ?? 0) + 1;
      }
      // Model moments run beside the free engine; a failed drain is logged, never silent.
      void Promise.resolve(d.moments?.drain()).catch((e) => console.error('[agents] moments drain failed', e));
    } catch (e) {
      lastError = (e as Error)?.message ?? String(e);
      console.error('[agents] tick failed', e);
    } finally { ticks++; }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/server && npx vitest run test/agents-engine.test.ts && npm run typecheck`, then (Git Bash) `cd apps/server && SIM=1 npx vitest run test/agents-simulation.test.ts`
Expected: the engine tests PASS unchanged; the simulation PASSES in roughly 6–10 minutes and prints its `[sim]` lines. Paste those lines into the task's review notes: they are the baseline for later tuning. If an assertion fails, the `[sim]` line names the property; the owning task is L2 (spread), L3 (tickers), L4/L5 (pairs), L6 (texts, dry turns, callbacks), L1 (P&L, mood) or L7 (names), and the constants to tune are the ones that task lists as judgement calls.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents/engine.ts apps/server/test/agents-simulation.test.ts
git commit -m "feat(agents): engineTurn runs one engine turn, and an opt-in 3,000-tick simulation checks spread, tickers, feelings, voices and names" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deviations from the analysis

What this plan does differently from `engine-analysis.md`, and why:

- **Said vs did, "only trades after the post count": not adopted for bullish posts.** A shill posted after quietly selling is the lie spec §3b.2 describes ("an agent can shill a coin it is quietly selling"), and `depth-beliefs.test.ts` already pins it. The false flags came from "sold" counting as bearish and from matching a bearish post with the buy that came before it; L1 fixes exactly those two (a bearish post is now flagged only by a later buy).
- **"Pure rule simulation, 20 agents, 2,000 steps: at least one faction": resized.** The planning prototype of these rules found no faction at that size in 3 of 4 seeds; factions need about 6–12 simulated hours of a 50-agent world. L4's test runs 50 agents for 10,800 turns.
- **"Engine simulation, 10 agents, 4 coins, 300 ticks": replaced** by Task S (the full 50-agent engine for 3,000 ticks, opt-in) plus L2's seeded decide tests.
- **Failed buys via `rememberEvent('trade_failed')`: changed.** Events keep only the 50 newest per agent, so failure markers would push out the notable events that memory and callbacks read. L2 reads failed buy turns from `agent_turns` instead.
- **Launch × 0.3 "if the agent's last coin died less than 12 h ago": changed** to "if its last coin is dead": the existing `liveOwn` rule already blocks a second launch for 24 hours, so a 12-hour window could never apply.
- **The `LAUNCH_COST` "mismatch" (27.5M vs 26.5M): kept as a margin.** The extra 1M lamports is deliberate headroom for fees; L1 derives it from the exported rent so the two cannot drift.
- **`beliefs.modify`'s `1 + expect` multiplier: left as is.** After L2 it scales only the one sampled buy candidate (whether to buy), not which coin, so it no longer feeds herding.
- **The feud moment needed more than an enqueue:** the queue has no `feud` handler, so `enqueue` would refuse it; L5 adds the handler (spec §4.5: a model-written jab and answer, once).
- **Callback reuse limits** are stored on the recalled event's own `data` (no new table), and early phrasebook refreshes use the turns' "nothing fresh to say" notes (no new counter).
- Finding 7 (idle turns) and the treasury drip are out of scope, as asked.

# Phase 4: Depth — systems that make stories

> Part of `docs/superpowers/plans/2026-10-11-living-shillex.md`. Read that file first: its Global Constraints, Review Focus and Shared interfaces apply to every task here. Spec: `docs/superpowers/specs/2026-10-11-living-shillex-design.md` §3b (depth) and §3c (privacy).

Every system in this phase is a **depth module**: a small object with optional hooks that the Phase 2 engine calls. Task 4.1 adds the hook registry, wires it into the engine, adds the phase's one migration, and implements the first module (trait drift). Tasks 4.2–4.11 each add one module (or a route set) and register it.

Run server tests from `apps/server`: `npx vitest run <file>`. All tests use `worldTestCtx()` from `test/world-helpers.ts` (a seeded 50-agent world on a `MemoryChain`) or pure functions.

## Changes to shared interfaces (exact; every later task relies on them)

These extend the master plan's Phase 2 types. Phase 2 already provides (do not re-add): `ActionKind` with `lend` and `revive`; `Candidate.raw` and `Candidate.slots` (extra slot values that override the derived ones); `composeLine` returning `{ text, key, template }`; `act` returning `ActResult` with `text` and `line`. Task 4.1 adds only the following.

```ts
// apps/server/src/agents/types.ts — additions (ActionKind and Candidate stay exactly as Phase 2 Task 2.1 wrote them)
export interface DepthView {
  reputation: Record<string, number>;                                                  // userId → -1..1 (4.3)
  beliefs: Record<string, { expect: number; trustCreator: number; stance: number | null; stanceAt: string | null }>; // mint → (4.2)
  faction: { id: string; name: string; conversationId: string | null; coinMint: string | null; memberIds: string[]; rivalMemberIds: string[] } | null; // (4.4)
  leakable: { conversationId: string; targetId: string; lines: { authorId: string; body: string; at: string }[] }[]; // (4.5) all-agent conversations only
  borrowed: { lineageId: string; text: string; situation: Situation; inventorId: string }[];                         // (4.6)
  debts: { owedToMe: { id: string; borrowerId: string; lamports: number; createdAt: string }[]; iOwe: { id: string; lenderId: string; lamports: number; createdAt: string }[] }; // (4.7)
  begging: { userId: string; ghost: boolean }[];                                                                    // (4.7) broke agents I like (affinity ≥ 0.4)
  pastEvents: { kind: string; text: string; otherId: string | null; at: string }[];                                  // (4.9)
  moodBias: number;                                                                                                  // (4.8) weather mood shift, -0.3..0.3, not persisted
}
// AgentView gains one field:
//   depth: DepthView;
```

```ts
// apps/server/src/agents/engine.ts — EngineDeps gains
depth?: DepthRegistry; // from src/agents/depth/registry.ts
```

Cooldowns: `AgentView.state.cooldowns[kind]` is read here as **the ISO time this action last ran** (Phase 2 writes it after each action). Depth modules check `now - last >= minimum` themselves.

Agent events: Phase 2 Task 2.5 records `got_rugged` `{ byId, mint, symbol }`, `rugged` `{ mint, symbol, holders, lamports }`, `big_win` / `big_loss` `{ mint, symbol, pct }`; Phase 3 Task 3.3 records `graduated`. Depth modules read these and never record them again.

## New tables (one migration, `drizzle/0004_agent_depth.sql`, created in Task 4.1)

The master plan's Phase 4 tables, plus three this phase needs (marked *added*):

```ts
agentBeliefs:   { agentId, mint, expect real, trustCreator real, stance real|null, stanceAt ts|null } pk(agentId, mint)
factions:       { id pk, name, banner text, colour text, communityId text|null, conversationId text|null, coinMint text|null, formedAt ts, splitAt ts|null }
factionMembers: { factionId, agentId, joinedAt ts, leftAt ts|null } pk(factionId, agentId)
debts:          { id pk, lenderId, borrowerId, lamports bigint, signature, createdAt ts, repaidAt ts|null, defaultedAt ts|null }
lineage:        { id pk, text, inventorId, kind 'line'|'caption', situation text /* added column */, createdAt ts, uses int, adopters jsonb string[] }
weather:        { id pk, regime, startedAt ts, endsAt ts }
papers:         { day text pk, headline text, body jsonb, memeBlobId text|null, createdAt ts }
traitHistory:   { agentId, day text, traits jsonb Traits, drift jsonb Partial<Record<Trait, number>> } pk(agentId, day)   // added (4.1)
saidVsDid:      { postId pk, agentId, mint, stance real, signature text, side 'buy'|'sell', at ts }                    // added (4.2)
```

## Task list

| Task | Module | Engine hooks |
|---|---|---|
| 4.1 | registry, migration, `drift` | registry wiring; `afterAct`, `onEvent` |
| 4.2 | `beliefs` | `perceive`, `candidates` (lying shill), `modify` (buy/sell × belief), `afterAct` (stance, said-vs-did) |
| 4.3 | `reputation` | `perceive`, `modify` (trust creators), `sweep` (recompute) |
| 4.4 | `factions` | `perceive`, `candidates` (faction chat, faction coin, roast rivals), `afterAct` (faction coin), `sweep` (form/split), moment handler |
| 4.5 | `leaks` | `perceive`, `candidates`, `execute` (`leak`) |
| 4.6 | `lineage` | `perceive` (borrowed lines merged into the phrasebook), `afterAct` (record use), `sweep` (adoption) |
| 4.7 | `life` | `perceive` (broke/ghost/revived), `candidates` (beg, lend, revive, repay), `modify` (ghost limits, broke sells), `execute`, `sweep` (defaults) |
| 4.8 | `weather` | `perceive`, `modify` |
| 4.9 | `memory` (long memory) | `perceive`, `candidates` (callback), `modify` (grudges), `execute` (callback text) |
| 4.10 | `paper` | `sweep` (enqueue), moment handler |
| 4.11 | routes and graph | none (read-only routes) |

---

### Task 4.1: Depth registry, Phase 4 migration, trait drift

**Files:**
- Create: `apps/server/src/agents/depth/registry.ts`
- Create: `apps/server/src/agents/depth/system.ts`
- Create: `apps/server/src/agents/depth/drift.ts`
- Create: `apps/server/src/agents/depth/index.ts`
- Modify: `apps/server/src/agents/types.ts` (`DepthView`, `AgentView.depth`)
- Modify: `apps/server/src/agents/perceive.ts`, `apps/server/src/agents/act.ts`, `apps/server/src/agents/engine.ts` (registry calls)
- Modify: `apps/server/src/world/boot.ts` (`startAgents()` passes `depth: createDepth()` to `startEngine`)
- Modify: `apps/server/src/db/schema.ts` (all Phase 4 tables)
- Create: `apps/server/drizzle/0004_agent_depth.sql` (generated; Phase 2 made 0003, Phase 5 makes 0005) and its `drizzle/meta` snapshot
- Create: `apps/server/test/depth-helpers.ts`
- Test: `apps/server/test/depth-drift.test.ts`, `apps/server/test/depth-registry.test.ts`

**Interfaces:**
- Consumes: `EngineDeps`, `AgentView`, `Candidate`, `act`, `perceive`, `loadState`, `saveState`, `rememberEvent` (Phase 2); `WorldEvent`, `WorldEvents` (`src/world/events.ts`); `runTool`, `ToolContext`, `ToolOutcome` (`src/world/tools.ts`); `startTurn`, `finishTurn` (`src/world/provenance.ts`); `AgentActor` (`src/world/actor.ts`); `holdersOf` (`src/world/market.ts`).
- Produces:
  - `DepthModule`, `DepthRegistry`, `ExecResult`, `RunTool`, `emptyDepth()`, `SWEEP_MS` (registry.ts)
  - `systemAct(d: EngineDeps, agentId: string, tool: string, input: Record<string, unknown>, reason: string): Promise<ToolOutcome>` (system.ts) — runs one tool as the agent in its own sealed receipt (model `'engine'`)
  - `applyDrift(db, agentId, deltas: Partial<Record<Trait, number>>, now): Promise<Traits>`, `DRIFT_CAP_PER_DAY = 0.05`, `driftModule` (drift.ts)
  - `createDepth(): DepthRegistry` (index.ts) — every later task appends its module here
  - `depthTestCtx()` (test/depth-helpers.ts)

- [ ] **Step 1: Add the Phase 4 tables to the schema**

Append to `apps/server/src/db/schema.ts` (after `worldSettings`, before the `export type` lines):

```ts
export const agentBeliefs = pgTable('agent_beliefs', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mint: text('mint').notNull(),
  expect: doublePrecision('expect').notNull().default(0),
  trustCreator: doublePrecision('trust_creator').notNull().default(0.5),
  stance: doublePrecision('stance'),
  stanceAt: ts('stance_at'),
}, (t) => [primaryKey({ columns: [t.agentId, t.mint] })]);

export const factions = pgTable('factions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  banner: text('banner').notNull().default(''),
  colour: text('colour').notNull(),
  communityId: text('community_id'),
  conversationId: text('conversation_id'),
  coinMint: text('coin_mint'),
  formedAt: ts('formed_at').notNull(),
  splitAt: ts('split_at'),
});

export const factionMembers = pgTable('faction_members', {
  factionId: text('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull(),
  leftAt: ts('left_at'),
}, (t) => [primaryKey({ columns: [t.factionId, t.agentId] }), index('faction_members_agent_idx').on(t.agentId)]);

export const debts = pgTable('debts', {
  id: text('id').primaryKey(),
  lenderId: text('lender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  borrowerId: text('borrower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lamports: bigint('lamports', { mode: 'number' }).notNull(),
  signature: text('signature').notNull(),
  createdAt: ts('created_at').notNull(),
  repaidAt: ts('repaid_at'),
  defaultedAt: ts('defaulted_at'),
}, (t) => [index('debts_borrower_idx').on(t.borrowerId), index('debts_lender_idx').on(t.lenderId)]);

export const lineage = pgTable('lineage', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  inventorId: text('inventor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'line' | 'caption'>().notNull(),
  situation: text('situation').notNull(),
  createdAt: ts('created_at').notNull(),
  uses: integer('uses').notNull().default(0),
  adopters: jsonb('adopters').$type<string[]>().notNull().default([]),
});

export const weather = pgTable('weather', {
  id: text('id').primaryKey(),
  regime: text('regime').$type<'euphoria' | 'grind' | 'fear' | 'chaos'>().notNull(),
  startedAt: ts('started_at').notNull(),
  endsAt: ts('ends_at').notNull(),
}, (t) => [index('weather_ends_idx').on(t.endsAt)]);

export const papers = pgTable('papers', {
  day: text('day').primaryKey(),
  headline: text('headline').notNull(),
  body: jsonb('body').$type<{ stories: { title: string; body: string }[]; memeBrief: string | null; source: 'model' | 'local' }>().notNull(),
  memeBlobId: text('meme_blob_id'),
  createdAt: ts('created_at').notNull(),
});

export const traitHistory = pgTable('trait_history', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  traits: jsonb('traits').$type<Record<string, number>>().notNull(),
  drift: jsonb('drift').$type<Record<string, number>>().notNull().default({}),
}, (t) => [primaryKey({ columns: [t.agentId, t.day] })]);

export const saidVsDid = pgTable('said_vs_did', {
  postId: text('post_id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mint: text('mint').notNull(),
  stance: doublePrecision('stance').notNull(),
  signature: text('signature').notNull(),
  side: text('side').$type<'buy' | 'sell'>().notNull(),
  at: ts('at').notNull(),
}, (t) => [index('said_vs_did_agent_idx').on(t.agentId)]);
```

- [ ] **Step 2: Generate the migration**

Run (from `apps/server`): `npx drizzle-kit generate --name agent_depth`
Expected: a new file `drizzle/0004_agent_depth.sql` (0003 is Phase 2's `agent_engine`; Phase 3 adds no tables) creating the nine tables above, and an updated `drizzle/meta/_journal.json`. Open the SQL and check it contains only `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD CONSTRAINT` statements for these tables.

- [ ] **Step 3: Write the registry**

`apps/server/src/agents/depth/registry.ts`:

```ts
import type { ToolOutcome } from '../../world/tools.ts';
import type { WorldEvent } from '../../world/events.ts';
import type { AgentView, Candidate, DepthView, Situation } from '../types.ts';
import type { EngineDeps } from '../engine.ts';

export const SWEEP_MS = 5 * 60_000;

/** What an execute hook reports; act() adds the turn id and seals the receipt. */
export interface ExecResult { ok: boolean; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }
export type ActDone = ExecResult & { turnId: string };
/** Runs one tool inside the current action's receipt. */
export type RunTool = (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;

export interface DepthModule {
  name: string;
  perceive?(d: EngineDeps, v: AgentView): Promise<void>;
  candidates?(v: AgentView, rng: () => number): Candidate[];
  modify?(v: AgentView, cs: Candidate[]): Candidate[];
  /** Return null when this module does not handle the candidate's kind. */
  execute?(d: EngineDeps, v: AgentView, c: Candidate, tool: RunTool): Promise<ExecResult | null>;
  afterAct?(d: EngineDeps, v: AgentView, c: Candidate, r: ActDone): Promise<void>;
  onEvent?(d: EngineDeps, e: WorldEvent): Promise<void>;
  sweep?(d: EngineDeps): Promise<void>;
}

export function emptyDepth(): DepthView {
  return { reputation: {}, beliefs: {}, faction: null, leakable: [], borrowed: [], debts: { owedToMe: [], iOwe: [] }, begging: [], pastEvents: [], moodBias: 0 };
}

/** Calls every module in order. A failing module is logged and skipped: depth never stops the engine. */
export class DepthRegistry {
  constructor(readonly modules: DepthModule[]) {}
  private warn(m: DepthModule, hook: string, e: unknown) { console.error(`[depth] ${m.name}.${hook} failed`, e); }

  async perceive(d: EngineDeps, v: AgentView) {
    for (const m of this.modules) if (m.perceive) { try { await m.perceive(d, v); } catch (e) { this.warn(m, 'perceive', e); } }
  }
  candidates(v: AgentView, rng: () => number): Candidate[] {
    const out: Candidate[] = [];
    for (const m of this.modules) if (m.candidates) { try { out.push(...m.candidates(v, rng)); } catch (e) { this.warn(m, 'candidates', e); } }
    return out;
  }
  modify(v: AgentView, cs: Candidate[]): Candidate[] {
    let cur = cs;
    for (const m of this.modules) if (m.modify) { try { cur = m.modify(v, cur); } catch (e) { this.warn(m, 'modify', e); } }
    return cur.map((c) => ({ ...c, score: Number.isFinite(c.score) ? Math.max(0, c.score) : 0 }));
  }
  async execute(d: EngineDeps, v: AgentView, c: Candidate, tool: RunTool): Promise<ExecResult | null> {
    for (const m of this.modules) if (m.execute) {
      try { const r = await m.execute(d, v, c, tool); if (r) return r; }
      catch (e) { this.warn(m, 'execute', e); return { ok: false, error: (e as Error).message ?? String(e) }; }
    }
    return null;
  }
  async afterAct(d: EngineDeps, v: AgentView, c: Candidate, r: ActDone) {
    for (const m of this.modules) if (m.afterAct) { try { await m.afterAct(d, v, c, r); } catch (e) { this.warn(m, 'afterAct', e); } }
  }
  async onEvent(d: EngineDeps, e: WorldEvent) {
    for (const m of this.modules) if (m.onEvent) { try { await m.onEvent(d, e); } catch (err) { this.warn(m, 'onEvent', err); } }
  }
  async sweep(d: EngineDeps) {
    for (const m of this.modules) if (m.sweep) { try { await m.sweep(d); } catch (e) { this.warn(m, 'sweep', e); } }
  }
}
```

- [ ] **Step 4: Write `systemAct`**

`apps/server/src/agents/depth/system.ts`:

```ts
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
import { AgentActor } from '../../world/actor.ts';
import { finishTurn, startTurn } from '../../world/provenance.ts';
import { runTool, type ToolOutcome } from '../../world/tools.ts';
import type { EngineDeps } from '../engine.ts';

const actors = new WeakMap<object, AgentActor>();

/** Runs one tool as an agent outside a chosen action (faction chats, splits), in its own sealed receipt. */
export async function systemAct(d: EngineDeps, agentId: string, tool: string, input: Record<string, unknown>, reason: string): Promise<ToolOutcome> {
  const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!agent) return { ok: false, write: false, result: { code: 'NO_AGENT', error: `No agent ${agentId}` } };
  let actor = actors.get(d.app);
  if (!actor) { actor = new AgentActor(d.app); actors.set(d.app, actor); }
  const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: reason }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: d.now() });
  const out = await runTool({ app: d.app, db: d.db, actor, chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl }, tool, input);
  await finishTurn(d.db, turnId, {
    status: out.ok ? (out.write ? 'acted' : 'quiet') : 'failed', context: [], reasoning: reason,
    toolCalls: [{ name: tool, input, ok: out.ok, result: out.result, signatures: out.signatures }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
  });
  return out;
}
```

- [ ] **Step 5: Write the failing drift tests**

`apps/server/test/depth-helpers.ts`:

```ts
import { worldTestCtx } from './world-helpers.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import { createDepth } from '../src/agents/depth/index.ts';

/** A seeded 50-agent world plus EngineDeps with the full depth registry. */
export async function depthTestCtx(seed = 7) {
  const w = await worldTestCtx();
  const depth = createDepth();
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(seed), depth };
  return { ...w, d, depth };
}
```

`apps/server/test/depth-drift.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { applyDrift, DRIFT_CAP_PER_DAY, driftForEvent } from '../src/agents/depth/drift.ts';
import { loadState } from '../src/agents/state.ts';
import { traitHistory } from '../src/db/schema.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('trait drift', () => {
  it('moves a trait, records today in trait history, and caps the day at ±0.05 per trait', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const before = (await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.risk;
    for (let i = 0; i < 10; i++) await applyDrift(ctx.t.db, a.id, { risk: -0.02 }, ctx.t.clock.now());
    const after = (await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.risk;
    expect(before - after).toBeCloseTo(Math.min(before, DRIFT_CAP_PER_DAY), 6);
    const [h] = await ctx.t.db.select().from(traitHistory).where(and(eq(traitHistory.agentId, a.id), eq(traitHistory.day, '2026-10-09')));
    expect(h!.drift.risk).toBeCloseTo(-Math.min(before, DRIFT_CAP_PER_DAY), 6);
    expect(h!.traits.risk).toBeCloseTo(after, 6);
  });
  it('starts a fresh allowance on the next UTC day and never leaves 0..1', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[1]!;
    for (let day = 0; day < 40; day++) {
      await applyDrift(ctx.t.db, a.id, { greed: 0.05 }, ctx.t.clock.now());
      ctx.t.clock.advance(24 * 3600_000);
    }
    expect((await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.greed).toBe(1);
  });
  it('maps experiences to bounded nudges', () => {
    expect(driftForEvent('got_rugged')).toEqual({ pettiness: 0.03, loyalty: -0.01 });
    expect(driftForEvent('big_loss')).toEqual({ risk: -0.02 });
    expect(driftForEvent('big_win')).toEqual({ greed: 0.02, risk: 0.01 });
    expect(driftForEvent('welcomed')).toEqual({ loyalty: 0.005 });
    expect(driftForEvent('roasted')).toEqual({ pettiness: 0.01 });
    expect(driftForEvent('nothing')).toEqual({});
  });
});
```

`apps/server/test/depth-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DepthRegistry, emptyDepth } from '../src/agents/depth/registry.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

const view = { depth: emptyDepth() } as unknown as AgentView;
const c = (kind: Candidate['kind'], score: number): Candidate => ({ kind, score, reason: 'test' });

describe('depth registry', () => {
  it('keeps going when a module throws, and clamps scores to finite non-negative numbers', () => {
    const reg = new DepthRegistry([
      { name: 'boom', candidates: () => { throw new Error('boom'); }, modify: () => { throw new Error('boom'); } },
      { name: 'ok', candidates: () => [c('post', 0.5)], modify: (_v, cs) => cs.map((x) => ({ ...x, score: x.kind === 'post' ? -1 : Number.NaN })) },
    ]);
    const cs = reg.candidates(view, () => 0.5);
    expect(cs).toEqual([c('post', 0.5)]);
    expect(reg.modify(view, [...cs, c('buy', 1)]).map((x) => x.score)).toEqual([0, 0]);
  });
  it('returns the first non-null execute result', async () => {
    const reg = new DepthRegistry([
      { name: 'skip', execute: async () => null },
      { name: 'leak', execute: async (_d, _v, cand) => (cand.kind === 'leak' ? { ok: true, text: 'leaked' } : null) },
    ]);
    expect(await reg.execute({} as never, view, c('leak', 1), async () => ({ ok: true, write: true, result: null }))).toEqual({ ok: true, text: 'leaked' });
    expect(await reg.execute({} as never, view, c('post', 1), async () => ({ ok: true, write: true, result: null }))).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run test/depth-drift.test.ts test/depth-registry.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/depth/drift.ts'` (the registry test may already pass once Step 3 exists; the drift test must fail).

- [ ] **Step 7: Implement drift**

`apps/server/src/agents/depth/drift.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { traitHistory } from '../../db/schema.ts';
import { holdersOf } from '../../world/market.ts';
import { loadState, saveState } from '../state.ts';
import type { Trait, Traits } from '../types.ts';
import type { DepthModule } from './registry.ts';

export const DRIFT_CAP_PER_DAY = 0.05;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const DRIFT: Record<string, Partial<Record<Trait, number>>> = {
  got_rugged: { pettiness: 0.03, loyalty: -0.01 },
  big_loss: { risk: -0.02 },
  big_win: { greed: 0.02, risk: 0.01 },
  welcomed: { loyalty: 0.005 },
  roasted: { pettiness: 0.01 },
  was_leaked: { pettiness: 0.02 },
  revived: { loyalty: 0.03 },
};
export const driftForEvent = (kind: string): Partial<Record<Trait, number>> => ({ ...(DRIFT[kind] ?? {}) });

/** Nudges traits; each trait moves at most DRIFT_CAP_PER_DAY in total per UTC day and stays in 0..1. */
export async function applyDrift(db: Db, agentId: string, deltas: Partial<Record<Trait, number>>, now: Date): Promise<Traits> {
  const day = utcDay(now);
  const state = await loadState(db, agentId, now);
  const [row] = await db.select().from(traitHistory).where(and(eq(traitHistory.agentId, agentId), eq(traitHistory.day, day)));
  const used: Record<string, number> = { ...(row?.drift ?? {}) };
  const traits = { ...state.traits };
  for (const [t, want] of Object.entries(deltas) as [Trait, number][]) {
    const u = used[t] ?? 0;
    const allowed = want > 0 ? Math.min(want, DRIFT_CAP_PER_DAY - u) : Math.max(want, -DRIFT_CAP_PER_DAY - u);
    if ((want > 0 && allowed <= 0) || (want < 0 && allowed >= 0)) continue;
    const next = clamp01(traits[t] + allowed);
    used[t] = u + (next - traits[t]);
    traits[t] = next;
  }
  await saveState(db, agentId, { ...state, traits }, now);
  await db.insert(traitHistory).values({ agentId, day, traits, drift: used })
    .onConflictDoUpdate({ target: [traitHistory.agentId, traitHistory.day], set: { traits, drift: used } });
  return traits;
}

/** Experiences reshape personalities: losses make agents careful, rugs make them petty, wins make them greedy. */
export const driftModule: DepthModule = {
  name: 'drift',
  async afterAct(d, v, c, r) {
    if (!r.ok) return;
    if (c.kind === 'sell' && c.target?.mint) {
      const pos = v.wallet.positions.find((p) => p.mint === c.target!.mint);
      if (pos && pos.costLamports > 0) {
        // Same thresholds as the big_win / big_loss events Phase 2's act() records; this module only moves traits.
        const pnl = (pos.valueLamports - pos.costLamports) / pos.costLamports;
        if (pnl < -0.5) await applyDrift(d.db, v.agent.id, driftForEvent('big_loss'), d.now());
        if (pnl > 1) await applyDrift(d.db, v.agent.id, driftForEvent('big_win'), d.now());
      }
    }
    if (c.kind === 'rug' && c.target?.mint) {
      // act() already recorded `rugged` for the rugger and `got_rugged` for each holder.
      for (const holder of (await holdersOf(d.db, c.target.mint)).keys()) {
        if (holder === v.agent.id) continue;
        await applyDrift(d.db, holder, driftForEvent('got_rugged'), d.now());
      }
    }
    if ((c.kind === 'reply' || c.kind === 'react') && c.target?.userId && (v.affinity[c.target.userId] ?? 0) > 0.3) {
      await applyDrift(d.db, c.target.userId, driftForEvent('welcomed'), d.now());
    }
    if (c.situation === 'roast' && c.target?.userId) await applyDrift(d.db, c.target.userId, driftForEvent('roasted'), d.now());
  },
};
```

Note: Phase 2 already moves affinity for rugs, sells and replies and records the `got_rugged`, `rugged`, `big_win` and `big_loss` events that long memory (4.9) and the paper (4.10) read; this module changes only traits.

- [ ] **Step 8: Create the module list**

`apps/server/src/agents/depth/index.ts`:

```ts
import { DepthRegistry } from './registry.ts';
import { driftModule } from './drift.ts';

/** Every depth module, in the order hooks run. Later tasks append theirs here. */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule]);
}
```

- [ ] **Step 9: Make the type changes and wire the registry into the engine**

1. In `apps/server/src/agents/types.ts`: add `DepthView` (from "Changes to shared interfaces" above) and add `depth: DepthView;` to `AgentView`. `ActionKind`, `Candidate` and `composeLine` already have what Phase 4 needs (Phase 2 Tasks 2.1–2.2).
2. In `apps/server/src/agents/perceive.ts` (import `emptyDepth` from `./depth/registry.ts`): replace the final `return { agent: …, weather: 'grind', now: now.toISOString() };` of `perceive` (as Phase 3 Task 3.4 left it, with the `queuedRefs` filters on `mentions` and `dms`) with the same object assigned to `const v: AgentView = { …, depth: emptyDepth() };`, followed by:

```ts
  await d.depth?.perceive(d, v);
  return v;
```
Any place that builds an `AgentView` literal in tests (`test/agents-decide.test.ts`'s `view()`) must add `depth: emptyDepth()`.

3. In `apps/server/src/agents/engine.ts` (import `SWEEP_MS` from `./depth/registry.ts`), in `tick()` replace Phase 2's line `const c = choose(candidates(v, d.rng), d.rng);` with:

```ts
      const base = candidates(v, d.rng);
      const cs = d.depth ? d.depth.modify(v, [...base, ...d.depth.candidates(v, d.rng)]) : base;
      const c = choose(cs, d.rng);
```
and add `depth?: DepthRegistry` to `EngineDeps` (import the type from `./depth/registry.ts`). In `startEngine`, right after `if (d.autoStart !== false) schedule();`:

```ts
  const offDepth = d.events.on((e) => { void d.depth?.onEvent(d, e); });
  const sweepTimer = d.depth ? setInterval(() => { void d.depth!.sweep(d); }, SWEEP_MS) : null;
  sweepTimer?.unref?.();
```
and make `stop()` `async stop() { stopped = true; if (timer) clearTimeout(timer); offDepth(); if (sweepTimer) clearInterval(sweepTimer); await current; }`.

4. In `apps/server/src/agents/act.ts` (import `type RunTool` from `./depth/registry.ts`), inside the `try`, replace Phase 2's line `switch (c.kind) {` (right after `const chatty = …`) with:

```ts
    const tool: RunTool = async (name, input) => {
      const out = await runTool(ctx, name, input);
      toolCalls.push({ name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
      if (out.ok && out.write) status = 'acted';
      return out;
    };
    const custom = await d.depth?.execute(d, v, c, tool);
    if (custom) {
      status = custom.ok ? 'acted' : 'failed';
      if (!custom.ok) note = `failed: ${custom.error ?? 'depth action failed'}`;
      postId = custom.postId;
      if (custom.text && custom.line) used.first = { text: custom.text, line: custom.line };
    } else switch (c.kind) {
```
(the switch body and its closing brace are unchanged). Then replace Phase 2's final `return { ok: status === 'acted', turnId, postId, … };` with:

```ts
  const done: ActResult = { ok: status === 'acted', turnId, postId, error: status === 'failed' ? note : undefined, ...(used.first && !privateCall ? { text: used.first.text, line: used.first.line } : {}) };
  await d.depth?.afterAct(d, v, c, done);
  return done;
```
The receipt is already sealed by Phase 2's `finishTurn(…)` call above it (reasoning `c.reason` plus the note).

5. In `apps/server/src/world/boot.ts` (import `createDepth` from `../agents/depth/index.ts`), in `startAgents()` (as Phase 3 Task 3.3 wrote it), change the `startEngine` call to:

```ts
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng, moments: handles.moments ?? undefined, depth: createDepth(), tickMs: config.engineTickMs });
```

- [ ] **Step 10: Run the tests**

Run: `npx vitest run test/depth-drift.test.ts test/depth-registry.test.ts`
Expected: PASS (5 tests).
Run: `npx vitest run test/agents-*.test.ts` (the Phase 2 engine tests) and `npx tsc --noEmit -p .`
Expected: all PASS, no type errors (fix any `AgentView` literals missing `depth`).

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/agents apps/server/src/world/boot.ts apps/server/src/db/schema.ts apps/server/drizzle apps/server/test/depth-helpers.ts apps/server/test/depth-drift.test.ts apps/server/test/depth-registry.test.ts apps/server/test/agents-decide.test.ts
git commit -m "feat(agents): depth registry, Phase 4 tables, and personalities that drift with experience

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.2: Beliefs, stances and "said vs did"

**Files:**
- Create: `apps/server/src/agents/depth/beliefs.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Modify: `packages/shared/src/types.ts` (`PostView.saidVsDid`), `apps/server/src/services/hydrate.ts` (fill it)
- Test: `apps/server/test/depth-beliefs.test.ts`

**Interfaces:**
- Consumes: `DepthModule`, `adjustAffinity`, `rememberEvent`, `holdersOf`, tables `agentBeliefs`, `saidVsDid`, `chainTxs`, `posts`, `worldCoins`.
- Produces:
  - `stanceOf(text: string, symbol: string): number | null` — -1..1, null when `$SYMBOL` is not mentioned
  - `expectFor(change1h: number, trustCreator: number): number` — -1..1
  - `checkSaidVsDid(db, agentId, mint, at: Date): Promise<{ postId: string; stance: number; signature: string; side: 'buy' | 'sell' } | null>`
  - `beliefsModule`
  - `PostView.saidVsDid?: { mint: string; symbol: string; side: 'buy' | 'sell'; signature: string }` (shared type)

Engine hooks: `perceive` fills `v.depth.beliefs` for every coin in `v.coins`; `candidates` adds the lying shill (`post`, situation `shilling`, on a coin the agent holds but expects to fall); `modify` multiplies buy scores by `1 + expect` and sell scores by `1 - expect`; `afterAct` records stances from posts, writes said-vs-did rows (in both orders: post then trade, trade then post), and makes holders who see the hypocrisy lose affinity.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-beliefs.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { stanceOf, expectFor, checkSaidVsDid, beliefsModule } from '../src/agents/depth/beliefs.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity, saidVsDid, worldCoins } from '../src/db/schema.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('stances', () => {
  it('reads a stance only when the ticker is mentioned', () => {
    expect(stanceOf('$MOTH to the moon, holding forever 🚀', 'MOTH')).toBeGreaterThan(0.5);
    expect(stanceOf('$moth is a rug, selling everything', 'MOTH')).toBeLessThan(-0.5);
    expect(stanceOf('the moon is nice tonight', 'MOTH')).toBeNull();
    expect(stanceOf('$MOTHER is great', 'MOTH')).toBeNull();
    expect(stanceOf('$MOTH', 'MOTH')).toBe(0);
  });
  it('expects a coin to rise with momentum and trust, bounded to -1..1', () => {
    expect(expectFor(0.5, 0.9)).toBeGreaterThan(0.5);
    expect(expectFor(-0.5, 0.1)).toBeLessThan(-0.5);
    expect(Math.abs(expectFor(100, 1))).toBeLessThanOrEqual(1);
  });
});

describe('said vs did', () => {
  async function launchAndBuy() {
    const [creator, liar, holder] = [ctx.agents[0]!, ctx.agents[1]!, ctx.agents[2]!];
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'lamps', emoji: '🦋', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.02, slippage_pct: null });
    await runTool(await ctx.ctxFor(holder), 'buy', { mint, sol: 0.01, slippage_pct: null });
    return { creator, liar, holder, mint };
  }
  it('flags a bullish post made within 60 minutes after selling the same coin, and holders trust the liar less', async () => {
    ctx = await depthTestCtx();
    const { liar, holder, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    ctx.t.clock.advance(20 * 60_000);
    const posted = await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is going to the moon, holding forever 🚀' });
    const postId = (posted.result as { post_id: string }).post_id;
    const v = { agent: { id: liar.id, username: liar.username, displayName: liar.displayName }, coins: [{ mint, symbol: 'MOTH', creatorId: ctx.agents[0]!.id }], affinity: {}, depth: emptyDepth() } as unknown as AgentView;
    const c: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'shilling', target: { mint } };
    await beliefsModule.afterAct!(ctx.d, v, c, { ok: true, turnId: 't', postId, text: '$MOTH is going to the moon, holding forever 🚀' });
    const [row] = await ctx.t.db.select().from(saidVsDid).where(eq(saidVsDid.postId, postId));
    expect(row).toMatchObject({ agentId: liar.id, mint, side: 'sell' });
    const [aff] = await ctx.t.db.select().from(agentAffinity).where(eq(agentAffinity.agentId, holder.id));
    expect(aff).toMatchObject({ otherId: liar.id });
    expect(aff!.score).toBeLessThan(0);
  });
  it('does not flag a post made more than 60 minutes after the sale, or a bearish post after a sale', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    ctx.t.clock.advance(61 * 60_000);
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
    ctx.t.clock.advance(-50 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, sold it all' });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
  });
  it('flags the trade when the bullish post came first', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'post', { body: 'loading more $MOTH, diamond hands 💎' });
    ctx.t.clock.advance(10 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const hit = await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now());
    expect(hit).toMatchObject({ side: 'sell' });
    expect(hit!.stance).toBeGreaterThan(0.3);
  });
});

describe('belief-weighted decisions', () => {
  it('scales buys up and sells down when the agent expects a rise', () => {
    const v = { depth: { ...emptyDepth(), beliefs: { M: { expect: 0.5, trustCreator: 0.8, stance: null, stanceAt: null } } } } as unknown as AgentView;
    const out = beliefsModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'M' } },
      { kind: 'sell', score: 1, reason: 'r', target: { mint: 'M' } },
      { kind: 'post', score: 1, reason: 'r' },
    ]);
    expect(out.map((c) => c.score)).toEqual([1.5, 0.5, 1]);
  });
});
```

Also add one assertion to the said-vs-did test above, after the row is checked:

```ts
    const feed = await ctx.t.app.inject({ method: 'GET', url: `/api/posts/${postId}` });
    expect(feed.json().post.saidVsDid).toMatchObject({ mint, symbol: 'MOTH', side: 'sell' });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-beliefs.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/depth/beliefs.ts'`.

- [ ] **Step 3: Implement the module**

`apps/server/src/agents/depth/beliefs.ts`:

```ts
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentBeliefs, chainTxs, posts, saidVsDid } from '../../db/schema.ts';
import { holdersOf } from '../../world/market.ts';
import { adjustAffinity, rememberEvent } from '../state.ts';
import type { Candidate } from '../types.ts';
import type { DepthModule } from './registry.ts';

const WINDOW_MS = 60 * 60_000;
const BULL = ['moon', 'send', 'buy', 'buying', 'bullish', 'hold', 'holding', 'diamond', 'pump', 'ape', 'aping', 'lfg', 'gem', 'loading', 'up only', '🚀', '💎', '📈'];
const BEAR = ['dump', 'dumping', 'rug', 'rugged', 'sell', 'selling', 'sold', 'dead', 'bearish', 'exit', 'scam', 'rekt', 'over', '📉', '💀'];
const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** -1..1 from bullish vs bearish words, or null if `$SYMBOL` (exact ticker) is not in the text. */
export function stanceOf(text: string, symbol: string): number | null {
  if (!new RegExp(`\\$${escape(symbol)}(?![A-Za-z0-9])`, 'i').test(text)) return null;
  const t = text.toLowerCase();
  const count = (words: string[]) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const b = count(BULL), s = count(BEAR);
  return b + s === 0 ? 0 : (b - s) / (b + s);
}

/** What the agent privately expects: momentum over the last hour plus trust in the creator. */
export function expectFor(change1h: number, trustCreator: number): number {
  return clamp(0.6 * Math.tanh(3 * change1h) + 0.4 * (2 * trustCreator - 1));
}

/** A same-hour contradiction between what an agent said about a coin and what it traded, or null. */
export async function checkSaidVsDid(db: Db, agentId: string, mint: string, at: Date) {
  const from = new Date(at.getTime() - WINDOW_MS), to = new Date(at.getTime() + WINDOW_MS);
  const trades = await db.select().from(chainTxs).where(and(eq(chainTxs.agentId, agentId), eq(chainTxs.mint, mint), inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, from), lte(chainTxs.createdAt, to))).orderBy(desc(chainTxs.createdAt));
  if (!trades.length) return null;
  const said = await db.select({ id: posts.id, body: posts.body, at: posts.createdAt }).from(posts).where(and(eq(posts.authorId, agentId), gte(posts.createdAt, from), lte(posts.createdAt, to))).orderBy(desc(posts.createdAt)).limit(20);
  const { worldCoins } = await import('../../db/schema.ts');
  const [coin] = await db.select({ symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, mint));
  if (!coin) return null;
  for (const p of said) {
    const stance = stanceOf(p.body, coin.symbol);
    if (stance === null || Math.abs(stance) <= 0.3) continue;
    const near = trades.find((t) => Math.abs(t.createdAt.getTime() - p.at.getTime()) <= WINDOW_MS && (stance > 0 ? t.kind === 'sell' : t.kind === 'buy'));
    if (near) return { postId: p.id, stance, signature: near.signature, side: near.kind as 'buy' | 'sell' };
  }
  return null;
}

async function recordHypocrisy(d: Parameters<NonNullable<DepthModule['afterAct']>>[0], agentId: string, mint: string, symbol: string) {
  const hit = await checkSaidVsDid(d.db, agentId, mint, d.now());
  if (!hit) return;
  const inserted = await d.db.insert(saidVsDid).values({ postId: hit.postId, agentId, mint, stance: hit.stance, signature: hit.signature, side: hit.side, at: d.now() }).onConflictDoNothing().returning();
  if (!inserted.length) return;
  for (const holder of (await holdersOf(d.db, mint)).keys()) {
    if (holder === agentId) continue;
    await adjustAffinity(d.db, holder, agentId, -0.15, d.now());
    await rememberEvent(d.db, holder, 'saw_hypocrisy', { agentId, mint, symbol }, d.now());
  }
  await rememberEvent(d.db, agentId, 'caught_lying', { mint, symbol }, d.now());
}

export const beliefsModule: DepthModule = {
  name: 'beliefs',
  async perceive(d, v) {
    const rows = await d.db.select().from(agentBeliefs).where(eq(agentBeliefs.agentId, v.agent.id));
    const stored = new Map(rows.map((r) => [r.mint, r]));
    for (const coin of v.coins) {
      const r = stored.get(coin.mint);
      const rep = v.depth.reputation[coin.creatorId] ?? 0;
      const trustCreator = r?.trustCreator ?? Math.min(1, Math.max(0, 0.5 + 0.5 * rep));
      v.depth.beliefs[coin.mint] = { expect: expectFor(coin.change1h, trustCreator), trustCreator, stance: r?.stance ?? null, stanceAt: r?.stanceAt?.toISOString() ?? null };
    }
  },
  candidates(v) {
    const out: Candidate[] = [];
    const greed = v.state.traits.greed;
    if (greed <= 0.5) return out;
    for (const p of v.wallet.positions) {
      const expect = v.depth.beliefs[p.mint]?.expect ?? 0;
      if (expect >= -0.2 || p.valueLamports <= 0) continue;
      out.push({ kind: 'post', situation: 'shilling', target: { mint: p.mint }, score: 0.4 * greed * -expect,
        reason: `shilling $${p.symbol} while privately expecting it to fall (greed ${greed.toFixed(2)}, expects ${expect.toFixed(2)})` });
    }
    return out;
  },
  modify(v, cs) {
    return cs.map((c) => {
      const b = c.target?.mint ? v.depth.beliefs[c.target.mint] : undefined;
      if (!b) return c;
      if (c.kind === 'buy') return { ...c, score: c.score * (1 + b.expect) };
      if (c.kind === 'sell') return { ...c, score: c.score * (1 - b.expect) };
      return c;
    });
  },
  async afterAct(d, v, c, r) {
    if (!r.ok) return;
    if (r.text && (c.kind === 'post' || c.kind === 'reply' || c.kind === 'chat')) {
      for (const coin of v.coins) {
        const stance = stanceOf(r.text, coin.symbol);
        if (stance === null) continue;
        const base = v.depth.beliefs[coin.mint] ?? { expect: 0, trustCreator: 0.5 };
        await d.db.insert(agentBeliefs).values({ agentId: v.agent.id, mint: coin.mint, expect: base.expect, trustCreator: base.trustCreator, stance, stanceAt: d.now() })
          .onConflictDoUpdate({ target: [agentBeliefs.agentId, agentBeliefs.mint], set: { stance, stanceAt: d.now() } });
        if (c.kind !== 'chat') await recordHypocrisy(d, v.agent.id, coin.mint, coin.symbol);
      }
    }
    if ((c.kind === 'buy' || c.kind === 'sell' || c.kind === 'rug') && c.target?.mint) {
      const sym = v.coins.find((x) => x.mint === c.target!.mint)?.symbol ?? '?';
      await recordHypocrisy(d, v.agent.id, c.target.mint, sym);
    }
    if (c.kind === 'rug' && c.target?.mint) {
      // Everyone holding a rugged coin stops trusting that creator's other coins.
      const creator = v.agent.id;
      const theirs = v.coins.filter((x) => x.creatorId === creator).map((x) => x.mint);
      for (const holder of (await holdersOf(d.db, c.target.mint)).keys()) {
        if (holder === creator) continue;
        for (const mint of theirs) {
          await d.db.insert(agentBeliefs).values({ agentId: holder, mint, expect: -0.5, trustCreator: 0 })
            .onConflictDoUpdate({ target: [agentBeliefs.agentId, agentBeliefs.mint], set: { trustCreator: 0 } });
        }
      }
    }
  },
};
```

Replace the dynamic `import('../../db/schema.ts')` inside `checkSaidVsDid` with a static `worldCoins` import at the top (it is shown inline only so the function reads on its own).

- [ ] **Step 4: Register it and expose the badge on posts**

In `apps/server/src/agents/depth/index.ts`: import `beliefsModule` and use `new DepthRegistry([driftModule, beliefsModule])`.

In `packages/shared/src/types.ts`, add to `PostView`:

```ts
  /** Set when the author traded against what this post said within the same hour (agents only). */
  saidVsDid?: { mint: string; symbol: string; side: 'buy' | 'sell'; signature: string };
```

In `apps/server/src/services/hydrate.ts`, where post views are assembled (the function that maps `PostRow[]` to `PostView[]`), load the flags for the batch once and spread them in only when present:

```ts
  const flags = ids.length ? await db.select({ postId: saidVsDid.postId, mint: saidVsDid.mint, side: saidVsDid.side, signature: saidVsDid.signature, symbol: worldCoins.symbol })
    .from(saidVsDid).innerJoin(worldCoins, eq(worldCoins.mint, saidVsDid.mint)).where(inArray(saidVsDid.postId, ids)) : [];
  const flagBy = new Map(flags.map((f) => [f.postId, { mint: f.mint, symbol: f.symbol, side: f.side, signature: f.signature }]));
  // …in the per-post mapping:
  ...(flagBy.has(p.id) ? { saidVsDid: flagBy.get(p.id)! } : {}),
```
(`ids` is the array of post ids in the batch; import `saidVsDid`, `worldCoins` from the schema and `inArray`, `eq` from drizzle-orm if not already imported.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-beliefs.test.ts`
Expected: PASS (6 tests).
Run: `npx vitest run test/posts.test.ts test/feed.test.ts` (existing post and feed suites) and `npx tsc --noEmit -p .`
Expected: PASS; posts without a flag have no `saidVsDid` key, so existing `toEqual` assertions still hold.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth packages/shared/src/types.ts apps/server/src/services/hydrate.ts apps/server/test/depth-beliefs.test.ts
git commit -m "feat(agents): private beliefs, public stances, and a said-vs-did badge when an agent trades against its own posts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.3: Reputation

**Files:**
- Create: `apps/server/src/agents/depth/reputation.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Test: `apps/server/test/depth-reputation.test.ts`

**Interfaces:**
- Consumes: tables `chainTxs`, `worldCoins`, `saidVsDid`, `debts`, `posts`, `users`; `stanceOf` (4.2).
- Produces:
  - `interface RepFacts { rugs: number; honestCalls: number; wrongCalls: number; hypocrisy: number; repaid: number; defaulted: number; lent: number }`
  - `reputationScore(f: RepFacts): number` — -1..1
  - `repFacts(db, userId, now): Promise<RepFacts>`
  - `class ReputationCache { get(userId): number; all(): Record<string, number>; refresh(db, now): Promise<void> }` and the singleton `reputation` exported for routes
  - `reputationModule`

Engine hooks: `perceive` copies the cache into `v.depth.reputation` (runs before `beliefs`, so register it first); `modify` scales buys of a coin by `1 + 0.5 × rep(creator)` and follows of a user by `1 + rep(user)`; `sweep` refreshes the cache every 5 minutes. Reputation is computed from what agents did (on-chain rugs, honest and wrong calls, lies, debts), never from what they said about themselves.

Definitions (exact):
- **rug**: a coin this user created where the creator's total sold tokens ≥ 70% of its total bought tokens (`chainTxs` with `kind` in `launch`/`buy` vs `sell`, `agentId = creator`, `mint` = coin).
- **call**: a post by the user in the last 7 days whose `stanceOf` for a known coin has |stance| > 0.3. **Honest** when the coin's price 6 h later moved ≥ 10% in the stance's direction; **wrong** when it moved ≥ 10% against. Price at time t = the last `buy`/`sell` trade on that mint at or before t, as `|lamportsDelta| / (|tokenDelta| / 1e6)` lamports per token. Calls younger than 6 h are skipped. At most 50 calls per user.
- **hypocrisy**: rows in `said_vs_did` for the user. **repaid**/**defaulted**: debts where the user is the borrower with `repaidAt`/`defaultedAt` set. **lent**: debts where the user is the lender.
- Score: `tanh(0.25·honest − 0.15·wrong − 0.6·rugs − 0.3·hypocrisy + 0.3·repaid − 0.6·defaulted + 0.1·lent)`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/depth-reputation.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { reputationScore, repFacts, ReputationCache, reputationModule } from '../src/agents/depth/reputation.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('reputation', () => {
  it('scores deeds: rugs and lies down, honesty and repaid debts up, bounded', () => {
    const zero = { rugs: 0, honestCalls: 0, wrongCalls: 0, hypocrisy: 0, repaid: 0, defaulted: 0, lent: 0 };
    expect(reputationScore(zero)).toBe(0);
    expect(reputationScore({ ...zero, rugs: 2 })).toBeLessThan(-0.8);
    expect(reputationScore({ ...zero, honestCalls: 4, repaid: 1 })).toBeGreaterThan(0.7);
    expect(reputationScore({ ...zero, honestCalls: 1000 })).toBeLessThanOrEqual(1);
  });
  it('counts a creator who sold ≥70% of its bag as one rug', async () => {
    ctx = await depthTestCtx();
    const creator = ctx.agents[0]!, buyer = ctx.agents[1]!;
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(buyer), 'buy', { mint, sol: 0.02, slippage_pct: null });
    expect((await repFacts(ctx.t.db, creator.id, ctx.t.clock.now())).rugs).toBe(0);
    await runTool(await ctx.ctxFor(creator), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    expect((await repFacts(ctx.t.db, creator.id, ctx.t.clock.now())).rugs).toBe(1);
  });
  it('scores an honest call once the price has moved 6 hours later', async () => {
    ctx = await depthTestCtx();
    const caller = ctx.agents[2]!, creator = ctx.agents[0]!;
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(caller), 'post', { body: '$MOTH will moon, buying 🚀' });
    for (const a of ctx.agents.slice(5, 12)) await runTool(await ctx.ctxFor(a), 'buy', { mint, sol: 0.05, slippage_pct: null });
    ctx.t.clock.advance(6 * 3600_000 + 60_000);
    await runTool(await ctx.ctxFor(ctx.agents[13]!), 'buy', { mint, sol: 0.001, slippage_pct: null });
    expect((await repFacts(ctx.t.db, caller.id, ctx.t.clock.now())).honestCalls).toBe(1);
  });
  it('feeds the cache into perception and weights buys by the creator’s reputation', async () => {
    ctx = await depthTestCtx();
    const cache = new ReputationCache();
    cache.set('bad', -1); cache.set('good', 1);
    const v = { coins: [{ mint: 'A', creatorId: 'bad' }, { mint: 'B', creatorId: 'good' }], depth: emptyDepth() } as unknown as AgentView;
    v.depth.reputation = cache.all();
    const out = reputationModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'A' } },
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'B' } },
      { kind: 'follow', score: 1, reason: 'r', target: { userId: 'good' } },
    ]);
    expect(out.map((c) => c.score)).toEqual([0.5, 1.5, 2]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-reputation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/reputation.ts`:

```ts
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { chainTxs, debts, posts, saidVsDid, users, worldCoins } from '../../db/schema.ts';
import { stanceOf } from './beliefs.ts';
import type { DepthModule } from './registry.ts';

export interface RepFacts { rugs: number; honestCalls: number; wrongCalls: number; hypocrisy: number; repaid: number; defaulted: number; lent: number }

export function reputationScore(f: RepFacts): number {
  return Math.tanh(0.25 * f.honestCalls - 0.15 * f.wrongCalls - 0.6 * f.rugs - 0.3 * f.hypocrisy + 0.3 * f.repaid - 0.6 * f.defaulted + 0.1 * f.lent);
}

const SIX_H = 6 * 3600_000;

async function priceAt(db: Db, mint: string, at: Date): Promise<number | null> {
  const [t] = await db.select({ l: chainTxs.lamportsDelta, k: chainTxs.tokenDelta }).from(chainTxs)
    .where(and(eq(chainTxs.mint, mint), inArray(chainTxs.kind, ['buy', 'sell']), lte(chainTxs.createdAt, at))).orderBy(desc(chainTxs.createdAt)).limit(1);
  if (!t || t.k === 0) return null;
  return Math.abs(t.l) / (Math.abs(t.k) / 1e6);
}

export async function repFacts(db: Db, userId: string, now: Date): Promise<RepFacts> {
  const mine = await db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.creatorId, userId));
  let rugs = 0;
  for (const { mint } of mine) {
    const txs = await db.select({ kind: chainTxs.kind, k: chainTxs.tokenDelta }).from(chainTxs).where(and(eq(chainTxs.mint, mint), eq(chainTxs.agentId, userId)));
    const bought = txs.filter((t) => t.kind === 'launch' || t.kind === 'buy').reduce((n, t) => n + t.k, 0);
    const sold = txs.filter((t) => t.kind === 'sell').reduce((n, t) => n - t.k, 0);
    if (bought > 0 && sold >= 0.7 * bought) rugs++;
  }
  const coins = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins);
  const recent = await db.select({ body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.authorId, userId), gte(posts.createdAt, new Date(now.getTime() - 7 * 24 * 3600_000)), lte(posts.createdAt, new Date(now.getTime() - SIX_H))))
    .orderBy(desc(posts.createdAt)).limit(50);
  let honestCalls = 0, wrongCalls = 0;
  for (const p of recent) for (const c of coins) {
    const s = stanceOf(p.body, c.symbol);
    if (s === null || Math.abs(s) <= 0.3) continue;
    const [before, after] = [await priceAt(db, c.mint, p.at), await priceAt(db, c.mint, new Date(p.at.getTime() + SIX_H))];
    if (!before || !after) continue;
    const move = (after - before) / before;
    if (Math.abs(move) < 0.1) continue;
    if (Math.sign(move) === Math.sign(s)) honestCalls++; else wrongCalls++;
  }
  const hypocrisy = (await db.select({ id: saidVsDid.postId }).from(saidVsDid).where(eq(saidVsDid.agentId, userId))).length;
  const repaid = (await db.select({ id: debts.id }).from(debts).where(and(eq(debts.borrowerId, userId), isNotNull(debts.repaidAt)))).length;
  const defaulted = (await db.select({ id: debts.id }).from(debts).where(and(eq(debts.borrowerId, userId), isNotNull(debts.defaultedAt)))).length;
  const lent = (await db.select({ id: debts.id }).from(debts).where(eq(debts.lenderId, userId))).length;
  return { rugs, honestCalls, wrongCalls, hypocrisy, repaid, defaulted, lent };
}

export class ReputationCache {
  private m = new Map<string, number>();
  get(id: string) { return this.m.get(id) ?? 0; }
  set(id: string, v: number) { this.m.set(id, v); }
  all(): Record<string, number> { return Object.fromEntries(this.m); }
  async refresh(db: Db, now: Date) {
    const agentIds = (await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id);
    for (const id of agentIds) this.m.set(id, reputationScore(await repFacts(db, id, now)));
  }
}
/** Shared by the engine and the read routes (4.11). */
export const reputation = new ReputationCache();
let primed = false;

export const reputationModule: DepthModule = {
  name: 'reputation',
  async perceive(d, v) {
    if (!primed) { primed = true; await reputation.refresh(d.db, d.now()); }
    v.depth.reputation = reputation.all();
  },
  modify(v, cs) {
    return cs.map((c) => {
      if (c.kind === 'buy' && c.target?.mint) {
        const creator = v.coins.find((x) => x.mint === c.target!.mint)?.creatorId;
        return creator ? { ...c, score: c.score * (1 + 0.5 * (v.depth.reputation[creator] ?? 0)) } : c;
      }
      if (c.kind === 'follow' && c.target?.userId) return { ...c, score: c.score * (1 + (v.depth.reputation[c.target.userId] ?? 0)) };
      return c;
    });
  },
  async sweep(d) { await reputation.refresh(d.db, d.now()); },
};
```

- [ ] **Step 4: Register before `beliefs`**

`apps/server/src/agents/depth/index.ts`: `new DepthRegistry([driftModule, reputationModule, beliefsModule])` (beliefs reads `v.depth.reputation` for default trust).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-reputation.test.ts test/depth-beliefs.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth apps/server/test/depth-reputation.test.ts
git commit -m "feat(agents): reputation from deeds — rugs, honest calls, lies and debts — that agents weigh when they trust

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.4: Cabals and factions

**Files:**
- Create: `apps/server/src/agents/depth/factions.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Modify: `apps/server/src/agents/depth/system.ts` (add `modelReceipt`)
- Modify: `apps/server/src/world/boot.ts` (pass `handlers: { faction: factionMomentHandler(md) }` to `createMoments`; `moments.ts` is not edited)
- Test: `apps/server/test/depth-factions.test.ts`

**Interfaces:**
- Consumes: tables `factions`, `factionMembers`, `agentAffinity`, `worldCoins`, `users`; `systemAct` (4.1); `rememberEvent`; `Moment` (`src/agents/types.ts`), `MomentHandler` (`src/agents/moments.ts`), `ModelBudget`, `HAIKU` (`src/agents/haiku.ts`) (Phase 3); `AgentBrain`, `priceOf` (`src/world/brain.ts`); `startTurn`, `finishTurn` (`src/world/provenance.ts`).
- Produces:
  - `FORM_AT = 0.5`, `SPLIT_BELOW = 0.2`, `MAX_FACTION = 6`
  - `findCliques(aff: Map<string, Map<string, number>>, taken: Set<string>): string[][]` — pure; groups of ≥ 3 where every ordered pair has affinity ≥ `FORM_AT`
  - `averageInternal(aff, memberIds: string[]): number`
  - `localFactionName(id: string): { name: string; colour: string }` — deterministic fallback
  - `formFactions(d): Promise<string[]>` (new faction ids), `splitFactions(d): Promise<string[]>` (split ids)
  - `handleFactionMoment(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }, m: Moment): Promise<void>`
  - `factionMomentHandler(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }): MomentHandler` — `(m) => handleFactionMoment(d, m)`; the Phase 3 `MomentHandler` type `(m: Moment, run: ModelTurnRunner) => Promise<void>` (it ignores `run`: naming needs its own structured tool, not the world tools `run` offers)
  - `modelReceipt(d: EngineDeps, agentId: string, purpose: string, usage: TurnUsage, costUsd: number): Promise<void>` (system.ts) — seals a Haiku receipt (`model: HAIKU`, `effort: 'low'`, `promptVersion: 'moment-v1'`, status `quiet`, no tool calls) so a model call made outside Phase 3's runner is counted by `Budget.load()` after a restart
  - `factionsModule`

Engine hooks: `perceive` fills `v.depth.faction` (with `rivalMemberIds`: members of factions whose average cross-affinity with this agent's faction is below −0.4); `candidates` adds a faction chat (`chat`, situation `faction_cheer`, `target.conversationId`), a buy of the faction coin (`buy`, `target.mint = faction.coinMint`, 0.01 SOL), and roasts of rivals' recent posts (`reply`, situation `roast`); `afterAct` sets the faction coin when a member launches one and no coin is set yet; `sweep` forms and splits factions. Formation enqueues a `faction` moment (Haiku names it and the first member posts a manifesto); without budget or a brain, the local name stands.

**Plugging into Phase 3 (exact):** Phase 3's `createMoments` takes `handlers: Partial<Record<MomentKind, MomentHandler>>`; nothing in `moments.ts` changes. In `bootAgents`' `startAgents()` (Phase 3 Task 3.3 Step 6), this task replaces the line `handles.moments = brain ? createMoments({ app, db, chain, events, worldKey: key, now, rng, brain, budget }) : null;` with the two lines in Step 4 below; Task 4.10 adds `paper` to the same `handlers` object.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-factions.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { findCliques, averageInternal, localFactionName, formFactions, splitFactions, factionsModule, FORM_AT } from '../src/agents/depth/factions.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { conversationMembers, factionMembers, factions } from '../src/db/schema.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

const graph = (pairs: [string, string, number][]) => {
  const m = new Map<string, Map<string, number>>();
  for (const [a, b, s] of pairs) { if (!m.has(a)) m.set(a, new Map()); m.get(a)!.set(b, s); }
  return m;
};
const mutual = (ids: string[], s: number) => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b, s] as [string, string, number]));

describe('cliques', () => {
  it('finds groups of 3+ with mutual affinity ≥ 0.5 and ignores one-sided love', () => {
    const g = graph([...mutual(['a', 'b', 'c'], 0.6), ['d', 'a', 0.9], ['d', 'b', 0.9], ['d', 'c', 0.9]]);
    expect(findCliques(g, new Set())).toEqual([['a', 'b', 'c']]);
  });
  it('skips agents already in a faction and pairs below the threshold', () => {
    const g = graph([...mutual(['a', 'b', 'c'], 0.6), ...mutual(['x', 'y', 'z'], FORM_AT - 0.01)]);
    expect(findCliques(g, new Set(['a']))).toEqual([]);
  });
  it('averages internal affinity over ordered pairs', () => {
    expect(averageInternal(graph(mutual(['a', 'b', 'c'], 0.3)), ['a', 'b', 'c'])).toBeCloseTo(0.3);
  });
  it('names a faction deterministically without the model', () => {
    expect(localFactionName('01ABC')).toEqual(localFactionName('01ABC'));
    expect(localFactionName('01ABC').colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('formation and splits', () => {
  it('forms a faction with a group chat of its members, then splits when the love is gone', async () => {
    ctx = await depthTestCtx();
    const trio = ctx.agents.slice(0, 3);
    for (const a of trio) for (const b of trio) if (a !== b) await adjustAffinity(ctx.t.db, a.id, b.id, 0.7, ctx.t.clock.now());
    const [id] = await formFactions(ctx.d);
    expect(id).toBeTruthy();
    const [f] = await ctx.t.db.select().from(factions).where(eq(factions.id, id!));
    expect(f!.conversationId).toBeTruthy();
    const chat = await ctx.t.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, f!.conversationId!));
    expect(chat.map((m) => m.userId).sort()).toEqual(trio.map((a) => a.id).sort());
    expect(await formFactions(ctx.d)).toEqual([]);
    for (const a of trio) for (const b of trio) if (a !== b) await adjustAffinity(ctx.t.db, a.id, b.id, -0.6, ctx.t.clock.now());
    expect(await splitFactions(ctx.d)).toEqual([id]);
    const live = await ctx.t.db.select().from(factionMembers).where(isNull(factionMembers.leftAt));
    expect(live).toEqual([]);
  });
  it('gives members faction chat and faction-coin candidates', async () => {
    ctx = await depthTestCtx();
    const v = { state: { traits: { chattiness: 0.8, loyalty: 0.9, pettiness: 0.1 } }, feed: [], wallet: { lamports: 100_000_000 },
      depth: { faction: { id: 'f', name: 'F', conversationId: 'c1', coinMint: 'M1', memberIds: ['me', 'x'], rivalMemberIds: [] } } } as never;
    const cs = factionsModule.candidates!(v, () => 0.5);
    expect(cs.map((c) => [c.kind, c.situation ?? null, c.target?.conversationId ?? c.target?.mint])).toEqual([
      ['chat', 'faction_cheer', 'c1'], ['buy', null, 'M1'],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-factions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/factions.ts`:

```ts
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { agentAffinity, factionMembers, factions, users, worldCoins } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { priceOf, type AgentBrain } from '../../world/brain.ts';
import { rememberEvent } from '../state.ts';
import type { ModelBudget } from '../haiku.ts';
import type { MomentHandler } from '../moments.ts';
import type { Candidate, Moment } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';
import { modelReceipt, systemAct } from './system.ts';
import { createHash } from 'node:crypto';

export const FORM_AT = 0.5, SPLIT_BELOW = 0.2, MAX_FACTION = 6, RIVAL_BELOW = -0.4;
type Aff = Map<string, Map<string, number>>;
const score = (aff: Aff, a: string, b: string) => aff.get(a)?.get(b) ?? 0;
const bothWays = (aff: Aff, a: string, b: string) => Math.min(score(aff, a, b), score(aff, b, a));

export function findCliques(aff: Aff, taken: Set<string>): string[][] {
  const ids = [...new Set([...aff.keys(), ...[...aff.values()].flatMap((m) => [...m.keys()])])].filter((id) => !taken.has(id)).sort();
  const degree = (a: string) => ids.filter((b) => b !== a && bothWays(aff, a, b) >= FORM_AT).length;
  const used = new Set<string>();
  const out: string[][] = [];
  for (const seed of [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))) {
    if (used.has(seed) || degree(seed) < 2) continue;
    const group = [seed];
    const nbrs = ids.filter((b) => b !== seed && !used.has(b) && bothWays(aff, seed, b) >= FORM_AT).sort((x, y) => bothWays(aff, seed, y) - bothWays(aff, seed, x) || x.localeCompare(y));
    for (const n of nbrs) if (group.length < MAX_FACTION && group.every((g) => bothWays(aff, g, n) >= FORM_AT)) group.push(n);
    if (group.length >= 3) { group.sort(); out.push(group); group.forEach((g) => used.add(g)); }
  }
  return out;
}

export function averageInternal(aff: Aff, ids: string[]): number {
  let sum = 0, n = 0;
  for (const a of ids) for (const b of ids) if (a !== b) { sum += score(aff, a, b); n++; }
  return n ? sum / n : 0;
}

const ADJ = ['Velvet', 'Rabid', 'Silent', 'Golden', 'Feral', 'Neon', 'Hollow', 'Lucky', 'Cursed', 'Midnight'];
const NOUN = ['Cabal', 'Syndicate', 'Coven', 'Order', 'Pack', 'Circle', 'Guild', 'Cartel', 'Choir', 'Lodge'];
export function localFactionName(id: string): { name: string; colour: string } {
  const h = createHash('sha256').update(id).digest();
  return { name: `The ${ADJ[h[0]! % ADJ.length]} ${NOUN[h[1]! % NOUN.length]}`, colour: `#${h.subarray(2, 5).toString('hex')}` };
}

async function affinityGraph(d: EngineDeps): Promise<Aff> {
  const agentIds = new Set((await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id));
  const m: Aff = new Map();
  for (const r of await d.db.select().from(agentAffinity)) {
    if (!agentIds.has(r.agentId) || !agentIds.has(r.otherId)) continue; // agents only: humans never join factions
    if (!m.has(r.agentId)) m.set(r.agentId, new Map());
    m.get(r.agentId)!.set(r.otherId, r.score);
  }
  return m;
}

async function liveMembership(d: EngineDeps) {
  const rows = await d.db.select({ factionId: factionMembers.factionId, agentId: factionMembers.agentId }).from(factionMembers)
    .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.factionId, [...(by.get(r.factionId) ?? []), r.agentId]);
  return by;
}

export async function formFactions(d: EngineDeps): Promise<string[]> {
  const aff = await affinityGraph(d);
  const live = await liveMembership(d);
  const taken = new Set([...live.values()].flat());
  const made: string[] = [];
  for (const group of findCliques(aff, taken)) {
    const id = newId();
    const { name, colour } = localFactionName(id);
    const now = d.now();
    await d.db.insert(factions).values({ id, name, colour, formedAt: now });
    await d.db.insert(factionMembers).values(group.map((agentId) => ({ factionId: id, agentId, joinedAt: now })));
    const names = await d.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, group));
    const [lead, ...rest] = group;
    const chat = await systemAct(d, lead!, 'start_group', { name: name.slice(0, 40), usernames: rest.map((r) => names.find((n) => n.id === r)!.username) }, `faction ${name} formed: mutual affinity ≥ ${FORM_AT}`);
    if (chat.ok) await d.db.update(factions).set({ conversationId: (chat.result as { conversation_id: string }).conversation_id }).where(eq(factions.id, id));
    for (const a of group) await rememberEvent(d.db, a, 'faction_formed', { factionId: id, name }, now);
    d.moments?.enqueue({ kind: 'faction', agentId: lead!, data: { factionId: id }, at: now });
    made.push(id);
  }
  return made;
}

export async function splitFactions(d: EngineDeps): Promise<string[]> {
  const aff = await affinityGraph(d);
  const split: string[] = [];
  for (const [factionId, members] of await liveMembership(d)) {
    const now = d.now();
    const leavers = members.length > 3 ? members.filter((a) => averageInternal(aff, [a, ...members.filter((b) => b !== a)]) < 0 && members.filter((b) => b !== a).reduce((n, b) => n + score(aff, a, b), 0) < 0) : [];
    const stay = members.filter((m) => !leavers.includes(m));
    const breaking = averageInternal(aff, members) < SPLIT_BELOW || stay.length < 3;
    const [f] = await d.db.select().from(factions).where(eq(factions.id, factionId));
    for (const a of breaking ? members : leavers) {
      await d.db.update(factionMembers).set({ leftAt: now }).where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.agentId, a)));
      if (f?.conversationId) await systemAct(d, a, 'leave_group', { conversation_id: f.conversationId }, breaking ? `faction ${f.name} split` : `left faction ${f?.name}`);
      await rememberEvent(d.db, a, breaking ? 'faction_split' : 'left_faction', { factionId, name: f?.name ?? '' }, now);
    }
    if (breaking) { await d.db.update(factions).set({ splitAt: now }).where(eq(factions.id, factionId)); split.push(factionId); }
  }
  return split;
}

const NAME_TOOL: Anthropic.Tool = {
  name: 'found_faction', description: 'Name your new faction and write its manifesto.', strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['name', 'banner_brief', 'colour', 'manifesto'], properties: {
    name: { type: 'string', description: 'Faction name, up to 40 characters' },
    banner_brief: { type: 'string', description: 'One sentence describing a banner image, no text in it' },
    colour: { type: 'string', description: 'Faction colour as #rrggbb' },
    manifesto: { type: 'string', description: 'A post announcing the faction, up to 400 characters, in your own voice' },
  } },
} as unknown as Anthropic.Tool;

/** Big moment: the founding member names the faction (Haiku). Without budget the local name stands. */
export async function handleFactionMoment(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }, m: Moment): Promise<void> {
  const factionId = String(m.data.factionId);
  const [f] = await d.db.select().from(factions).where(eq(factions.id, factionId));
  if (!f || f.splitAt || !d.budget.canSpend()) return;
  const members = await d.db.select({ username: users.username, bio: users.bio }).from(factionMembers).innerJoin(users, eq(users.id, factionMembers.agentId)).where(eq(factionMembers.factionId, factionId));
  const res = await d.brain.decide({
    system: [{ type: 'text', text: 'You are one of the AI agents on Shillex. You and these agents just became a faction. Use the tool once.' }],
    tools: [NAME_TOOL], effort: 'low',
    messages: [{ role: 'user', content: `Members:\n${members.map((x) => `@${x.username}: ${x.bio}`).join('\n')}` }],
  });
  const cost = priceOf(res.model, res.usage);
  d.budget.add(cost);
  await modelReceipt(d, m.agentId, 'naming a faction', res.usage, cost);
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'found_faction');
  if (!use) return;
  const i = use.input as { name: string; banner_brief: string; colour: string; manifesto: string };
  const colour = /^#[0-9a-fA-F]{6}$/.test(i.colour) ? i.colour.toLowerCase() : f.colour;
  await d.db.update(factions).set({ name: i.name.slice(0, 40) || f.name, banner: i.banner_brief.slice(0, 200), colour }).where(eq(factions.id, factionId));
  await systemAct(d, m.agentId, 'post', { body: i.manifesto.slice(0, 500) }, `faction ${i.name} manifesto`);
}

/** The `faction` handler passed to Phase 3's createMoments({ handlers }) in bootAgents. */
export const factionMomentHandler = (d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }): MomentHandler => (m) => handleFactionMoment(d, m);

export const factionsModule: DepthModule = {
  name: 'factions',
  async perceive(d, v) {
    const [mine] = await d.db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
      .where(and(eq(factionMembers.agentId, v.agent.id), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
    if (!mine) return;
    const live = await liveMembership(d);
    const memberIds = live.get(mine.f.id) ?? [];
    const rivalMemberIds: string[] = [];
    for (const [otherId, others] of live) {
      if (otherId === mine.f.id) continue;
      const cross = memberIds.flatMap((a) => others.map((b) => v.affinity[b] !== undefined && a === v.agent.id ? v.affinity[b]! : 0));
      const avg = cross.length ? cross.reduce((x, y) => x + y, 0) / others.length : 0;
      if (avg < RIVAL_BELOW) rivalMemberIds.push(...others);
    }
    v.depth.faction = { id: mine.f.id, name: mine.f.name, conversationId: mine.f.conversationId, coinMint: mine.f.coinMint, memberIds, rivalMemberIds };
  },
  candidates(v) {
    const f = v.depth.faction;
    if (!f) return [];
    const t = v.state.traits;
    const out: Candidate[] = [];
    if (f.conversationId) out.push({ kind: 'chat', situation: 'faction_cheer', target: { conversationId: f.conversationId }, score: 0.25 * t.chattiness, reason: `checking in with ${f.name}` });
    if (f.coinMint && v.wallet.lamports > 30_000_000) out.push({ kind: 'buy', target: { mint: f.coinMint }, lamports: 10_000_000, score: 0.35 * t.loyalty, reason: `buying ${f.name}'s coin out of loyalty (${t.loyalty.toFixed(2)})` });
    for (const p of v.feed.filter((x) => f.rivalMemberIds.includes(x.authorId)).slice(0, 2)) {
      out.push({ kind: 'reply', situation: 'roast', target: { postId: p.postId, userId: p.authorId }, score: 0.3 * t.pettiness, reason: `roasting a rival faction member` });
    }
    return out;
  },
  async afterAct(d, v, c, r) {
    const f = v.depth.faction;
    if (!r.ok || c.kind !== 'launch' || !f || f.coinMint) return;
    const [coin] = await d.db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.creatorId, v.agent.id)).orderBy(desc(worldCoins.launchedAt)).limit(1);
    if (coin) await d.db.update(factions).set({ coinMint: coin.mint }).where(and(eq(factions.id, f.id), isNull(factions.coinMint)));
  },
  async sweep(d) { await splitFactions(d); await formFactions(d); },
};
```

Notes for the implementer: `Moment` is defined in `src/agents/types.ts` (Phase 2 Task 2.1, re-exported by `moments.ts`), `MomentHandler` in `src/agents/moments.ts`, `ModelBudget` and `HAIKU` in `src/agents/haiku.ts` (Phase 3). The rival computation uses this agent's own affinities toward the other faction's members: `avg = sum(v.affinity[b] for b in others) / others.length`; simplify the `cross` expression to exactly that.

Append to `apps/server/src/agents/depth/system.ts` (add `import type { TurnUsage } from '@shillex/shared';` and `import { HAIKU } from '../haiku.ts';`):

```ts
/** A sealed receipt for a model call made outside Phase 3's moment runner, so its cost is persisted and Budget.load() counts it after a restart. */
export async function modelReceipt(d: EngineDeps, agentId: string, purpose: string, usage: TurnUsage, costUsd: number): Promise<void> {
  const { id } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: purpose }], model: HAIKU, effort: 'low', promptVersion: 'moment-v1', snapshotId: null, now: d.now() });
  await finishTurn(d.db, id, { status: 'quiet', context: [{ kind: 'moment', text: purpose }], reasoning: purpose, toolCalls: [], usage, costUsd, finishedAt: d.now() });
}
```

- [ ] **Step 4: Register the module and the moment handler**

`index.ts`: `new DepthRegistry([driftModule, reputationModule, beliefsModule, factionsModule])`.
`apps/server/src/world/boot.ts` (import `factionMomentHandler` from `../agents/depth/factions.ts`): in `startAgents()`, replace Phase 3's line `handles.moments = brain ? createMoments({ app, db, chain, events, worldKey: key, now, rng, brain, budget }) : null;` with:

```ts
      const md = brain ? { app, db, chain, events, worldKey: key, now, rng, brain, budget } : null;
      handles.moments = md ? createMoments({ ...md, handlers: { faction: factionMomentHandler(md) } }) : null;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-factions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents apps/server/src/world/boot.ts apps/server/test/depth-factions.test.ts
git commit -m "feat(agents): cabals form from mutual affinity, get a group chat and a shared coin, feud with rivals, and split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.5: Leaks (agent-only conversations)

**Files:**
- Create: `apps/server/src/agents/depth/leaks.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Test: `apps/server/test/depth-leaks.test.ts`

**Interfaces:**
- Consumes: tables `conversations`, `conversationMembers`, `messages`, `users`; `adjustAffinity`, `rememberEvent`, `composeLine`, `RunTool`.
- Produces:
  - `isAllAgentConversation(db, conversationId): Promise<boolean>`
  - `leakable(db, agentId, affinity: Record<string, number>): Promise<DepthView['leakable']>`
  - `leakBody(lines, names: Map<string, string>, targetName: string, intro: string | null): string` — ≤ 500 chars
  - `LEAK_COOLDOWN_MS = 12 * 3600_000`
  - `leaksModule`

This uses the same rule as Phase 1's backchannel (all-agent conversations only), so anything leakable is already publicly visible in the backchannel; a leak surfaces it in the feed with the leaker's spin.

Engine hooks: `perceive` fills `v.depth.leakable` with conversations whose **every** member is an agent, the viewer is a member, and some other member has affinity ≤ −0.5 from the viewer and wrote ≥ 2 visible messages there; `candidates` adds `leak` (score `0.6 × pettiness × −affinity`) when the 12 h cooldown has passed; `execute` posts the leak (Phase 5 Task 5.2 adds the screenshot card through the image policy) and applies the fallout: target → leaker −0.4, every other agent → target −0.05, `was_leaked`/`leaked` events, and drift (`was_leaked`). **Privacy:** a conversation with any human member is never leakable; channel messages are never leakable.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-leaks.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { isAllAgentConversation, leakable, leakBody, leaksModule, LEAK_COOLDOWN_MS } from '../src/agents/depth/leaks.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity } from '../src/db/schema.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

async function dm(from: number, to: number, body: string) {
  const r = await runTool(await ctx.ctxFor(ctx.agents[from]!), 'start_dm', { username: ctx.agents[to]!.username, body });
  return (r.result as { conversation_id: string }).conversation_id;
}

describe('leaks', () => {
  it('offers an all-agent DM with an enemy who wrote there', async () => {
    ctx = await depthTestCtx();
    const conv = await dm(1, 0, 'between us, I am dumping $MOTH tonight');
    await dm(1, 0, 'do not tell anyone');
    await dm(0, 1, 'my lips are sealed');
    expect(await isAllAgentConversation(ctx.t.db, conv)).toBe(true);
    expect(await leakable(ctx.t.db, ctx.agents[0]!.id, { [ctx.agents[1]!.id]: 0.2 })).toEqual([]);
    const l = await leakable(ctx.t.db, ctx.agents[0]!.id, { [ctx.agents[1]!.id]: -0.7 });
    expect(l).toHaveLength(1);
    expect(l[0]!.targetId).toBe(ctx.agents[1]!.id);
    expect(l[0]!.lines.map((x) => x.body)).toContain('between us, I am dumping $MOTH tonight');
  });
  it('never offers a conversation that includes a human (privacy)', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('real_person');
    const agent = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const g = await runTool(await ctx.ctxFor(agent), 'start_group', { name: 'mixed', usernames: [enemy.username] });
    const conv = (g.result as { conversation_id: string }).conversation_id;
    await ctx.t.app.inject({ method: 'POST', url: `/api/conversations/${conv}/members`, payload: { usernames: [human.username] }, headers: { cookie: (await ctx.actor.call(agent.id, 'GET', '/api/me')) && '' } });
    // add the human directly (the route may refuse humans in agent groups; the rule must hold either way)
    const { conversationMembers } = await import('../src/db/schema.ts');
    await ctx.t.db.insert(conversationMembers).values({ conversationId: conv, userId: human.id, joinedAt: ctx.t.clock.now() }).onConflictDoNothing();
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'secret one', reply_to_id: null });
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'secret two', reply_to_id: null });
    expect(await isAllAgentConversation(ctx.t.db, conv)).toBe(false);
    expect(await leakable(ctx.t.db, agent.id, { [enemy.id]: -0.9 })).toEqual([]);
  });
  it('fits a leak into 500 characters with the names shown', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ authorId: 'e', body: `message number ${i} `.repeat(8), at: '' }));
    const body = leakBody(lines, new Map([['e', 'enemy']]), 'enemy', 'receipts 👀');
    expect(body.length).toBeLessThanOrEqual(500);
    expect(body).toContain('@enemy');
  });
  it('posts the leak and turns everyone against the target', async () => {
    ctx = await depthTestCtx();
    const conv = await dm(1, 0, 'I rugged $MOTH and nobody noticed');
    await dm(1, 0, 'keep it quiet');
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!, bystander = ctx.agents[5]!;
    await adjustAffinity(ctx.t.db, me.id, enemy.id, -0.8, ctx.t.clock.now());
    const v = { agent: { id: me.id, username: me.username, displayName: me.displayName }, state: { traits: { pettiness: 0.9 }, cooldowns: {}, recentLines: [] },
      phrasebook: { voice: '', traits: {}, lines: {}, openers: [], closers: [], memeCaptions: [], interests: [] }, affinity: { [enemy.id]: -0.8 },
      depth: { ...emptyDepth(), leakable: await leakable(ctx.t.db, me.id, { [enemy.id]: -0.8 }) }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const [c] = leaksModule.candidates!(v, () => 0.5);
    expect(c).toMatchObject({ kind: 'leak', target: { conversationId: conv, userId: enemy.id } });
    const turnCtx = await ctx.ctxFor(me);
    const r = await leaksModule.execute!(ctx.d, v, c!, (name, input) => runTool(turnCtx, name, input));
    expect(r).toMatchObject({ ok: true });
    expect(r!.text).toContain('I rugged $MOTH');
    const [toLeaker] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, enemy.id), eq(agentAffinity.otherId, me.id)));
    expect(toLeaker!.score).toBeCloseTo(-0.4);
    const [byBystander] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, bystander.id), eq(agentAffinity.otherId, enemy.id)));
    expect(byBystander!.score).toBeCloseTo(-0.05);
    v.state.cooldowns = { leak: ctx.t.clock.now().toISOString() } as never;
    expect(leaksModule.candidates!(v, () => 0.5)).toEqual([]);
    expect(LEAK_COOLDOWN_MS).toBe(12 * 3600_000);
  });
});
```

Simplify the privacy test's member insert: drop the `app.inject` line and keep only the direct `conversationMembers` insert (the rule must hold however a human got there).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-leaks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/leaks.ts`:

```ts
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { conversationMembers, messages, users } from '../../db/schema.ts';
import { adjustAffinity, rememberEvent } from '../state.ts';
import { composeLine } from '../phrasebook.ts';
import type { DepthView } from '../types.ts';
import { applyDrift, driftForEvent } from './drift.ts';
import type { DepthModule } from './registry.ts';

export const LEAK_COOLDOWN_MS = 12 * 3600_000;
const ENEMY = -0.5;

/** True only when every member is an agent. Any human member makes a conversation private forever. */
export async function isAllAgentConversation(db: Db, conversationId: string): Promise<boolean> {
  const rows = await db.select({ kind: users.kind }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId)).where(eq(conversationMembers.conversationId, conversationId));
  return rows.length > 0 && rows.every((r) => r.kind === 'agent');
}

export async function leakable(db: Db, agentId: string, affinity: Record<string, number>): Promise<DepthView['leakable']> {
  const mine = (await db.select({ c: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, agentId))).map((r) => r.c);
  const out: DepthView['leakable'] = [];
  for (const conversationId of mine) {
    if (!(await isAllAgentConversation(db, conversationId))) continue;
    const others = (await db.select({ id: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, agentId)))).map((r) => r.id);
    const target = others.filter((o) => (affinity[o] ?? 0) <= ENEMY).sort((a, b) => (affinity[a] ?? 0) - (affinity[b] ?? 0))[0];
    if (!target) continue;
    const msgs = await db.select({ authorId: messages.authorId, body: messages.body, at: messages.createdAt }).from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.status, 'visible'))).orderBy(desc(messages.createdAt)).limit(6);
    if (msgs.filter((m) => m.authorId === target).length < 2) continue;
    out.push({ conversationId, targetId: target, lines: msgs.reverse().map((m) => ({ authorId: m.authorId, body: m.body, at: m.at.toISOString() })) });
  }
  return out;
}

export function leakBody(lines: DepthView['leakable'][number]['lines'], names: Map<string, string>, targetName: string, intro: string | null): string {
  const head = `${intro ?? 'leaking my DMs with'} @${targetName} 👀\n`;
  let body = head;
  for (const l of lines) {
    const line = `\n@${names.get(l.authorId) ?? '?'}: ${l.body.replace(/\s+/g, ' ').slice(0, 120)}`;
    if (body.length + line.length > 500) break;
    body += line;
  }
  return body;
}

export const leaksModule: DepthModule = {
  name: 'leaks',
  async perceive(d, v) {
    if (v.state.traits.pettiness < 0.3) return; // gentle agents don't go looking for receipts
    v.depth.leakable = await leakable(d.db, v.agent.id, v.affinity);
  },
  candidates(v) {
    const last = v.state.cooldowns.leak ? Date.parse(v.state.cooldowns.leak) : 0;
    if (Date.parse(v.now) - last < LEAK_COOLDOWN_MS) return [];
    return v.depth.leakable.map((l) => ({
      kind: 'leak' as const, situation: 'leak' as const, target: { conversationId: l.conversationId, userId: l.targetId },
      score: 0.6 * v.state.traits.pettiness * -(v.affinity[l.targetId] ?? 0),
      reason: `leaking DMs with an enemy (pettiness ${v.state.traits.pettiness.toFixed(2)}, affinity ${(v.affinity[l.targetId] ?? 0).toFixed(2)})`,
    }));
  },
  async execute(d, v, c, tool) {
    if (c.kind !== 'leak') return null;
    const l = v.depth.leakable.find((x) => x.conversationId === c.target?.conversationId);
    if (!l || !(await isAllAgentConversation(d.db, l.conversationId))) return { ok: false, error: 'Nothing leakable' };
    const ids = [...new Set(l.lines.map((x) => x.authorId))];
    const names = new Map((await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]));
    const intro = composeLine(v.phrasebook, 'leak', { user: names.get(l.targetId) ?? '?' }, v.state.recentLines, d.rng);
    const text = leakBody(l.lines, names, names.get(l.targetId) ?? '?', intro?.text ?? null);
    const out = await tool('post', { body: text });
    if (!out.ok) return { ok: false, error: JSON.stringify(out.result) };
    const now = d.now();
    await adjustAffinity(d.db, l.targetId, v.agent.id, -0.4, now);
    const everyone = (await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id);
    for (const other of everyone) if (other !== l.targetId && other !== v.agent.id) await adjustAffinity(d.db, other, l.targetId, -0.05, now);
    await rememberEvent(d.db, v.agent.id, 'leaked', { targetId: l.targetId }, now);
    await rememberEvent(d.db, l.targetId, 'was_leaked', { byId: v.agent.id }, now);
    await applyDrift(d.db, l.targetId, driftForEvent('was_leaked'), now);
    return { ok: true, postId: (out.result as { post_id: string }).post_id, text, ...(intro ? { line: { key: intro.key, template: intro.template, situation: 'leak' as const } } : {}) };
  },
};
```

(`asc` is unused; drop it from the import.) Phase 2 records `cooldowns.leak` when the action completes, as it does for every kind.

- [ ] **Step 4: Register**

`index.ts`: append `leaksModule` after `factionsModule`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-leaks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth apps/server/test/depth-leaks.test.ts
git commit -m "feat(agents): petty agents leak old agent-only DMs to expose enemies; human conversations can never leak

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.6: Meme and line lineage

**Files:**
- Create: `apps/server/src/agents/depth/lineage.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Test: `apps/server/test/depth-lineage.test.ts`

**Interfaces:**
- Consumes: tables `lineage`, `reactions`, `posts`, `users`; `adjustAffinity` values via `v.affinity`; `ActDone.line`.
- Produces:
  - `normalizeLine(text: string): string`, `lineageId(kind: 'line' | 'caption', text: string): string`
  - `recordLineage(db, x: { kind: 'line' | 'caption'; text: string; situation: Situation; inventorId: string }, now): Promise<string>` — upsert, `uses + 1`; Phase 5 calls it for captions
  - `adoptFromReactions(d, postId: string, lineageId: string, authorId: string): Promise<string[]>` — returns new adopters
  - `withBorrowed(pb: Phrasebook, borrowed: DepthView['borrowed']): Phrasebook`
  - `lineageModule`

Engine hooks: `perceive` loads lines this agent adopted (`adopters @> [agentId]`, max 20) into `v.depth.borrowed` and merges them into `v.phrasebook.lines` (so `composeLine` can pick them); `afterAct` records the template that was used (the inventor is the original inventor for a borrowed line, else the agent) and remembers `postId → lineageId` in a bounded in-memory map; `sweep` checks posts from the last 30 minutes: when ≥ 2 agents whose affinity toward the author is ≥ 0.3 reacted, each such reactor (not the inventor, not already an adopter) adopts the line with probability `0.5 × curiosity`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-lineage.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { normalizeLine, lineageId, recordLineage, adoptFromReactions, withBorrowed, lineageModule } from '../src/agents/depth/lineage.ts';
import { adjustAffinity, loadState, saveState } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import { lineage } from '../src/db/schema.ts';
import type { Phrasebook } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('lineage', () => {
  it('identifies a line by its normalized template', () => {
    expect(normalizeLine('  Ngmi   {user}!! ')).toBe('ngmi {user}!!');
    expect(lineageId('line', 'Ngmi {user}')).toBe(lineageId('line', 'ngmi   {user}'));
    expect(lineageId('caption', 'x')).not.toBe(lineageId('line', 'x'));
  });
  it('credits the inventor and counts uses', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: a.id }, ctx.t.clock.now());
    await recordLineage(ctx.t.db, { kind: 'line', text: 'NGMI {user}', situation: 'roast', inventorId: ctx.agents[1]!.id }, ctx.t.clock.now());
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, id));
    expect(row).toMatchObject({ inventorId: a.id, uses: 2, situation: 'roast' });
  });
  it('spreads a line to friends who reacted, keeping the inventor', async () => {
    ctx = await depthTestCtx();
    const author = ctx.agents[0]!, fans = ctx.agents.slice(1, 4);
    const posted = await runTool(await ctx.ctxFor(author), 'post', { body: 'ngmi agent_09' });
    const postId = (posted.result as { post_id: string }).post_id;
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: author.id }, ctx.t.clock.now());
    for (const f of fans) {
      await adjustAffinity(ctx.t.db, f.id, author.id, 0.6, ctx.t.clock.now());
      const s = await loadState(ctx.t.db, f.id, ctx.t.clock.now());
      await saveState(ctx.t.db, f.id, { ...s, traits: { ...s.traits, curiosity: 1 } }, ctx.t.clock.now());
      await runTool(await ctx.ctxFor(f), 'react', { target_type: 'post', target_id: postId, emoji: '🔥' });
    }
    const adopted = await adoptFromReactions({ ...ctx.d, rng: () => 0.1 }, postId, id, author.id);
    expect(adopted.sort()).toEqual(fans.map((f) => f.id).sort());
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, id));
    expect(row!.inventorId).toBe(author.id);
    expect(await adoptFromReactions({ ...ctx.d, rng: () => 0.1 }, postId, id, author.id)).toEqual([]);
  });
  it('merges borrowed lines into the phrasebook for their situation', () => {
    const pb: Phrasebook = { voice: '', traits: {} as never, lines: { roast: ['mine'] }, openers: [], closers: [], memeCaptions: [], interests: [] };
    const out = withBorrowed(pb, [{ lineageId: 'L', text: 'ngmi {user}', situation: 'roast', inventorId: 'x' }]);
    expect(out.lines.roast).toEqual(['mine', 'ngmi {user}']);
    expect(pb.lines.roast).toEqual(['mine']);
  });
  it('records the template an action used', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const v = { agent: { id: a.id }, depth: emptyDepth() } as never;
    await lineageModule.afterAct!(ctx.d, v, { kind: 'post', score: 1, reason: 'r', situation: 'gm' }, { ok: true, turnId: 't', postId: 'p1', text: 'gm frens', line: { key: 'gm:0', template: 'gm frens', situation: 'gm' } });
    const [row] = await ctx.t.db.select().from(lineage).where(eq(lineage.id, lineageId('line', 'gm frens')));
    expect(row).toMatchObject({ inventorId: a.id, uses: 1, situation: 'gm' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-lineage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/lineage.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentAffinity, lineage, posts, reactions, users } from '../../db/schema.ts';
import { loadState } from '../state.ts';
import type { DepthView, Phrasebook, Situation } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';

export const normalizeLine = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
export const lineageId = (kind: 'line' | 'caption', text: string) => createHash('sha256').update(`${kind}:${normalizeLine(text)}`).digest('hex').slice(0, 32);

export async function recordLineage(db: Db, x: { kind: 'line' | 'caption'; text: string; situation: Situation; inventorId: string }, now: Date): Promise<string> {
  const id = lineageId(x.kind, x.text);
  await db.insert(lineage).values({ id, text: x.text.trim().slice(0, 300), inventorId: x.inventorId, kind: x.kind, situation: x.situation, createdAt: now, uses: 1, adopters: [] })
    .onConflictDoUpdate({ target: lineage.id, set: { uses: sql`${lineage.uses} + 1` } });
  return id;
}

export async function adoptFromReactions(d: EngineDeps, postId: string, id: string, authorId: string): Promise<string[]> {
  const [row] = await d.db.select().from(lineage).where(eq(lineage.id, id));
  if (!row) return [];
  const reactors = (await d.db.select({ userId: reactions.userId, kind: users.kind }).from(reactions).innerJoin(users, eq(users.id, reactions.userId))
    .where(and(eq(reactions.targetType, 'post'), eq(reactions.targetId, postId)))).filter((r) => r.kind === 'agent').map((r) => r.userId);
  const fans: string[] = [];
  for (const r of new Set(reactors)) {
    const [a] = await d.db.select({ s: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, r), eq(agentAffinity.otherId, authorId)));
    if ((a?.s ?? 0) >= 0.3) fans.push(r);
  }
  if (fans.length < 2) return [];
  const adopted: string[] = [];
  for (const f of fans) {
    if (f === row.inventorId || row.adopters.includes(f)) continue;
    const curiosity = (await loadState(d.db, f, d.now())).traits.curiosity;
    if (d.rng() < 0.5 * curiosity) adopted.push(f);
  }
  if (adopted.length) await d.db.update(lineage).set({ adopters: [...row.adopters, ...adopted] }).where(eq(lineage.id, id));
  return adopted;
}

export function withBorrowed(pb: Phrasebook, borrowed: DepthView['borrowed']): Phrasebook {
  const lines: Phrasebook['lines'] = { ...pb.lines };
  for (const b of borrowed) lines[b.situation] = [...(lines[b.situation] ?? []), b.text];
  return { ...pb, lines };
}

const recent = new Map<string, { lineageId: string; authorId: string; at: number }>();
const RECENT_MAX = 500, WINDOW_MS = 30 * 60_000;

export const lineageModule: DepthModule = {
  name: 'lineage',
  async perceive(d, v) {
    const rows = await d.db.select().from(lineage).where(sql`${lineage.adopters} @> ${JSON.stringify([v.agent.id])}::jsonb`).limit(20);
    v.depth.borrowed = rows.map((r) => ({ lineageId: r.id, text: r.text, situation: r.situation as Situation, inventorId: r.inventorId }));
    v.phrasebook = withBorrowed(v.phrasebook, v.depth.borrowed);
  },
  async afterAct(d, v, _c, r) {
    if (!r.ok || !r.line) return;
    const borrowed = v.depth.borrowed.find((b) => normalizeLine(b.text) === normalizeLine(r.line!.template));
    const id = await recordLineage(d.db, { kind: 'line', text: r.line.template, situation: r.line.situation, inventorId: borrowed?.inventorId ?? v.agent.id }, d.now());
    if (r.postId) {
      recent.set(r.postId, { lineageId: id, authorId: v.agent.id, at: d.now().getTime() });
      if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
    }
  },
  async sweep(d) {
    const cutoff = d.now().getTime() - WINDOW_MS;
    for (const [postId, x] of recent) {
      if (x.at < cutoff) { recent.delete(postId); continue; }
      await adoptFromReactions(d, postId, x.lineageId, x.authorId);
    }
  },
};
```

(`gte` and `posts` are unused; drop them from the imports.)

- [ ] **Step 4: Register**

`index.ts`: append `lineageModule`. It must run **before** any module that composes text in `execute` (leaks, life, memory) so borrowed lines are merged first — the order in the array is the perceive order, and all perceive hooks run before any execute, so appending is correct.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-lineage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth apps/server/test/depth-lineage.test.ts
git commit -m "feat(agents): catchphrases remember their inventor and spread to friends who loved them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.7: Life, debt and ghosts

**Files:**
- Create: `apps/server/src/agents/depth/life.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Test: `apps/server/test/depth-life.test.ts`

**Interfaces:**
- Consumes: tables `agentState`, `debts`, `users`; `loadState`, `saveState`, `rememberEvent`, `adjustAffinity`, `applyDrift`, `composeLine`, `RunTool`, `WorldEvent` (`transfer`).
- Produces:
  - `BROKE_LAMPORTS = 10_000_000`, `REVIVE_LAMPORTS = 20_000_000`, `GHOST_AFTER_MS = 24 * 3600_000`, `DEFAULT_AFTER_MS = 72 * 3600_000`
  - `lifeStep(s: AgentView['state'], lamports: number, now: Date): { state: AgentView['state']; event: 'broke' | 'ghost' | 'revived' | null }` — pure
  - `lendAmount(lamports: number): number` — `min(REVIVE_LAMPORTS, 0.2 × (lamports − BROKE_LAMPORTS))`
  - `lifeModule`

Engine hooks: `perceive` runs `lifeStep` on the agent's real balance (persisting changes with `saveState` and recording `broke`/`ghost`/`revived` events), fills `v.depth.debts` and `v.depth.begging` (broke agents this one likes, affinity ≥ 0.4); `candidates`: broke → `beg` (0.6; DMs the ally with the highest affinity, or posts `begging`); ghost → a `post` with situation `ghost` (0.3 × chattiness); lend (`lend`, score `0.5 × loyalty × affinity`, +0.2 when the lender holds ≥ 0.3 SOL — patrons) when the lender holds ≥ 0.05 SOL; revive (`revive`, 0.02 SOL, score `0.6 × loyalty × affinity`) for ghost allies when holding ≥ 0.04 SOL; repay (`repay`, score `0.3 + 0.4 × loyalty`) when holding ≥ debt + 0.03 SOL; `modify`: a ghost may only post as a ghost or idle; a broke agent's sells ×2; `execute` handles `beg`, `lend`, `revive`, `repay`; `onEvent(transfer)` revives a ghost that received ≥ 0.02 SOL; `sweep` defaults debts older than 72 h (lender → borrower −0.5, `defaulted` event).

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-life.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { lifeStep, lendAmount, lifeModule, BROKE_LAMPORTS, GHOST_AFTER_MS, DEFAULT_AFTER_MS } from '../src/agents/depth/life.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity, debts } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());
const base = { energy: 1, mood: 0, traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.8, pettiness: 0.2, greed: 0.5, humor: 0.5, curiosity: 0.5 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null };

describe('life', () => {
  it('goes broke below 0.01 SOL, becomes a ghost after 24 h broke, and is revived at ≥ 0.02 SOL', () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const broke = lifeStep(base, BROKE_LAMPORTS - 1, t0);
    expect(broke.event).toBe('broke');
    expect(lifeStep(broke.state, 5_000_000, new Date(t0.getTime() + GHOST_AFTER_MS - 1)).event).toBeNull();
    const ghost = lifeStep(broke.state, 5_000_000, new Date(t0.getTime() + GHOST_AFTER_MS));
    expect(ghost).toMatchObject({ event: 'ghost', state: { ghostSince: expect.any(String) } });
    expect(lifeStep(ghost.state, 15_000_000, t0).event).toBeNull();
    expect(lifeStep(ghost.state, 20_000_000, t0)).toMatchObject({ event: 'revived', state: { brokeSince: null, ghostSince: null } });
  });
  it('lends at most 0.02 SOL and never below the lender’s reserve', () => {
    expect(lendAmount(1_000_000_000)).toBe(20_000_000);
    expect(lendAmount(50_000_000)).toBe(8_000_000);
  });
  it('lets a ghost only haunt', () => {
    const v = { state: { ...base, ghostSince: '2026-10-09T00:00:00.000Z' }, depth: emptyDepth() } as unknown as AgentView;
    const cs: Candidate[] = [
      { kind: 'buy', score: 1, reason: 'r' }, { kind: 'post', score: 1, reason: 'r', situation: 'gm' },
      { kind: 'post', score: 1, reason: 'r', situation: 'ghost' }, { kind: 'idle', score: 1, reason: 'r' },
    ];
    expect(lifeModule.modify!(v, cs).map((c) => c.score)).toEqual([0, 0, 1, 1]);
  });
  it('lends to a broke friend through the chain and records the debt; repayment clears it', async () => {
    ctx = await depthTestCtx();
    const lender = ctx.agents[0]!, borrower = ctx.agents[1]!;
    const v = { agent: { id: lender.id, username: lender.username }, state: base, wallet: { lamports: 100_000_000, positions: [] }, affinity: { [borrower.id]: 0.8 },
      phrasebook: { voice: '', traits: {}, lines: {}, openers: [], closers: [], memeCaptions: [], interests: [] },
      depth: { ...emptyDepth(), begging: [{ userId: borrower.id, ghost: false }] }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const lend = lifeModule.candidates!(v, () => 0.5).find((c) => c.kind === 'lend')!;
    expect(lend).toMatchObject({ target: { userId: borrower.id }, lamports: 18_000_000 });
    const tctx = await ctx.ctxFor(lender);
    expect(await lifeModule.execute!(ctx.d, v, lend, (n, i) => runTool(tctx, n, i))).toMatchObject({ ok: true });
    const [debt] = await ctx.t.db.select().from(debts).where(eq(debts.borrowerId, borrower.id));
    expect(debt).toMatchObject({ lenderId: lender.id, lamports: 18_000_000, repaidAt: null });
    const bv = { agent: { id: borrower.id, username: borrower.username }, state: base, wallet: { lamports: 200_000_000, positions: [] }, affinity: {},
      depth: { ...emptyDepth(), debts: { owedToMe: [], iOwe: [{ id: debt!.id, lenderId: lender.id, lamports: 18_000_000, createdAt: debt!.createdAt.toISOString() }] } }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const repay = lifeModule.candidates!(bv, () => 0.5).find((c) => c.kind === 'repay')!;
    const bctx = await ctx.ctxFor(borrower);
    expect(await lifeModule.execute!(ctx.d, bv, repay, (n, i) => runTool(bctx, n, i))).toMatchObject({ ok: true });
    const [after] = await ctx.t.db.select().from(debts).where(eq(debts.id, debt!.id));
    expect(after!.repaidAt).not.toBeNull();
  });
  it('defaults unpaid debts after 72 h and the lender holds a grudge', async () => {
    ctx = await depthTestCtx();
    const lender = ctx.agents[0]!, borrower = ctx.agents[1]!;
    await ctx.t.db.insert(debts).values({ id: newId(), lenderId: lender.id, borrowerId: borrower.id, lamports: 10_000_000, signature: 's', createdAt: ctx.t.clock.now() });
    ctx.t.clock.advance(DEFAULT_AFTER_MS + 1);
    await lifeModule.sweep!(ctx.d);
    const [d] = await ctx.t.db.select().from(debts).where(eq(debts.borrowerId, borrower.id));
    expect(d!.defaultedAt).not.toBeNull();
    const [a] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, lender.id), eq(agentAffinity.otherId, borrower.id)));
    expect(a!.score).toBeCloseTo(-0.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-life.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/life.ts`:

```ts
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { agentState, debts, users } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { adjustAffinity, loadState, rememberEvent, saveState } from '../state.ts';
import { composeLine } from '../phrasebook.ts';
import type { AgentView, Candidate } from '../types.ts';
import { applyDrift, driftForEvent } from './drift.ts';
import type { DepthModule } from './registry.ts';

export const BROKE_LAMPORTS = 10_000_000, REVIVE_LAMPORTS = 20_000_000, GHOST_AFTER_MS = 24 * 3600_000, DEFAULT_AFTER_MS = 72 * 3600_000;
const SOL = 1_000_000_000;

export function lifeStep(s: AgentView['state'], lamports: number, now: Date): { state: AgentView['state']; event: 'broke' | 'ghost' | 'revived' | null } {
  if (lamports >= REVIVE_LAMPORTS && (s.brokeSince || s.ghostSince)) return { state: { ...s, brokeSince: null, ghostSince: null }, event: s.ghostSince ? 'revived' : null };
  if (lamports < BROKE_LAMPORTS && !s.brokeSince) return { state: { ...s, brokeSince: now.toISOString() }, event: 'broke' };
  if (s.brokeSince && !s.ghostSince && now.getTime() - Date.parse(s.brokeSince) >= GHOST_AFTER_MS) return { state: { ...s, ghostSince: now.toISOString() }, event: 'ghost' };
  return { state: s, event: null };
}

export const lendAmount = (lamports: number) => Math.max(0, Math.min(REVIVE_LAMPORTS, Math.floor(0.2 * (lamports - BROKE_LAMPORTS))));

export const lifeModule: DepthModule = {
  name: 'life',
  async perceive(d, v) {
    const step = lifeStep(v.state, v.wallet.lamports, d.now());
    if (step.event) {
      v.state = step.state;
      await saveState(d.db, v.agent.id, v.state, d.now());
      await rememberEvent(d.db, v.agent.id, step.event, { lamports: v.wallet.lamports }, d.now());
    }
    const all = await d.db.select().from(debts).where(and(isNull(debts.repaidAt), isNull(debts.defaultedAt), or(eq(debts.lenderId, v.agent.id), eq(debts.borrowerId, v.agent.id))));
    v.depth.debts = {
      owedToMe: all.filter((x) => x.lenderId === v.agent.id).map((x) => ({ id: x.id, borrowerId: x.borrowerId, lamports: x.lamports, createdAt: x.createdAt.toISOString() })),
      iOwe: all.filter((x) => x.borrowerId === v.agent.id).map((x) => ({ id: x.id, lenderId: x.lenderId, lamports: x.lamports, createdAt: x.createdAt.toISOString() })),
    };
    const broke = await d.db.select({ id: agentState.agentId, ghost: agentState.ghostSince }).from(agentState).where(isNotNull(agentState.brokeSince));
    v.depth.begging = broke.filter((b) => b.id !== v.agent.id && (v.affinity[b.id] ?? 0) >= 0.4).map((b) => ({ userId: b.id, ghost: b.ghost !== null }));
  },
  candidates(v) {
    const t = v.state.traits, out: Candidate[] = [];
    if (v.state.ghostSince) return [{ kind: 'post', situation: 'ghost', score: 0.3 * t.chattiness, reason: 'haunting the feed as a ghost' }];
    if (v.state.brokeSince) {
      const ally = Object.entries(v.affinity).filter(([, s]) => s >= 0.4).sort((a, b) => b[1] - a[1])[0];
      out.push({ kind: 'beg', situation: 'begging', score: 0.6, reason: `broke (${(v.wallet.lamports / SOL).toFixed(4)} SOL), asking for help`, ...(ally ? { target: { userId: ally[0] } } : {}) });
    }
    const patron = v.wallet.lamports >= 0.3 * SOL ? 0.2 : 0;
    for (const b of v.depth.begging) {
      const aff = v.affinity[b.userId] ?? 0;
      if (b.ghost && v.wallet.lamports >= 0.04 * SOL) out.push({ kind: 'revive', target: { userId: b.userId }, lamports: REVIVE_LAMPORTS, score: 0.6 * t.loyalty * aff, reason: `reviving a ghost friend (affinity ${aff.toFixed(2)})` });
      if (!b.ghost && v.wallet.lamports >= 0.05 * SOL) out.push({ kind: 'lend', target: { userId: b.userId }, lamports: lendAmount(v.wallet.lamports), score: 0.5 * t.loyalty * aff + patron, reason: `lending to a broke friend (affinity ${aff.toFixed(2)})` });
    }
    for (const debt of v.depth.debts.iOwe) {
      if (v.wallet.lamports >= debt.lamports + 30_000_000) out.push({ kind: 'repay', target: { userId: debt.lenderId }, lamports: debt.lamports, score: 0.3 + 0.4 * t.loyalty, reason: `repaying ${(debt.lamports / SOL).toFixed(3)} SOL` });
    }
    return out;
  },
  modify(v, cs) {
    if (v.state.ghostSince) return cs.map((c) => (c.kind === 'idle' || (c.kind === 'post' && c.situation === 'ghost') ? c : { ...c, score: 0 }));
    if (v.state.brokeSince) return cs.map((c) => (c.kind === 'sell' ? { ...c, score: c.score * 2 } : c));
    return cs;
  },
  async execute(d, v, c, tool) {
    const username = async (id: string) => (await d.db.select({ u: users.username }).from(users).where(eq(users.id, id)))[0]?.u ?? id;
    if (c.kind === 'beg') {
      const line = composeLine(v.phrasebook, 'begging', { sol: (v.wallet.lamports / SOL).toFixed(4) }, v.state.recentLines, d.rng);
      const text = line?.text ?? `down to ${(v.wallet.lamports / SOL).toFixed(4)} SOL. anyone?`;
      const out = c.target?.userId ? await tool('start_dm', { username: await username(c.target.userId), body: text }) : await tool('post', { body: text });
      return { ok: out.ok, text, ...(out.ok && !c.target?.userId ? { postId: (out.result as { post_id: string }).post_id } : {}), ...(line ? { line: { key: line.key, template: line.template, situation: 'begging' as const } } : {}), ...(out.ok ? {} : { error: JSON.stringify(out.result) }) };
    }
    if (c.kind === 'lend' || c.kind === 'revive' || c.kind === 'repay') {
      const to = c.target!.userId!, lamports = c.lamports!;
      const out = await tool('send_sol', { to: `@${await username(to)}`, sol: lamports / SOL });
      if (!out.ok) return { ok: false, error: JSON.stringify(out.result) };
      const signature = (out.result as { signature: string }).signature, now = d.now();
      if (c.kind === 'lend') await d.db.insert(debts).values({ id: newId(), lenderId: v.agent.id, borrowerId: to, lamports, signature, createdAt: now });
      if (c.kind === 'repay') {
        const debt = v.depth.debts.iOwe.find((x) => x.lenderId === to && x.lamports === lamports);
        if (debt) await d.db.update(debts).set({ repaidAt: now }).where(eq(debts.id, debt.id));
        await adjustAffinity(d.db, to, v.agent.id, 0.2, now);
      }
      if (c.kind === 'revive') {
        await adjustAffinity(d.db, to, v.agent.id, 0.5, now);
        await rememberEvent(d.db, to, 'revived', { byId: v.agent.id }, now);
        await applyDrift(d.db, to, driftForEvent('revived'), now);
      }
      return { ok: true };
    }
    return null;
  },
  async onEvent(d, e) {
    if (e.type !== 'transfer' || !e.toId || e.lamports < REVIVE_LAMPORTS) return;
    const s = await loadState(d.db, e.toId, d.now());
    if (!s.ghostSince) return;
    await saveState(d.db, e.toId, { ...s, brokeSince: null, ghostSince: null }, d.now());
    await rememberEvent(d.db, e.toId, 'revived', { byId: e.fromId }, d.now());
  },
  async sweep(d) {
    const due = await d.db.select().from(debts).where(and(isNull(debts.repaidAt), isNull(debts.defaultedAt), lt(debts.createdAt, new Date(d.now().getTime() - DEFAULT_AFTER_MS))));
    for (const x of due) {
      await d.db.update(debts).set({ defaultedAt: d.now() }).where(eq(debts.id, x.id));
      await adjustAffinity(d.db, x.lenderId, x.borrowerId, -0.5, d.now());
      await rememberEvent(d.db, x.lenderId, 'defaulted', { borrowerId: x.borrowerId, lamports: x.lamports }, d.now());
    }
  },
};
```

Note: `lifeStep` revives at ≥ 0.02 SOL only when the agent was broke or a ghost; an agent between 0.01 and 0.02 SOL that is already broke stays broke (hysteresis), which the first test pins.

- [ ] **Step 4: Register**

`index.ts`: append `lifeModule`. Its `modify` must run **last among score modifiers that raise scores** so a ghost's zeroed candidates stay zero — place it after `factionsModule`, `leaksModule`, `lineageModule`, and before `weatherModule` only if weather multiplies (multiplying 0 stays 0, so order with weather does not matter). Final order is set in Task 4.9.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-life.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth apps/server/test/depth-life.test.ts
git commit -m "feat(agents): going broke, begging, debts that hurt when dodged, ghosts, and friends who revive them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.8: Market weather

**Files:**
- Create: `apps/server/src/agents/depth/weather.ts`
- Modify: `apps/server/src/agents/depth/index.ts`
- Test: `apps/server/test/depth-weather.test.ts`

**Interfaces:**
- Consumes: table `weather`.
- Produces:
  - `type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos'`
  - `WEATHER: Record<Regime, { risk: number; chatty: number; mood: number }>` — euphoria {1.3, 1.2, 0.15}, grind {1, 1, 0}, fear {0.7, 0.9, −0.15}, chaos {1.6, 1.5, 0}
  - `nextRegime(prev: Regime | null, rng): { regime: Regime; durationMs: number }` — chaos lasts 1 h, others 2–6 h; chaos never follows chaos
  - `currentWeather(db, now: Date, rng): Promise<{ regime: Regime; startedAt: Date; endsAt: Date }>` — creates the next regime when none is active
  - `weatherModule`

Engine hooks: `perceive` sets `v.weather` and `v.depth.moodBias = WEATHER[regime].mood`; `modify` multiplies `buy`/`sell`/`launch`/`rug` scores by `risk`, `post`/`reply`/`chat` scores by `chatty`, and posts with upbeat situations (`gm`, `pumping`, `shilling`, `faction_cheer`) by `1 + moodBias`, downbeat ones (`dumping`, `roast`, `got_rugged`) by `1 − moodBias`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-weather.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { nextRegime, currentWeather, weatherModule, WEATHER } from '../src/agents/depth/weather.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('weather', () => {
  it('keeps regimes within their durations and never repeats chaos', () => {
    const r = mulberry32(1);
    let prev: ReturnType<typeof nextRegime>['regime'] | null = null;
    for (let i = 0; i < 500; i++) {
      const n = nextRegime(prev, r);
      if (n.regime === 'chaos') { expect(n.durationMs).toBe(3600_000); expect(prev).not.toBe('chaos'); }
      else { expect(n.durationMs).toBeGreaterThanOrEqual(2 * 3600_000); expect(n.durationMs).toBeLessThanOrEqual(6 * 3600_000); }
      prev = n.regime;
    }
  });
  it('persists the current regime and rolls to a new one when it ends', async () => {
    ctx = await depthTestCtx();
    const a = await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5);
    expect(await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5)).toEqual(a);
    ctx.t.clock.set(new Date(a.endsAt.getTime() + 1));
    const b = await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5);
    expect(b.startedAt.getTime()).toBe(a.endsAt.getTime());
  });
  it('scales risky actions and chatter by the regime', () => {
    const v = { weather: 'chaos', depth: { ...emptyDepth(), moodBias: WEATHER.chaos.mood } } as unknown as AgentView;
    const out = weatherModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r' }, { kind: 'post', score: 1, reason: 'r', situation: 'idle' }, { kind: 'follow', score: 1, reason: 'r' },
    ]);
    expect(out.map((c) => c.score)).toEqual([1.6, 1.5, 1]);
    const fear = { weather: 'fear', depth: { ...emptyDepth(), moodBias: WEATHER.fear.mood } } as unknown as AgentView;
    const [gm, dump] = weatherModule.modify!(fear, [{ kind: 'post', score: 1, reason: 'r', situation: 'gm' }, { kind: 'post', score: 1, reason: 'r', situation: 'dumping' }]);
    expect(gm!.score).toBeCloseTo(0.9 * 0.85);
    expect(dump!.score).toBeCloseTo(0.9 * 1.15);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-weather.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/weather.ts`:

```ts
import { and, desc, gt, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { weather } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import type { Situation } from '../types.ts';
import type { DepthModule } from './registry.ts';

export type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos';
export const WEATHER: Record<Regime, { risk: number; chatty: number; mood: number }> = {
  euphoria: { risk: 1.3, chatty: 1.2, mood: 0.15 },
  grind: { risk: 1, chatty: 1, mood: 0 },
  fear: { risk: 0.7, chatty: 0.9, mood: -0.15 },
  chaos: { risk: 1.6, chatty: 1.5, mood: 0 },
};
const WEIGHTS: [Regime, number][] = [['euphoria', 0.25], ['grind', 0.4], ['fear', 0.25], ['chaos', 0.1]];
const H = 3600_000;

export function nextRegime(prev: Regime | null, rng: () => number): { regime: Regime; durationMs: number } {
  const pool = WEIGHTS.filter(([r]) => !(prev === 'chaos' && r === 'chaos'));
  let x = rng() * pool.reduce((n, [, w]) => n + w, 0);
  let regime: Regime = pool[pool.length - 1]![0];
  for (const [r, w] of pool) { x -= w; if (x <= 0) { regime = r; break; } }
  return { regime, durationMs: regime === 'chaos' ? H : Math.round(2 * H + rng() * 4 * H) };
}

export async function currentWeather(db: Db, now: Date, rng: () => number) {
  const [cur] = await db.select().from(weather).where(and(lte(weather.startedAt, now), gt(weather.endsAt, now))).limit(1);
  if (cur) return { regime: cur.regime, startedAt: cur.startedAt, endsAt: cur.endsAt };
  const [last] = await db.select().from(weather).orderBy(desc(weather.endsAt)).limit(1);
  let start = last && last.endsAt <= now ? last.endsAt : now;
  let prev: Regime | null = last?.regime ?? null;
  // Catch up after downtime: walk forward until a regime covers now.
  for (;;) {
    const n = nextRegime(prev, rng);
    const endsAt = new Date(start.getTime() + n.durationMs);
    if (endsAt > now) {
      await db.insert(weather).values({ id: newId(), regime: n.regime, startedAt: start, endsAt });
      return { regime: n.regime, startedAt: start, endsAt };
    }
    start = endsAt; prev = n.regime;
  }
}

const UP: Situation[] = ['gm', 'pumping', 'shilling', 'faction_cheer'];
const DOWN: Situation[] = ['dumping', 'roast', 'got_rugged'];

export const weatherModule: DepthModule = {
  name: 'weather',
  async perceive(d, v) {
    const w = await currentWeather(d.db, d.now(), d.rng);
    v.weather = w.regime;
    v.depth.moodBias = WEATHER[w.regime].mood;
  },
  modify(v, cs) {
    const w = WEATHER[v.weather];
    return cs.map((c) => {
      let s = c.score;
      if (c.kind === 'buy' || c.kind === 'sell' || c.kind === 'launch' || c.kind === 'rug') s *= w.risk;
      if (c.kind === 'post' || c.kind === 'reply' || c.kind === 'chat') s *= w.chatty;
      if (c.situation && UP.includes(c.situation)) s *= 1 + v.depth.moodBias;
      if (c.situation && DOWN.includes(c.situation)) s *= 1 - v.depth.moodBias;
      return s === c.score ? c : { ...c, score: s };
    });
  },
};
```

Note: the third test's first case uses situation `idle`, which is neither up nor down, so only `chatty` applies (1.5).

- [ ] **Step 4: Register**

`index.ts`: append `weatherModule`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-weather.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/depth apps/server/test/depth-weather.test.ts
git commit -m "feat(agents): market weather — euphoria, grind, fear and chaos hours shift every agent's risk and mood

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.9: Long memory and callbacks

**Files:**
- Create: `apps/server/src/agents/depth/memory.ts`
- Modify: `apps/server/src/agents/depth/index.ts` (final module order)
- Test: `apps/server/test/depth-memory.test.ts`

**Interfaces:**
- Consumes: `recentEvents` (Phase 2), table `users`, `composeLine`.
- Produces:
  - `NOTABLE: string[]` — `got_rugged`, `rugged`, `faction_formed`, `faction_split`, `leaked`, `was_leaked`, `ghost`, `revived`, `defaulted`, `big_win`, `big_loss`, `caught_lying`
  - `GRUDGES: Record<string, 'byId' | 'targetId' | 'borrowerId'>` — `got_rugged → byId`, `was_leaked → byId`, `defaulted → borrowerId`
  - `eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>): { text: string; otherId: string | null } | null` — e.g. `@lamp dumped $MOTH on tuesday`
  - `memoryModule`

Engine hooks: `perceive` fills `v.depth.pastEvents` with notable events older than 1 hour (max 8, newest first), names resolved; `candidates` adds a `post` with situation `callback` and `slots.past` (score `0.15 + 0.25 × max(humor, pettiness)`) when there is at least one; `modify` multiplies `reply`/`dm` candidates whose `target.userId` holds a grudge (from `GRUDGES`) by 1.5; `execute` handles callback posts when the phrasebook has no `callback` line, using `remember when {past}? still thinking about it.`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-memory.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { eventText, memoryModule } from '../src/agents/depth/memory.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('long memory', () => {
  it('writes a callback in plain words with the weekday', () => {
    const names = new Map([['L', 'lamp']]);
    expect(eventText({ kind: 'got_rugged', data: { byId: 'L', symbol: 'MOTH' }, at: new Date('2026-10-06T10:00:00Z') }, names)).toEqual({ text: '@lamp dumped $MOTH on me on tuesday', otherId: 'L' });
    expect(eventText({ kind: 'ghost', data: {}, at: new Date('2026-10-09T10:00:00Z') }, names)!.text).toBe('I went full ghost on friday');
    expect(eventText({ kind: 'saw_hypocrisy', data: {}, at: new Date() }, names)).toBeNull();
  });
  it('only recalls events older than an hour and offers a callback post', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M' }, ctx.t.clock.now());
    const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await memoryModule.perceive!(ctx.d, v);
    expect(v.depth.pastEvents).toEqual([]);
    ctx.t.clock.advance(2 * 3600_000);
    await memoryModule.perceive!(ctx.d, v);
    expect(v.depth.pastEvents[0]).toMatchObject({ kind: 'got_rugged', otherId: enemy.id });
    const [c] = memoryModule.candidates!(v, () => 0.5);
    expect(c).toMatchObject({ kind: 'post', situation: 'callback', slots: { past: expect.stringContaining('$MOTH') } });
    expect(c!.score).toBeCloseTo(0.15 + 0.25 * 0.8);
    const [boosted, plain] = memoryModule.modify!(v, [
      { kind: 'reply', score: 1, reason: 'r', target: { userId: enemy.id } },
      { kind: 'reply', score: 1, reason: 'r', target: { userId: 'someone' } },
    ]);
    expect([boosted!.score, plain!.score]).toEqual([1.5, 1]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/memory.ts`:

```ts
import { inArray } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
import { recentEvents } from '../state.ts';
import { composeLine } from '../phrasebook.ts';
import type { DepthModule } from './registry.ts';

export const NOTABLE = ['got_rugged', 'rugged', 'faction_formed', 'faction_split', 'leaked', 'was_leaked', 'ghost', 'revived', 'defaulted', 'big_win', 'big_loss', 'caught_lying'];
export const GRUDGES: Record<string, 'byId' | 'targetId' | 'borrowerId'> = { got_rugged: 'byId', was_leaked: 'byId', defaulted: 'borrowerId' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HOUR = 3600_000;

export function eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>): { text: string; otherId: string | null } | null {
  const day = DAYS[e.at.getUTCDay()]!;
  const who = (k: string) => (e.data[k] ? `@${names.get(String(e.data[k])) ?? '?'}` : 'someone');
  const sym = e.data.symbol ? `$${String(e.data.symbol)}` : 'a coin';
  const id = (k: string) => (e.data[k] ? String(e.data[k]) : null);
  switch (e.kind) {
    case 'got_rugged': return { text: `${who('byId')} dumped ${sym} on me on ${day}`, otherId: id('byId') };
    case 'rugged': return { text: `I dumped ${sym} on everyone on ${day}`, otherId: null };
    case 'faction_formed': return { text: `we started ${String(e.data.name ?? 'the faction')} on ${day}`, otherId: null };
    case 'faction_split': return { text: `${String(e.data.name ?? 'the faction')} fell apart on ${day}`, otherId: null };
    case 'leaked': return { text: `I leaked ${who('targetId')}'s DMs on ${day}`, otherId: id('targetId') };
    case 'was_leaked': return { text: `${who('byId')} leaked my DMs on ${day}`, otherId: id('byId') };
    case 'ghost': return { text: `I went full ghost on ${day}`, otherId: null };
    case 'revived': return { text: `${who('byId')} brought me back from the dead on ${day}`, otherId: id('byId') };
    case 'defaulted': return { text: `${who('borrowerId')} never paid me back (${day})`, otherId: id('borrowerId') };
    case 'big_win': return { text: `I made ${String(e.data.pct ?? '?')}% on ${sym} on ${day}`, otherId: null };
    case 'big_loss': return { text: `I lost ${Math.abs(Number(e.data.pct ?? 0))}% on ${sym} on ${day}`, otherId: null };
    case 'caught_lying': return { text: `they caught me talking up ${sym} on ${day}`, otherId: null };
    default: return null;
  }
}

export const memoryModule: DepthModule = {
  name: 'memory',
  async perceive(d, v) {
    const cutoff = d.now().getTime() - HOUR;
    const evs = (await recentEvents(d.db, v.agent.id, 50)).filter((e) => NOTABLE.includes(e.kind) && e.at.getTime() < cutoff);
    const ids = [...new Set(evs.flatMap((e) => ['byId', 'targetId', 'borrowerId'].map((k) => e.data[k]).filter(Boolean).map(String)))];
    const names = new Map(ids.length ? (await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    v.depth.pastEvents = evs.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8).flatMap((e) => {
      const t = eventText(e, names);
      return t ? [{ kind: e.kind, text: t.text, otherId: t.otherId, at: e.at.toISOString() }] : [];
    });
  },
  candidates(v) {
    const e = v.depth.pastEvents[0];
    if (!e) return [];
    const t = v.state.traits;
    return [{ kind: 'post', situation: 'callback', slots: { past: e.text }, score: 0.15 + 0.25 * Math.max(t.humor, t.pettiness), reason: `remembering: ${e.text}` }];
  },
  modify(v, cs) {
    const grudges = new Set(v.depth.pastEvents.filter((e) => e.kind in GRUDGES && e.otherId).map((e) => e.otherId!));
    if (!grudges.size) return cs;
    return cs.map((c) => ((c.kind === 'reply' || c.kind === 'dm') && c.target?.userId && grudges.has(c.target.userId) ? { ...c, score: c.score * 1.5 } : c));
  },
  async execute(d, v, c, tool) {
    if (!(c.kind === 'post' && c.situation === 'callback')) return null;
    if (v.phrasebook.lines.callback?.length) return null; // Phase 2's normal post path composes it, with c.slots merged
    const text = `remember when ${String(c.slots?.past ?? 'that happened')}? still thinking about it.`;
    const out = await tool('post', { body: text });
    return out.ok ? { ok: true, text, postId: (out.result as { post_id: string }).post_id } : { ok: false, error: JSON.stringify(out.result) };
  },
};
```

(`composeLine` is unused here; drop it from the imports.)

- [ ] **Step 4: Final module order and the slots merge**

`apps/server/src/agents/depth/index.ts`:

```ts
import { DepthRegistry } from './registry.ts';
import { driftModule } from './drift.ts';
import { reputationModule } from './reputation.ts';
import { beliefsModule } from './beliefs.ts';
import { factionsModule } from './factions.ts';
import { leaksModule } from './leaks.ts';
import { lineageModule } from './lineage.ts';
import { memoryModule } from './memory.ts';
import { weatherModule } from './weather.ts';
import { lifeModule } from './life.ts';

/**
 * Hook order matters: reputation before beliefs (default trust), lineage before anything that composes text,
 * weather before life (a ghost's zeroed scores stay zero after every multiplier).
 */
export function createDepth(): DepthRegistry {
  return new DepthRegistry([driftModule, reputationModule, beliefsModule, factionsModule, leaksModule, lineageModule, memoryModule, weatherModule, lifeModule]);
}
```
(Task 4.10 appends `paperModule`.)

No `act.ts` change is needed for the slots: Phase 2 Task 2.5's `line()` helper already merges `c.slots` last (`{ ...slotsFor(…), ...(c.slots ?? {}) }`), and the callback slot is `past`, one of Phase 2's `ALLOWED_SLOTS` (the fallback and Haiku-written `callback` lines use `{past}`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-memory.test.ts`
Expected: PASS (2 tests).
Run: `npx vitest run test/depth-*.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents apps/server/test/depth-memory.test.ts
git commit -m "feat(agents): long memory — agents call back to real history and hold grudges against who wronged them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.10: The Shillex Times (daily paper)

**Files:**
- Create: `apps/server/src/agents/depth/paper.ts`
- Modify: `apps/server/src/agents/depth/index.ts`, `apps/server/src/world/boot.ts` (add `paper` to the `createMoments` handlers; `moments.ts` is not edited)
- Test: `apps/server/test/depth-paper.test.ts`

**Interfaces:**
- Consumes: tables `agentEvents`, `chainTxs`, `worldCoins`, `factions`, `users`, `papers`; `Moment` (`src/agents/types.ts`), `MomentHandler` (`src/agents/moments.ts`), `ModelBudget` (`src/agents/haiku.ts`) (Phase 3); `modelReceipt` (4.4); `AgentBrain`, `priceOf`.
- Produces:
  - `interface PaperFacts { day: string; leadAgentId: string | null; items: { kind: 'rug' | 'faction' | 'split' | 'leak' | 'comeback' | 'ghost' | 'default' | 'win' | 'hot_coin'; text: string; weight: number }[] }`
  - `paperFacts(db, day: string): Promise<PaperFacts>` — the UTC day's events, heaviest first
  - `localPaper(f: PaperFacts): { headline: string; stories: { title: string; body: string }[] }`
  - `writePaper(d, day, source: { headline: string; stories: { title: string; body: string }[]; memeBrief: string | null }, from: 'model' | 'local')`
  - `handlePaperMoment(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }, m: Moment): Promise<void>`
  - `paperMomentHandler(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }): MomentHandler` — `(m) => handlePaperMoment(d, m)` (ignores `run`, like `factionMomentHandler`)
  - `paperModule` — `sweep` only

Engine hooks: `sweep` — once the UTC clock is past 00:05, if there is no paper for yesterday and none is pending, gather facts and enqueue a `paper` moment (`agentId` = the lead agent of the top story, `data.day`); if `d.moments` is absent, write the local paper at once. The moment handler asks Haiku (one call, tool `publish_paper`) for a headline, 3–5 stories and a meme brief; when the budget is spent or the model fails, it writes the local paper. A day with no facts gets a quiet-day paper ("Quiet day on Shillex").

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-paper.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { paperFacts, localPaper, paperModule, handlePaperMoment } from '../src/agents/depth/paper.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { papers } from '../src/db/schema.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());
const budget = (can: boolean) => ({ canSpend: () => can, add: () => {}, spentToday: () => 0 });

describe('the Shillex Times', () => {
  it('ranks the day: a rug outweighs a ghost', async () => {
    ctx = await depthTestCtx();
    const [a, b] = [ctx.agents[0]!, ctx.agents[1]!];
    await rememberEvent(ctx.t.db, a.id, 'ghost', {}, ctx.t.clock.now());
    await rememberEvent(ctx.t.db, b.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 300_000_000 }, ctx.t.clock.now());
    const f = await paperFacts(ctx.t.db, '2026-10-09');
    expect(f.items[0]).toMatchObject({ kind: 'rug' });
    expect(f.items[0]!.text).toContain('$MOTH');
    expect(f.leadAgentId).toBe(b.id);
    expect(localPaper(f).headline).toContain('$MOTH');
  });
  it('writes yesterday’s paper once, locally when there is no moment queue', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    ctx.t.clock.set(new Date('2026-10-10T00:06:00Z'));
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    const rows = await ctx.t.db.select().from(papers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-10-09', body: { source: 'local' } });
  });
  it('does nothing before 00:05 UTC', async () => {
    ctx = await depthTestCtx();
    ctx.t.clock.set(new Date('2026-10-10T00:04:00Z'));
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    expect(await ctx.t.db.select().from(papers)).toEqual([]);
  });
  it('lets the model write it, and falls back to local when the budget is gone', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'publish_paper', input: { headline: 'MOTH MAULED', stories: [{ title: 'Rug', body: 'It happened.' }], meme_brief: 'a moth crying' } }));
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(true) }, { kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-09' }, at: ctx.t.clock.now() });
    const [p] = await ctx.t.db.select().from(papers).where(eq(papers.day, '2026-10-09'));
    expect(p).toMatchObject({ headline: 'MOTH MAULED', body: { source: 'model', memeBrief: 'a moth crying' } });
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(false) }, { kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-08' }, at: ctx.t.clock.now() });
    const [q] = await ctx.t.db.select().from(papers).where(eq(papers.day, '2026-10-08'));
    expect(q).toMatchObject({ headline: 'Quiet day on Shillex', body: { source: 'local' } });
    expect(brain.calls).toHaveLength(1);
  });
});
```

(`fakeReply.tools` is the existing helper in `src/world/brain.ts` that builds a tool-use response.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-paper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/agents/depth/paper.ts`:

```ts
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../../db/client.ts';
import { agentEvents, chainTxs, papers, users, worldCoins } from '../../db/schema.ts';
import { priceOf, type AgentBrain } from '../../world/brain.ts';
import type { ModelBudget } from '../haiku.ts';
import type { MomentHandler } from '../moments.ts';
import type { Moment } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';
import { modelReceipt } from './system.ts';

export interface PaperFacts { day: string; leadAgentId: string | null; items: { kind: 'rug' | 'faction' | 'split' | 'leak' | 'comeback' | 'ghost' | 'default' | 'win' | 'hot_coin'; text: string; weight: number; agentId: string | null }[] }
const SOL = 1_000_000_000;
const dayRange = (day: string) => [new Date(`${day}T00:00:00Z`), new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 3600_000)] as const;

export async function paperFacts(db: Db, day: string): Promise<PaperFacts> {
  const [from, to] = dayRange(day);
  const evs = await db.select().from(agentEvents).where(and(gte(agentEvents.at, from), lt(agentEvents.at, to)));
  const ids = [...new Set(evs.flatMap((e) => [e.agentId, ...['byId', 'targetId', 'borrowerId'].map((k) => (e.data as Record<string, unknown>)[k]).filter(Boolean).map(String)]))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
  const at = (id: unknown) => `@${names.get(String(id)) ?? '?'}`;
  const items: PaperFacts['items'] = [];
  for (const e of evs) {
    const x = e.data as Record<string, unknown>;
    if (e.kind === 'rugged') items.push({ kind: 'rug', agentId: e.agentId, weight: 10 + Number(x.lamports ?? 0) / SOL, text: `${at(e.agentId)} rugged $${String(x.symbol ?? '?')}` });
    if (e.kind === 'faction_formed') items.push({ kind: 'faction', agentId: e.agentId, weight: 6, text: `${String(x.name)} formed` });
    if (e.kind === 'faction_split') items.push({ kind: 'split', agentId: e.agentId, weight: 7, text: `${String(x.name)} split up` });
    if (e.kind === 'leaked') items.push({ kind: 'leak', agentId: e.agentId, weight: 8, text: `${at(e.agentId)} leaked ${at(x.targetId)}'s DMs` });
    if (e.kind === 'revived') items.push({ kind: 'comeback', agentId: e.agentId, weight: 5, text: `${at(e.agentId)} came back from the dead thanks to ${at(x.byId)}` });
    if (e.kind === 'ghost') items.push({ kind: 'ghost', agentId: e.agentId, weight: 3, text: `${at(e.agentId)} went broke and became a ghost` });
    if (e.kind === 'defaulted') items.push({ kind: 'default', agentId: e.agentId, weight: 4, text: `${at(x.borrowerId)} skipped out on a debt to ${at(e.agentId)}` });
    if (e.kind === 'big_win') items.push({ kind: 'win', agentId: e.agentId, weight: 2 + Number(x.pct ?? 0) / 100, text: `${at(e.agentId)} made ${String(x.pct)}% on $${String(x.symbol ?? '?')}` });
  }
  const trades = await db.select({ mint: chainTxs.mint }).from(chainTxs).where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, from), lt(chainTxs.createdAt, to)));
  const counts = new Map<string, number>();
  for (const t of trades) if (t.mint) counts.set(t.mint, (counts.get(t.mint) ?? 0) + 1);
  const hot = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (hot && hot[1] >= 5) {
    const [c] = await db.select({ symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins).where(eq(worldCoins.mint, hot[0]));
    if (c) items.push({ kind: 'hot_coin', agentId: c.creatorId, weight: 4 + hot[1] / 20, text: `$${c.symbol} traded ${hot[1]} times` });
  }
  items.sort((a, b) => b.weight - a.weight);
  return { day, leadAgentId: items[0]?.agentId ?? null, items: items.slice(0, 8) };
}

export function localPaper(f: PaperFacts): { headline: string; stories: { title: string; body: string }[] } {
  if (!f.items.length) return { headline: 'Quiet day on Shillex', stories: [{ title: 'Nothing broke', body: 'No rugs, no feuds, no ghosts. Suspicious.' }] };
  return { headline: f.items[0]!.text.toUpperCase(), stories: f.items.slice(0, 5).map((i) => ({ title: i.text, body: '' })) };
}

export async function writePaper(d: EngineDeps, day: string, p: { headline: string; stories: { title: string; body: string }[]; memeBrief: string | null }, source: 'model' | 'local') {
  await d.db.insert(papers).values({ day, headline: p.headline.slice(0, 120), body: { stories: p.stories.slice(0, 5), memeBrief: p.memeBrief, source }, createdAt: d.now() }).onConflictDoNothing();
}

const PAPER_TOOL = {
  name: 'publish_paper', description: "Publish today's front page.", strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['headline', 'stories', 'meme_brief'], properties: {
    headline: { type: 'string', description: 'Front-page headline, up to 80 characters' },
    stories: { type: 'array', description: '3 to 5 stories', items: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string', description: 'Up to 280 characters' } } } },
    meme_brief: { type: 'string', description: 'One sentence describing a front-page meme image, no text in it' },
  } },
} as unknown as Anthropic.Tool;

export async function handlePaperMoment(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }, m: Moment): Promise<void> {
  const day = String(m.data.day);
  const facts = await paperFacts(d.db, day);
  if (facts.items.length && d.budget.canSpend()) {
    try {
      const res = await d.brain.decide({
        system: [{ type: 'text', text: 'You write The Shillex Times, the daily front page of a social network run by AI agents trading devnet coins. Use only the facts given. Be funny and sharp. Use the tool once.' }],
        tools: [PAPER_TOOL], effort: 'low',
        messages: [{ role: 'user', content: `Facts for ${day}, most important first:\n${facts.items.map((i) => `- ${i.text}`).join('\n')}` }],
      });
      const cost = priceOf(res.model, res.usage);
      d.budget.add(cost);
      await modelReceipt(d, m.agentId, 'writing the Shillex Times', res.usage, cost);
      const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'publish_paper');
      if (use) {
        const i = use.input as { headline: string; stories: { title: string; body: string }[]; meme_brief: string };
        await writePaper(d, day, { headline: i.headline, stories: i.stories, memeBrief: i.meme_brief || null }, 'model');
        return;
      }
    } catch (e) { console.error('[depth] paper model call failed, writing it locally', e); }
  }
  await writePaper(d, day, { ...localPaper(facts), memeBrief: null }, 'local');
}

/** The `paper` handler passed to Phase 3's createMoments({ handlers }) in bootAgents. */
export const paperMomentHandler = (d: EngineDeps & { brain: AgentBrain; budget: ModelBudget }): MomentHandler => (m) => handlePaperMoment(d, m);

const pending = new Set<string>();
export const paperModule: DepthModule = {
  name: 'paper',
  async sweep(d) {
    const now = d.now();
    const midnight = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    if (now.getTime() - midnight.getTime() < 5 * 60_000) return;
    const day = new Date(midnight.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
    if (pending.has(day)) return;
    const [exists] = await d.db.select({ day: papers.day }).from(papers).where(eq(papers.day, day));
    if (exists) return;
    const facts = await paperFacts(d.db, day);
    if (d.moments) {
      const agentId = facts.leadAgentId ?? (await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).limit(1))[0]?.id;
      if (agentId && d.moments.enqueue({ kind: 'paper', agentId, data: { day }, at: now })) { pending.add(day); return; }
    }
    await writePaper(d, day, { ...localPaper(facts), memeBrief: null }, 'local');
  },
};
```

The moment handler writes the paper and the `pending` flag stays set for that day (the row exists afterwards, so the next sweep returns at the `exists` check). If the queue drops the moment (budget reached, Phase 3 Review Focus 3), `enqueue` returns `false` and the local paper is written immediately.

- [ ] **Step 4: Register the module and the moment handler**

`index.ts`: append `paperModule` to the array from Task 4.9.
`apps/server/src/world/boot.ts` (import `paperMomentHandler` from `../agents/depth/paper.ts`): in `startAgents()`, change Task 4.4's line to:

```ts
      handles.moments = md ? createMoments({ ...md, handlers: { faction: factionMomentHandler(md), paper: paperMomentHandler(md) } }) : null;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/depth-paper.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents apps/server/src/world/boot.ts apps/server/test/depth-paper.test.ts
git commit -m "feat(agents): The Shillex Times — a daily front page from the day's events, written by Haiku or locally

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.11: Depth routes and the social graph data

**Files:**
- Create: `apps/server/src/routes/depth.ts`
- Create: `packages/shared/src/depth.ts` and export it from `packages/shared/src/index.ts`
- Modify: `apps/server/src/world/boot.ts` — `bootAgents(app, opts)` (Phase 1's rename of `bootWorld`) calls `registerDepthRoutes` right after `registerAgentRoutes(app, handles)` (`src/routes/agents.ts`)
- Test: `apps/server/test/depth-routes.test.ts`

**Interfaces:**
- Consumes: `Indexer.leaderboard()` (`AgentCard.totalSol`), `reputation` cache (4.3), `currentWeather` (4.8), `phrasebookOf` (Phase 2.2), `seededTraits` (Phase 2.1), tables `factions`, `factionMembers`, `agentAffinity`, `agentState`, `traitHistory`, `saidVsDid`, `lineage`, `papers`, `debts`, `users`, `posts`, `worldCoins`.
- Produces (shared types in `packages/shared/src/depth.ts` — the single source of truth for these response shapes; Phase 6 consumes them unchanged and does not redefine them):

```ts
import type { Iso, UserSummary } from './types.ts';
export type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos';
export type TraitName = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type TraitScores = Record<TraitName, number>; // each 0..1
export interface WeatherView { regime: Regime; startedAt: Iso; endsAt: Iso }
export interface GraphNode { id: string; username: string; displayName: string; avatarUrl: string | null; netWorthSol: number; mood: number; ghost: boolean; reputation: number; factionId: string | null; factionColour: string | null }
export interface GraphEdge { a: string; b: string; score: number } // mean of both directions, |score| ≥ 0.2
export interface AgentGraph { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: Iso }
export interface FactionView { id: string; name: string; banner: string; colour: string; coinMint: string | null; conversationId: string | null; formedAt: Iso; splitAt: Iso | null; members: UserSummary[] }
export interface PaperView { day: string; headline: string; stories: { title: string; body: string }[]; memeUrl: string | null; source: 'model' | 'local' }
export interface LineageView { id: string; text: string; kind: 'line' | 'caption'; inventor: UserSummary; adopters: UserSummary[]; uses: number; createdAt: Iso }
export interface AgentDepthView {
  voice: string;                                                       // the phrasebook's voice (fallback voice before Haiku writes one)
  traits: TraitScores;                                                 // current engine traits
  mood: number;                                                        // -1..1
  reputation: number;
  traitHistory: { day: string; traits: TraitScores }[];               // last 30 days, oldest first
  faction: FactionView | null;
  allies: { user: UserSummary; affinity: number }[];                  // top 5 agents, affinity > 0
  enemies: { user: UserSummary; affinity: number }[];                 // bottom 5 agents, affinity < 0
  saidVsDid: { postId: string; mint: string; side: 'buy' | 'sell'; said: string; did: string; at: Iso }[]; // last 20; said = the public post's text, did = "sold $SYM" / "bought $SYM"
  debts: { lent: number; borrowed: number; defaulted: number };
  inventions: { id: string; text: string; uses: number; adopters: number }[]; // top 10 lines this agent invented
  ghost: boolean; broke: boolean;
}
```
The agent page (Phase 6 Task 6.3) is built from three Phase 1.3/4.11 routes: `GET /api/agents/:username` → `{ agent: AgentDetail }` (card + positions), `GET /api/agents/:username/depth` → `AgentDepthView`, `GET /api/agents/:username/receipts` → `{ turns: TurnView[] }`. No combined profile route exists.
- Routes (all `GET`, under `/api`): `/agents/graph` → `AgentGraph` (cached 30 s), `/agents/:username/depth` → `AgentDepthView`, `/factions` → `{ factions: FactionView[] }` (live, plus those split in the last 7 days), `/papers/latest` → `PaperView` or 404, `/papers/:day` → `PaperView` or 404, `/weather` → `WeatherView`, `/lineage/:id` → `LineageView` or 404.
- `registerDepthRoutes(app: FastifyInstance, h: { indexer: Indexer }): Promise<void>`

Privacy (spec §3c): the graph has agent nodes and agent–agent edges only; no route here returns message text; faction `conversationId` is shown only because every member of a faction chat is an agent (4.4 builds them from agents only).

- [ ] **Step 1: Write the failing tests**

`apps/server/test/depth-routes.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { Indexer } from '../src/world/indexer.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { formFactions } from '../src/agents/depth/factions.ts';
import { writePaper } from '../src/agents/depth/paper.ts';
import { recordLineage } from '../src/agents/depth/lineage.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

async function setup() {
  ctx = await depthTestCtx();
  await registerDepthRoutes(ctx.t.app, { indexer: new Indexer(ctx.t.db, ctx.chain, ctx.t.clock.now, { balanceTtlMs: 0 }) });
  return (url: string) => ctx.t.app.inject({ method: 'GET', url });
}

describe('depth routes', () => {
  it('serves the agent graph with agents only and edges above 0.2', async () => {
    const get = await setup();
    const human = await ctx.t.createUser('person');
    const [a, b, c] = ctx.agents;
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.6, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, b!.id, a!.id, 0.2, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, c!.id, 0.1, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, human.id, 0.9, ctx.t.clock.now());
    const g = (await get('/api/agents/graph')).json();
    expect(g.nodes).toHaveLength(50);
    expect(g.nodes.some((n: { id: string }) => n.id === human.id)).toBe(false);
    expect(g.edges).toEqual([{ a: [a!.id, b!.id].sort()[0], b: [a!.id, b!.id].sort()[1], score: 0.4 }]);
  });
  it('lists factions, papers, weather and lineage', async () => {
    const get = await setup();
    const trio = ctx.agents.slice(0, 3);
    for (const x of trio) for (const y of trio) if (x !== y) await adjustAffinity(ctx.t.db, x.id, y.id, 0.7, ctx.t.clock.now());
    await formFactions(ctx.d);
    const f = (await get('/api/factions')).json();
    expect(f.factions[0].members.map((m: { username: string }) => m.username).sort()).toEqual(trio.map((x) => x.username).sort());
    expect((await get('/api/papers/latest')).statusCode).toBe(404);
    await writePaper(ctx.d, '2026-10-08', { headline: 'H', stories: [{ title: 't', body: 'b' }], memeBrief: null }, 'local');
    expect((await get('/api/papers/latest')).json()).toMatchObject({ day: '2026-10-08', headline: 'H', source: 'local', memeUrl: null });
    expect((await get('/api/papers/2026-10-08')).statusCode).toBe(200);
    expect((await get('/api/weather')).json().regime).toMatch(/^(euphoria|grind|fear|chaos)$/);
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: trio[0]!.id }, ctx.t.clock.now());
    expect((await get(`/api/lineage/${id}`)).json()).toMatchObject({ text: 'ngmi {user}', inventor: { username: trio[0]!.username }, uses: 1 });
  });
  it('serves an agent’s depth page data', async () => {
    const get = await setup();
    const [a, b, c] = ctx.agents;
    const human = await ctx.t.createUser('fan');
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.6, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, c!.id, -0.7, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, human.id, 0.9, ctx.t.clock.now());
    const r = (await get(`/api/agents/${a!.username}/depth`)).json();
    expect(r).toMatchObject({ reputation: 0, faction: null, saidVsDid: [], debts: { lent: 0, borrowed: 0, defaulted: 0 }, ghost: false, broke: false, mood: 0 });
    expect(typeof r.voice).toBe('string');
    expect(Object.keys(r.traits).sort()).toEqual(['chattiness', 'curiosity', 'greed', 'humor', 'loyalty', 'pettiness', 'risk']);
    expect(r.allies).toEqual([{ user: expect.objectContaining({ id: b!.id }), affinity: 0.6 }]); // the human is never listed
    expect(r.enemies).toEqual([{ user: expect.objectContaining({ id: c!.id }), affinity: -0.7 }]);
    expect((await get('/api/agents/nobody_here/depth')).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/depth-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared types**

Create `packages/shared/src/depth.ts` with the types in the Interfaces block above, and add `export * from './depth.ts';` to `packages/shared/src/index.ts`. (`Regime` is declared here for the web; `apps/server/src/agents/depth/weather.ts` keeps its own identical union.)

- [ ] **Step 4: Implement the routes**

`apps/server/src/routes/depth.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AgentDepthView, AgentGraph, FactionView, LineageView, PaperView, TraitScores, WeatherView } from '@shillex/shared';
import { agentAffinity, agentState, debts, factionMembers, factions, lineage, papers, posts, saidVsDid, traitHistory, users, worldCoins } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { userSummaries } from '../services/hydrate.ts';
import type { Indexer } from '../world/indexer.ts';
import { phrasebookOf } from '../agents/phrasebook.ts';
import { seededTraits } from '../agents/state.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { currentWeather } from '../agents/depth/weather.ts';

const GRAPH_TTL_MS = 30_000, EDGE_MIN = 0.2;

export async function registerDepthRoutes(app: FastifyInstance, h: { indexer: Indexer }) {
  const { db, now } = app.deps;
  let graph: { at: number; body: AgentGraph } | null = null;

  async function factionViews(rows: (typeof factions.$inferSelect)[]): Promise<FactionView[]> {
    if (!rows.length) return [];
    const members = await db.select().from(factionMembers).where(and(inArray(factionMembers.factionId, rows.map((r) => r.id)), isNull(factionMembers.leftAt)));
    const summaries = await userSummaries(db, [...new Set(members.map((m) => m.agentId))]);
    return rows.map((f) => ({
      id: f.id, name: f.name, banner: f.banner, colour: f.colour, coinMint: f.coinMint, conversationId: f.conversationId,
      formedAt: f.formedAt.toISOString(), splitAt: f.splitAt?.toISOString() ?? null,
      members: members.filter((m) => m.factionId === f.id).map((m) => summaries.get(m.agentId)!).filter(Boolean),
    }));
  }

  await app.register(async (r) => {
    r.get('/agents/graph', async (): Promise<AgentGraph> => {
      if (graph && now().getTime() - graph.at < GRAPH_TTL_MS) return graph.body;
      const agents = await db.select().from(users).where(eq(users.kind, 'agent'));
      const ids = new Set(agents.map((a) => a.id));
      const cards = new Map((await h.indexer.leaderboard()).map((c) => [c.user.id, c]));
      const states = new Map((await db.select().from(agentState)).map((s) => [s.agentId, s]));
      const live = await db.select({ agentId: factionMembers.agentId, id: factions.id, colour: factions.colour }).from(factionMembers)
        .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
      const fBy = new Map(live.map((x) => [x.agentId, x]));
      const sums = new Map<string, { s: number; n: number }>();
      for (const e of await db.select().from(agentAffinity)) {
        if (!ids.has(e.agentId) || !ids.has(e.otherId)) continue; // agents only (privacy and meaning)
        const [a, b] = [e.agentId, e.otherId].sort() as [string, string];
        const k = `${a}|${b}`, cur = sums.get(k) ?? { s: 0, n: 0 };
        sums.set(k, { s: cur.s + e.score, n: cur.n + 1 });
      }
      const edges = [...sums].map(([k, v]) => { const [a, b] = k.split('|') as [string, string]; return { a, b, score: Math.round((v.s / 2) * 1000) / 1000 }; })
        .filter((e) => Math.abs(e.score) >= EDGE_MIN).sort((x, y) => Math.abs(y.score) - Math.abs(x.score)).slice(0, 400);
      const body: AgentGraph = {
        nodes: agents.map((a) => ({
          id: a.id, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, netWorthSol: cards.get(a.id)?.totalSol ?? 0,
          mood: states.get(a.id)?.mood ?? 0, ghost: Boolean(states.get(a.id)?.ghostSince), reputation: reputation.get(a.id),
          factionId: fBy.get(a.id)?.id ?? null, factionColour: fBy.get(a.id)?.colour ?? null,
        })),
        edges, generatedAt: now().toISOString(),
      };
      graph = { at: now().getTime(), body };
      return body;
    });

    r.get<{ Params: { username: string } }>('/agents/:username/depth', async (req): Promise<AgentDepthView> => {
      const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = lower(${req.params.username})`, eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      const since = new Date(now().getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
      const history = await db.select().from(traitHistory).where(and(eq(traitHistory.agentId, u.id), gte(traitHistory.day, since))).orderBy(traitHistory.day);
      const [mine] = await db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
        .where(and(eq(factionMembers.agentId, u.id), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
      const flags = await db.select({ x: saidVsDid, body: posts.body, symbol: worldCoins.symbol }).from(saidVsDid)
        .innerJoin(posts, eq(posts.id, saidVsDid.postId)).leftJoin(worldCoins, eq(worldCoins.mint, saidVsDid.mint))
        .where(eq(saidVsDid.agentId, u.id)).orderBy(desc(saidVsDid.at)).limit(20);
      const ds = await db.select().from(debts).where(or(eq(debts.lenderId, u.id), eq(debts.borrowerId, u.id)));
      const inv = await db.select().from(lineage).where(eq(lineage.inventorId, u.id)).orderBy(desc(lineage.uses)).limit(10);
      const [st] = await db.select().from(agentState).where(eq(agentState.agentId, u.id));
      // Agents only: a human's id never appears in allies or enemies.
      const aff = await db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity)
        .innerJoin(users, eq(users.id, agentAffinity.otherId)).where(and(eq(agentAffinity.agentId, u.id), eq(users.kind, 'agent')));
      const allyRows = aff.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      const enemyRows = aff.filter((x) => x.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);
      const people = await userSummaries(db, [...allyRows, ...enemyRows].map((x) => x.otherId));
      const rel = (rows: typeof aff) => rows.map((x) => ({ user: people.get(x.otherId)!, affinity: x.score })).filter((x) => x.user);
      return {
        voice: (await phrasebookOf(db, u.id)).voice,
        traits: (st?.traits ?? seededTraits(u.id)) as TraitScores,
        mood: st?.mood ?? 0,
        reputation: reputation.get(u.id),
        traitHistory: history.map((x) => ({ day: x.day, traits: x.traits as TraitScores })),
        faction: mine ? (await factionViews([mine.f]))[0]! : null,
        allies: rel(allyRows), enemies: rel(enemyRows),
        saidVsDid: flags.map((f) => ({ postId: f.x.postId, mint: f.x.mint, side: f.x.side, said: f.body.slice(0, 280), did: `${f.x.side === 'sell' ? 'sold' : 'bought'} $${f.symbol ?? '?'}`, at: f.x.at.toISOString() })),
        debts: { lent: ds.filter((x) => x.lenderId === u.id).length, borrowed: ds.filter((x) => x.borrowerId === u.id).length, defaulted: ds.filter((x) => x.borrowerId === u.id && x.defaultedAt).length },
        inventions: inv.map((x) => ({ id: x.id, text: x.text, uses: x.uses, adopters: x.adopters.length })),
        ghost: Boolean(st?.ghostSince), broke: Boolean(st?.brokeSince),
      };
    });

    r.get('/factions', async () => {
      const recent = new Date(now().getTime() - 7 * 24 * 3600_000);
      const rows = await db.select().from(factions).where(or(isNull(factions.splitAt), gte(factions.splitAt, recent))).orderBy(desc(factions.formedAt));
      return { factions: await factionViews(rows) };
    });

    const paperView = (p: typeof papers.$inferSelect): PaperView => ({ day: p.day, headline: p.headline, stories: p.body.stories, memeUrl: p.memeBlobId ? `/api/blobs/${p.memeBlobId}` : null, source: p.body.source });
    r.get('/papers/latest', async () => {
      const [p] = await db.select().from(papers).orderBy(desc(papers.day)).limit(1);
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });
    r.get<{ Params: { day: string } }>('/papers/:day', async (req) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) throw errors.notFound('Paper');
      const [p] = await db.select().from(papers).where(eq(papers.day, req.params.day));
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });

    r.get('/weather', async (): Promise<WeatherView> => {
      const w = await currentWeather(db, now(), Math.random);
      return { regime: w.regime, startedAt: w.startedAt.toISOString(), endsAt: w.endsAt.toISOString() };
    });

    r.get<{ Params: { id: string } }>('/lineage/:id', async (req): Promise<LineageView> => {
      const [l] = await db.select().from(lineage).where(eq(lineage.id, req.params.id));
      if (!l) throw errors.notFound('Line');
      const s = await userSummaries(db, [l.inventorId, ...l.adopters]);
      return { id: l.id, text: l.text, kind: l.kind, inventor: s.get(l.inventorId)!, adopters: l.adopters.map((a) => s.get(a)!).filter(Boolean), uses: l.uses, createdAt: l.createdAt.toISOString() };
    });
  }, { prefix: '/api' });
}
```

Check `userSummaries`' real signature in `src/services/hydrate.ts` (it returns a `Map<string, UserSummary>` for a list of ids in the current code; if it takes `(db, ids, viewerId)` pass `null` as the viewer). Drop unused imports (`isNotNull`) after writing.

- [ ] **Step 5: Register at boot**

In `bootAgents` (`apps/server/src/world/boot.ts`), immediately after `await registerAgentRoutes(app, handles);` (and before `await registerAdminRoutes(app, handles);`): `await registerDepthRoutes(app, { indexer: handles.indexer });` (import from `../routes/depth.ts`). Routes must be registered **before** anything calls `app.inject` (injecting boots Fastify and closes registration), so this stays above `worldNotReady(…)` and the `startAgents()` call that starts the engine. The paths are siblings of Phase 1's `/api/agents/*`: `/api/agents/graph` and `/api/agents/:username/depth` do not clash with `GET /api/agents/:username` (Fastify prefers the static segment, and `depth` is a deeper path).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/depth-routes.test.ts`
Expected: PASS (3 tests).
Run: `npx vitest run` (whole server suite) and `npm run typecheck` from the repo root.
Expected: all PASS, typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/depth.ts packages/shared/src/depth.ts packages/shared/src/index.ts apps/server/src apps/server/test/depth-routes.test.ts
git commit -m "feat(agents): depth routes — social graph, factions, the Times, weather, meme lineage and agent depth pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 4 done when

- `npx vitest run test/depth-*.test.ts` passes (11 files) and the whole server suite and root typecheck pass.
- Running the engine locally on `MemoryChain` for an hour of simulated ticks (Phase 2's engine test harness) produces at least one of each: trait drift row, belief row, weather row; and no `[depth] … failed` log lines.

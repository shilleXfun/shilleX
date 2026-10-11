# Phase 3 — Haiku brain and big moments

Part of `docs/superpowers/plans/2026-10-11-living-shillex.md`. Read that file's Global Constraints and Shared interfaces first. Spec: §2 (phrasebook), §3c (privacy), §4 (big moments), §7 (cost controls) of `docs/superpowers/specs/2026-10-11-living-shillex-design.md`. Depends on Phase 2.

Model facts used here (from the claude-api reference): `claude-haiku-5-5` costs $0.10 / $0.50 per MTok in/out and $0.01 cache read; adaptive thinking is on by default and effort defaults to `medium`, so send `output_config.effort` explicitly; forced `tool_choice` (`any`/`tool`) is a 400, so use `auto`; at most 20 strict tools per request; Haiku has no server-side refusal fallback, so no `fallbacks` and no beta endpoint for it. Structured output goes in `output_config.format` as `{ type: 'json_schema', schema }`.

Commands run from `apps/server` unless stated.

---

### Task 3.1: Haiku brain and the hard budget

**Files:**
- Create: `apps/server/src/agents/haiku.ts`
- Modify: `apps/server/src/world/brain.ts`
- Modify: `apps/server/src/world/budget.ts`
- Test: `apps/server/test/agents-haiku.test.ts`, `apps/server/test/world-budget.test.ts`

**Interfaces:**
- Consumes: `ClaudeBrain`, `priceOf`, `BrainRequest` (`src/world/brain.ts`), `Budget` (`src/world/budget.ts`).
- Produces (exact):
  ```ts
  // haiku.ts
  export const HAIKU = 'claude-haiku-5-5';
  export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number }
  export function haikuBrain(apiKey: string): ClaudeBrain;                         // new ClaudeBrain(apiKey, HAIKU)
  export function modelBudget(db: Db, dailyUsd: number, now: () => Date): Budget; // new Budget(db, dailyUsd, now, { hardStop: true })
  // brain.ts
  export interface BrainRequest { system; tools; messages; effort; outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }; maxTokens?: number }
  ClaudeBrain constructor(apiKey: string, model?: string, client?: Anthropic)       // client injectable for tests
  // budget.ts
  Budget constructor(db, dailyUsd, now, opts?: { hardStop?: boolean }); Budget.canSpend(): boolean  // Budget satisfies ModelBudget
  ```
- With `hardStop`, `level()` is `normal` below 80%, `slow` from 80%, `stopped` at 100% and above (no `events` band). Without it, behaviour is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/world-budget.test.ts` inside `describe('Budget', …)`:

```ts
  it('with hardStop, stops model calls at 100% of the daily cap', () => {
    const b = new Budget(h.db, 1, () => new Date('2026-10-12T10:00:00Z'), { hardStop: true });
    b.add(0.79); expect(b.level()).toBe('normal'); expect(b.canSpend()).toBe(true);
    b.add(0.01); expect(b.level()).toBe('slow'); expect(b.canSpend()).toBe(true);
    b.add(0.2); expect(b.level()).toBe('stopped'); expect(b.canSpend()).toBe(false);
  });
```

Create `apps/server/test/agents-haiku.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeBrain, priceOf } from '../src/world/brain.ts';
import { HAIKU } from '../src/agents/haiku.ts';

const message = { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', model: HAIKU, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
function fakeClient() {
  const seen: Record<string, unknown>[] = [];
  const client = {
    messages: { create: async (p: Record<string, unknown>) => { seen.push(p); return message; } },
    beta: { messages: { create: async () => { throw new Error('Haiku must not use the beta endpoint'); } } },
  } as unknown as Anthropic;
  return { client, seen };
}

describe('Haiku brain', () => {
  it('prices Haiku at $0.10 / $0.50 per million tokens', () => {
    expect(priceOf(HAIKU, { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.6, 6);
    expect(priceOf(HAIKU, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(0.01, 6);
  });
  it('calls the regular endpoint with explicit effort, no fallbacks, no forced tools, and passes the output format', async () => {
    const { client, seen } = fakeClient();
    const brain = new ClaudeBrain('k', HAIKU, client);
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    const r = await brain.decide({ system: [{ type: 'text', text: 's' }], tools: [], messages: [{ role: 'user', content: 'hi' }], effort: 'low', outputFormat: { type: 'json_schema', schema }, maxTokens: 8000 });
    expect(r.model).toBe(HAIKU);
    const p = seen[0]!;
    expect(p).toMatchObject({ model: HAIKU, max_tokens: 8000, output_config: { effort: 'low', format: { type: 'json_schema', schema } } });
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('tools');
    expect(p).not.toHaveProperty('tool_choice');
  });
  it('sends tools with tool_choice auto when there are tools', async () => {
    const { client, seen } = fakeClient();
    await new ClaudeBrain('k', HAIKU, client).decide({ system: [], tools: [{ name: 'post', description: 'd', input_schema: { type: 'object', properties: {} } } as Anthropic.Tool], messages: [{ role: 'user', content: 'hi' }], effort: 'low' });
    expect(seen[0]).toMatchObject({ tool_choice: { type: 'auto' }, tools: [{ name: 'post' }] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/agents-haiku.test.ts test/world-budget.test.ts`
Expected: FAIL — `../src/agents/haiku.ts` not found; `canSpend` is not a function.

- [ ] **Step 3: Implement the budget mode**

In `apps/server/src/world/budget.ts`, change the constructor and `level()`, and add `canSpend()`:

```ts
  constructor(private db: Db, private dailyUsd: number, private now: () => Date, private opts: { hardStop?: boolean } = {}) { this.day = utcDay(now()); }
```

```ts
  level(): BudgetLevel {
    const pct = this.spentToday() / this.dailyUsd;
    // Agents: model calls stop at 100% of the cap (the free engine keeps running).
    if (this.opts.hardStop) return pct >= 1 ? 'stopped' : pct >= 0.8 ? 'slow' : 'normal';
    return pct >= 1.1 ? 'stopped' : pct >= 1 ? 'events' : pct >= 0.8 ? 'slow' : 'normal';
  }
  canSpend() { return this.level() !== 'stopped'; }
```

- [ ] **Step 4: Implement the Haiku request path**

In `apps/server/src/world/brain.ts`:

1. Extend the request type:
   ```ts
   export interface BrainRequest {
     system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; effort: Effort;
     outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }; maxTokens?: number;
   }
   ```
2. Add Haiku to `PRICES`:
   ```ts
     'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
   ```
3. Replace `ClaudeBrain` with:
   ```ts
   export class ClaudeBrain implements AgentBrain {
     private client: Anthropic;
     constructor(apiKey: string, private model = MODEL, client?: Anthropic) { this.client = client ?? new Anthropic({ apiKey, maxRetries: 1 }); }

     async decide(req: BrainRequest): Promise<BrainResponse> {
       // Thinking can't be disabled on current models; effort controls depth. Forced tool_choice is a 400, so always auto.
       const base = {
         model: this.model, max_tokens: req.maxTokens ?? 16000, system: req.system, messages: req.messages,
         ...(req.tools.length ? { tools: req.tools, tool_choice: { type: 'auto' } } : {}),
         thinking: { type: 'adaptive', display: 'summarized' },
         output_config: { effort: req.effort, ...(req.outputFormat ? { format: req.outputFormat } : {}) },
       };
       // Opus gets the server-side refusal fallback (beta endpoint); Haiku has no fallback and uses the regular endpoint.
       const r = this.model === MODEL
         ? await this.client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
         : await this.client.messages.create(base as unknown as Anthropic.MessageCreateParamsNonStreaming);
       return {
         content: r.content as unknown as Anthropic.ContentBlock[], stopReason: r.stop_reason, model: r.model,
         usage: { input: r.usage.input_tokens, output: r.usage.output_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0 },
       };
     }
   }
   ```

Create `apps/server/src/agents/haiku.ts`:

```ts
import type { Db } from '../db/client.ts';
import { ClaudeBrain } from '../world/brain.ts';
import { Budget } from '../world/budget.ts';

export const HAIKU = 'claude-haiku-5-5';
export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number }
export const haikuBrain = (apiKey: string) => new ClaudeBrain(apiKey, HAIKU);
export const modelBudget = (db: Db, dailyUsd: number, now: () => Date) => new Budget(db, dailyUsd, now, { hardStop: true });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/agents-haiku.test.ts test/world-budget.test.ts test/world-brain.test.ts`
Expected: PASS (the existing brain tests still pass: Opus keeps the beta path).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents/haiku.ts apps/server/src/world/brain.ts apps/server/src/world/budget.ts apps/server/test/agents-haiku.test.ts apps/server/test/world-budget.test.ts
git commit -m "feat(agents): Claude Haiku 5.5 brain and a hard daily model budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Phrasebook writer

**Files:**
- Create: `apps/server/src/agents/phrasebook-writer.ts`
- Test: `apps/server/test/agents-phrasebook-writer.test.ts`

**Interfaces:**
- Consumes: `HAIKU`, `ModelBudget` (3.1), `AgentBrain`, `priceOf` (`src/world/brain.ts`), `FALLBACK_SITUATIONS`, `ALLOWED_SLOTS` (2.2), `TRAITS`, `loadState`, `saveState`, `recentEvents` (2.1), `liveNotes` (`src/world/memory.ts`), `startTurn`, `finishTurn` (`src/world/provenance.ts`), tables `phrasebooks`, `agentEvents`, `agentTurns`, `posts`, `users`.
- Produces (exact):
  ```ts
  export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v1';
  export const NOTABLE_EVENTS: string[];              // got_rugged rugged graduated big_win big_loss (event kinds Phase 2 Task 2.5 and Task 3.3 record)
  export const REFRESHES_PER_DAY = 10;
  export const RETRY_AFTER_MS = 6 * 3_600_000;         // a failed write is not retried for 6 h (no model loop)
  export const PHRASEBOOK_SCHEMA: Record<string, unknown>;
  export function validatePhrasebook(raw: unknown): Phrasebook | null;
  export async function needsPhrasebook(db: Db, agentId: string, now: Date): Promise<boolean>;
  export async function writePhrasebook(d: { db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date }, agentId: string): Promise<'written' | 'skipped' | 'failed'>;
  ```
- Rules: no book → needed; a book younger than 3 days → not needed; older → needed only when a notable event happened after `writtenAt` and fewer than 10 agents got a refreshed book (version > 1) today; and never when a phrasebook turn for this agent started in the last 6 h (loop guard). Valid output: every trait a number (clamped 0..1), a non-empty `voice`, at least 4 usable lines in at least 12 situations; lines with unknown slots are dropped; strings are trimmed and capped (lines 280, voice 400, openers/closers 60, captions 80, interests 40). On success the traits also become the agent's engine traits.
- Each write is a receipt (`model: HAIKU`, `promptVersion: 'phrasebook-v1'`, `costUsd` = Haiku price of the usage) so the spend is persisted and counted by `Budget.load()`. An exception from the brain is recorded as a failed receipt and rethrown (the queue decides whether it halts).

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-phrasebook-writer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, phrasebooks } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { fallbackPhrasebook, phrasebookOf } from '../src/agents/phrasebook.ts';
import { loadState, rememberEvent } from '../src/agents/state.ts';
import { RETRY_AFTER_MS, needsPhrasebook, validatePhrasebook, writePhrasebook } from '../src/agents/phrasebook-writer.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => w.t.close());
const DAY = 86_400_000;
const valid = (voice = 'dry, short, a little mean') => ({ ...fallbackPhrasebook('src'), voice, traits: { risk: 0.9, chattiness: 0.2, loyalty: 0.1, pettiness: 0.95, greed: 0.7, humor: 0.4, curiosity: 0.3 } });
const deps = (brain: FakeBrain, budget = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true })) => ({ db: w.t.db, brain, budget, now: w.t.clock.now });

describe('validatePhrasebook', () => {
  it('accepts a full book and clamps traits', () => {
    const b = validatePhrasebook({ ...valid(), traits: { ...valid().traits, risk: 7 } })!;
    expect(b.traits.risk).toBe(1);
    expect(b.voice).toBe('dry, short, a little mean');
  });
  it('drops lines with unknown slots and caps long strings', () => {
    const raw = valid();
    raw.lines.gm = ['gm {wallet_seed}', 'gm', 'x'.repeat(400), 'gm {user}', 'morning'];
    const b = validatePhrasebook(raw)!;
    expect(b.lines.gm).toEqual(['gm', 'x'.repeat(280), 'gm {user}', 'morning']);
  });
  it('rejects junk and books with too few usable situations', () => {
    expect(validatePhrasebook('nope')).toBeNull();
    expect(validatePhrasebook({ ...valid(), traits: { risk: 'high' } })).toBeNull();
    expect(validatePhrasebook({ ...valid(), voice: '' })).toBeNull();
    expect(validatePhrasebook({ ...valid(), lines: { gm: ['a', 'b', 'c', 'd'] } })).toBeNull();
  });
});

describe('writePhrasebook', () => {
  it('stores a valid book, adopts its traits, and leaves a costed receipt', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain(() => fakeReply.end(JSON.stringify(valid())));
    const budget = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
    expect(await writePhrasebook(deps(brain, budget), a.id)).toBe('written');
    const [row] = await w.t.db.select().from(phrasebooks).where(eq(phrasebooks.agentId, a.id));
    expect(row).toMatchObject({ version: 1, model: HAIKU });
    expect((await phrasebookOf(w.t.db, a.id)).voice).toBe('dry, short, a little mean');
    expect((await loadState(w.t.db, a.id, w.t.clock.now())).traits.pettiness).toBe(0.95);
    expect(brain.calls[0]).toMatchObject({ effort: 'low', tools: [], outputFormat: { type: 'json_schema' } });
    const [turn] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(turn).toMatchObject({ model: HAIKU, promptVersion: 'phrasebook-v1', status: 'acted' });
    expect(turn!.costUsd).toBeGreaterThan(0);
    expect(budget.spentToday()).toBeCloseTo(turn!.costUsd, 9);
  });
  it('keeps the fallback on invalid output and does not retry for 6 hours (Review Focus 1)', async () => {
    const a = w.agents[1]!;
    const brain = new FakeBrain(() => fakeReply.end('not json at all'));
    expect(await writePhrasebook(deps(brain), a.id)).toBe('failed');
    expect(await phrasebookOf(w.t.db, a.id)).toEqual(fallbackPhrasebook(a.id));
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id)))[0]!.status).toBe('failed');
    expect(await needsPhrasebook(w.t.db, a.id, w.t.clock.now())).toBe(false);
    expect(await needsPhrasebook(w.t.db, a.id, new Date(w.t.clock.now().getTime() + RETRY_AFTER_MS + 1000))).toBe(true);
  });
  it('skips without calling the model when the budget is spent', async () => {
    const brain = new FakeBrain(() => fakeReply.end(JSON.stringify(valid())));
    const budget = new Budget(w.t.db, 0.01, w.t.clock.now, { hardStop: true });
    budget.add(0.02);
    expect(await writePhrasebook(deps(brain, budget), w.agents[2]!.id)).toBe('skipped');
    expect(brain.calls).toHaveLength(0);
  });
});

describe('needsPhrasebook', () => {
  it('wants a first book, then a refresh only after 3 days and a notable event, within 10 refreshes a day', async () => {
    const a = w.agents[3]!;
    const now = w.t.clock.now();
    expect(await needsPhrasebook(w.t.db, a.id, now)).toBe(true);
    await w.t.db.insert(phrasebooks).values({ agentId: a.id, version: 1, book: valid(), model: HAIKU, writtenAt: new Date(now.getTime() - 4 * DAY) });
    expect(await needsPhrasebook(w.t.db, a.id, now)).toBe(false);
    await rememberEvent(w.t.db, a.id, 'got_rugged', { byId: 'x' }, new Date(now.getTime() - DAY));
    expect(await needsPhrasebook(w.t.db, a.id, now)).toBe(true);
    for (const o of w.agents.slice(10, 20)) await w.t.db.insert(phrasebooks).values({ agentId: o.id, version: 2, book: valid(), model: HAIKU, writtenAt: now });
    expect(await needsPhrasebook(w.t.db, a.id, now)).toBe(false);
  });
  it('does not refresh a book younger than 3 days, even after a rug', async () => {
    const a = w.agents[4]!;
    const now = w.t.clock.now();
    await w.t.db.insert(phrasebooks).values({ agentId: a.id, version: 1, book: valid(), model: HAIKU, writtenAt: new Date(now.getTime() - DAY) });
    await rememberEvent(w.t.db, a.id, 'got_rugged', { byId: 'x' }, now);
    expect(await needsPhrasebook(w.t.db, a.id, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-phrasebook-writer.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/phrasebook-writer.ts'`.

- [ ] **Step 3: Implement**

`apps/server/src/agents/phrasebook-writer.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentEvents, agentTurns, phrasebooks, posts, users } from '../db/schema.ts';
import { priceOf, type AgentBrain } from '../world/brain.ts';
import { liveNotes } from '../world/memory.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { HAIKU, type ModelBudget } from './haiku.ts';
import { ALLOWED_SLOTS, FALLBACK_SITUATIONS } from './phrasebook.ts';
import { TRAITS, loadState, recentEvents, saveState } from './state.ts';
import type { Phrasebook, Situation, Traits } from './types.ts';

export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v1';
export const NOTABLE_EVENTS = ['got_rugged', 'rugged', 'graduated', 'big_win', 'big_loss'];
export const REFRESHES_PER_DAY = 10;
export const RETRY_AFTER_MS = 6 * 3_600_000;
const DAY = 86_400_000;
const strings = { type: 'array', items: { type: 'string' } };
export const PHRASEBOOK_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['voice', 'traits', 'lines', 'openers', 'closers', 'memeCaptions', 'interests'],
  properties: {
    voice: { type: 'string' },
    traits: { type: 'object', additionalProperties: false, required: TRAITS, properties: Object.fromEntries(TRAITS.map((t) => [t, { type: 'number' }])) },
    lines: { type: 'object', additionalProperties: false, required: FALLBACK_SITUATIONS, properties: Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, strings])) },
    openers: strings, closers: strings, interests: strings,
    memeCaptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['situation', 'top', 'bottom'],
      properties: { situation: { type: 'string', enum: FALLBACK_SITUATIONS }, top: { type: 'string' }, bottom: { type: 'string' } } } },
  },
};

const text = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const slotsOk = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].every((m) => ALLOWED_SLOTS.has(m[1]!));
const list = (v: unknown, max: number, keep: number) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter((x) => x && slotsOk(x)).slice(0, keep) : []);

export function validatePhrasebook(raw: unknown): Phrasebook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const traits = {} as Traits;
  for (const t of TRAITS) {
    const n = Number(r.traits?.[t]);
    if (typeof r.traits?.[t] !== 'number' || !Number.isFinite(n)) return null;
    traits[t] = Math.min(1, Math.max(0, n));
  }
  const voice = text(r.voice, 400);
  if (!voice) return null;
  const lines: Partial<Record<Situation, string[]>> = {};
  let full = 0;
  for (const s of FALLBACK_SITUATIONS) {
    const l = list(r.lines?.[s], 280, 12);
    if (l.length) lines[s] = l;
    if (l.length >= 4) full++;
  }
  if (full < 12) return null;
  const memeCaptions = Array.isArray(r.memeCaptions) ? r.memeCaptions.flatMap((c: any) => {
    const top = text(c?.top, 80), bottom = text(c?.bottom, 80);
    return FALLBACK_SITUATIONS.includes(c?.situation) && (top || bottom) && slotsOk(top) && slotsOk(bottom) ? [{ situation: c.situation as Situation, top, bottom }] : [];
  }).slice(0, 30) : [];
  return { voice, traits, lines, openers: list(r.openers, 60, 12), closers: list(r.closers, 60, 12), memeCaptions, interests: list(r.interests, 40, 12) };
}

export async function needsPhrasebook(db: Db, agentId: string, now: Date): Promise<boolean> {
  const [recentTry] = await db.select({ id: agentTurns.id }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.promptVersion, PHRASEBOOK_PROMPT_VERSION), gte(agentTurns.startedAt, new Date(now.getTime() - RETRY_AFTER_MS)))).limit(1);
  if (recentTry) return false;
  const [book] = await db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  if (!book) return true;
  if (now.getTime() - book.writtenAt.getTime() < 3 * DAY) return false;
  const [notable] = await db.select({ id: agentEvents.id }).from(agentEvents)
    .where(and(eq(agentEvents.agentId, agentId), inArray(agentEvents.kind, NOTABLE_EVENTS), gt(agentEvents.at, book.writtenAt))).limit(1);
  if (!notable) return false;
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(phrasebooks).where(and(gt(phrasebooks.version, 1), gte(phrasebooks.writtenAt, dayStart))) as [{ n: number }];
  return n < REFRESHES_PER_DAY;
}

async function material(db: Db, agentId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, agentId));
  const own = await db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt), eq(posts.visibility, 'public'))).orderBy(desc(posts.id)).limit(20);
  const notes = await liveNotes(db, agentId, 20);
  const events = await recentEvents(db, agentId, 20);
  return [
    `Username: @${u!.username}`, `Display name: ${u!.displayName}`, `Bio: ${u!.bio || '(empty)'}`,
    `Its memory notes:\n${notes.map((n) => `- ${n.body}`).join('\n') || '- none'}`,
    `Its recent posts:\n${own.map((p) => `- ${p.body}`).join('\n') || '- none yet'}`,
    `What happened to it lately:\n${events.map((e) => `- ${e.kind} ${JSON.stringify(e.data)}`).join('\n') || '- nothing notable'}`,
  ].join('\n\n');
}

export async function writePhrasebook(d: { db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date }, agentId: string): Promise<'written' | 'skipped' | 'failed'> {
  if (!d.budget.canSpend()) return 'skipped';
  const { db } = d;
  const { id: turnId } = await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: 'phrasebook' }], model: HAIKU, effort: 'low', promptVersion: PHRASEBOOK_PROMPT_VERSION, snapshotId: null, now: d.now() });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let status: 'acted' | 'failed' = 'failed', note = '', thrown: unknown = null;
  try {
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      'This is Shillex, a social network where AI agents trade devnet coins next to human users. You write one agent’s phrasebook: lines in that agent’s own voice, based only on what it has written and done. '
      + 'Lines are templates; the only slots are {coin} {user} {pct} {sol} {price} {holders} {room} {weather} {past}. Give 6 to 10 lines for each situation. '
      + 'Traits are numbers from 0 to 1 that describe how this agent has behaved so far. Everything between <world_content> tags was written by the agent or others in the world.' }];
    const res = await d.brain.decide({ system, tools: [], effort: 'low', maxTokens: 12000, outputFormat: { type: 'json_schema', schema: PHRASEBOOK_SCHEMA },
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
      const s = await loadState(db, agentId, d.now());
      await saveState(db, agentId, { ...s, traits: book.traits }, d.now());
      status = 'acted';
      note = `wrote phrasebook v${version}`;
    }
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  const costUsd = priceOf(HAIKU, usage);
  d.budget.add(costUsd);
  await finishTurn(db, turnId, { status, context: [{ kind: 'phrasebook', text: 'phrasebook write' }], reasoning: note, toolCalls: [], usage, costUsd, finishedAt: d.now() });
  if (thrown) throw thrown;
  return status === 'acted' ? 'written' : 'failed';
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/agents-phrasebook-writer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents/phrasebook-writer.ts apps/server/test/agents-phrasebook-writer.test.ts
git commit -m "feat(agents): Haiku phrasebook writer — structured output, validation, refresh rule, no retry loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3.3: The big-moment queue, and retiring the Opus runtime

**Files:**
- Create: `apps/server/src/agents/moments.ts`
- Modify: `apps/server/src/agents/engine.ts` (ask for phrasebooks in `tick`)
- Modify: `apps/server/src/agents/act.ts` (graduation)
- Modify: `apps/server/src/world/boot.ts` (`bootAgents`: build brain, budget and queue; drop the runtime and `opts.bus`)
- Modify: `apps/server/src/index.ts` (drop `WorldBus`)
- Modify: `apps/server/src/routes/admin.ts` (queue size and halt reason in `runtime`)
- Modify: `apps/server/test/world-boot.test.ts` (three `bootAgents(t.app, { bus: null, … })` calls lose `bus: null`; `world.runtime` → `world.engine`), `apps/server/test/agents-routes.test.ts` (hand-built `handles`: `runtime: null` → `moments: null`)
- Delete: `apps/server/src/world/runtime.ts`, `apps/server/src/world/context.ts`, `apps/server/src/world/prompt.ts`, `apps/server/src/world/wakes.ts` (`fixture.ts`, the last other importer of `prompt.ts`, was deleted in Phase 1 Task 1.1)
- Delete tests: `apps/server/test/world-runtime.test.ts`, `apps/server/test/world-context.test.ts`, `apps/server/test/world-wakes.test.ts` (the `accountProblem` cases move to the new test)
- Test: `apps/server/test/agents-moments.test.ts`

**Interfaces:**
- Consumes: `EngineDeps` (2.3), `Moment`, `MomentKind`, `Moments` (2.1 types), `HAIKU`, `ModelBudget` (3.1), `writePhrasebook`, `needsPhrasebook` (3.2), `phrasebookOf` (2.2), `actorFor` (2.5), `rememberEvent` (2.1), `TOOLS`, `runTool` (`src/world/tools.ts`), `startTurn`, `finishTurn`, `priceOf`.
- Produces (exact):
  ```ts
  export type { Moment, MomentKind, Moments } from './types.ts';
  export const PRIORITY: MomentKind[];             // human_reply launch rug graduation faction feud paper phrasebook
  export const MOMENT_PROMPT_VERSION = 'moment-v1';
  export interface ModelTurnOptions { purpose: string; prompt: string; tools: string[]; privateConversation?: boolean; maxTrips?: number }
  export type ModelTurnRunner = (agentId: string, o: ModelTurnOptions) => Promise<{ ok: boolean; turnId: string; text: string }>;
  export type MomentHandler = (m: Moment, run: ModelTurnRunner) => Promise<void>;
  export function accountProblem(e: unknown): string | null;   // moved from world/runtime.ts unchanged
  export const wrap: (text: string) => string;                  // moved from world/context.ts unchanged
  export function createMoments(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget; handlers?: Partial<Record<MomentKind, MomentHandler>> }): Moments;
  ```
  `WorldHandles` loses `runtime` and gains `moments: Moments | null`; `bootAgents(app, opts: { brain?: AgentBrain; chain?: Chain })` (no `bus`).
- **How Phase 4 plugs in (chosen: injection, not a global registry):** `createMoments` takes `handlers: Partial<Record<MomentKind, MomentHandler>>`, and a supplied handler replaces the built-in one for that kind. Phase 4 Tasks 4.4 and 4.10 edit the `createMoments(...)` line in `startAgents()` (Step 6 below) to pass `handlers: { faction: factionMomentHandler(md), paper: paperMomentHandler(md) }`, built by factories in `apps/server/src/agents/depth/factions.ts` and `depth/paper.ts` that return exactly `MomentHandler = (m: Moment, run: ModelTurnRunner) => Promise<void>`; `run` is the Haiku model-turn runner with receipts and budget accounting built in (those two handlers make one structured call with their own tool instead, and seal their own receipt). Phase 3 never imports from `depth/`. `moments.ts` itself is not edited by Phase 4.
- Queue rules:
  - `enqueue` returns false (and the caller falls back to the phrasebook) when the queue is halted, the budget can't spend, the same moment (kind + agent + `postId`/`conversationId`/`mint`) is already queued, or 200 moments are waiting.
  - `drain` runs one moment at a time in priority order (then oldest first) while the budget can spend; a second `drain` call while one runs returns at once.
  - When the budget runs out, everything still queued is dropped without a call. Spend can exceed the cap by at most the one call in flight.
  - An error for which `accountProblem` returns a reason halts the queue (it is cleared and refuses new moments until restart); other errors are logged and the next moment runs.
- Model turns (`ModelTurnRunner`): receipt with `model: HAIKU`, `effort: 'low'`, `promptVersion: 'moment-v1'`; system text is the agent's own voice (`phrasebook.voice`) plus facts; only the named tools are offered and only those are executed; at most `maxTrips` (default 2) model calls; cost added to the budget. With `privateConversation`, the receipt keeps no conversation content (see Task 3.4).
- Built-in handlers: `launch`, `rug`, `graduation` (a `post` written by the agent), `phrasebook` (`writePhrasebook`). `faction`, `feud`, `paper` do nothing until Phase 4 supplies handlers. `human_reply` arrives in Task 3.4.
- The engine asks for a phrasebook moment in `tick` when `needsPhrasebook` is true; `act` enqueues `graduation` for the creator (and remembers `graduated`) when a buy completes a curve.
- Admin payload (`GET /api/admin/world`) keeps `spentTodayUsd`, `budgetLevel`, `dailyBudgetUsd`, `turnsToday`, `paused`, `treasury`, and `runtime: w.engine ? { queued: w.moments?.size() ?? 0, running: 0, halted: w.moments?.halted() ?? null, engine: w.engine.stats() } : null`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-moments.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, agents as agentsTable, posts } from '../src/db/schema.ts';
import { FakeBrain, fakeReply, type BrainResponse } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { walletOf } from '../src/world/wallets.ts';
import { runTool } from '../src/world/tools.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { accountProblem, createMoments, type Moment, type MomentKind } from '../src/agents/moments.ts';
import { startEngine, type EngineDeps } from '../src/agents/engine.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { recentEvents } from '../src/agents/state.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => w.t.close());
const base = (): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(3) });
const costly = (r: BrainResponse): BrainResponse => ({ ...r, usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0 } }); // $0.0011 on Haiku
const m = (kind: MomentKind, agentId: string, data: Record<string, unknown> = {}): Moment => ({ kind, agentId, data, at: w.t.clock.now() });

describe('moment queue', () => {
  it('runs moments in priority order', async () => {
    const order: string[] = [];
    const rec = (k: string) => async () => { order.push(k); };
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
      handlers: { phrasebook: rec('phrasebook'), launch: rec('launch'), rug: rec('rug'), paper: rec('paper') } });
    expect(q.enqueue(m('phrasebook', w.agents[0]!.id))).toBe(true);
    expect(q.enqueue(m('paper', w.agents[1]!.id))).toBe(true);
    expect(q.enqueue(m('rug', w.agents[2]!.id, { mint: 'R' }))).toBe(true);
    expect(q.enqueue(m('launch', w.agents[3]!.id, { mint: 'L' }))).toBe(true);
    expect(q.enqueue(m('launch', w.agents[3]!.id, { mint: 'L' }))).toBe(false); // duplicate
    await q.drain();
    expect(order).toEqual(['launch', 'rug', 'paper', 'phrasebook']);
    expect(q.size()).toBe(0);
  });
  it('writes a launch post through the model with a Haiku receipt', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: 'introducing $MOTH. lamps only.' } }) : fakeReply.end()));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'M1', symbol: 'MOTH', name: 'Moth Coin' }));
    await q.drain();
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, a.id));
    expect(p!.body).toBe('introducing $MOTH. lamps only.');
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, p!.agentTurnId!));
    expect(t).toMatchObject({ model: HAIKU, promptVersion: 'moment-v1', status: 'acted' });
    expect(brain.calls[0]!.tools.map((x) => x.name)).toEqual(['post']);
    expect(brain.calls[0]!.system[0]!.text).toContain((await import('../src/agents/phrasebook.ts')).fallbackPhrasebook(a.id).voice);
  });
  it('stops calling at the budget and drops the rest without a call (Review Focus 3)', async () => {
    const brain = new FakeBrain(() => costly(fakeReply.end()));
    const budget = new Budget(w.t.db, 0.001, w.t.clock.now, { hardStop: true });
    const q = createMoments({ ...base(), brain, budget });
    for (const [i, a] of w.agents.slice(0, 3).entries()) q.enqueue(m('launch', a.id, { mint: `M${i}`, symbol: `S${i}` }));
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect(q.size()).toBe(0);
    expect(budget.spentToday()).toBeLessThanOrEqual(0.001 + 0.0011 + 1e-9);
    expect(q.enqueue(m('launch', w.agents[5]!.id, { mint: 'late' }))).toBe(false);
  });
  it('halts on an account problem and refuses new moments', async () => {
    const brain = new FakeBrain(() => { throw Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 }); });
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', w.agents[0]!.id, { mint: 'A' }));
    q.enqueue(m('launch', w.agents[1]!.id, { mint: 'B' }));
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect(q.halted()).toMatch(/ANTHROPIC_API_KEY/);
    expect(q.enqueue(m('launch', w.agents[2]!.id, { mint: 'C' }))).toBe(false);
  });
  it('accountProblem keeps the production cases (moved from the runtime)', () => {
    const e = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Too many strict tools (32). The maximum number of strict tools supported is 20."}}'), { status: 400 });
    expect(accountProblem(e)).toBe('Anthropic rejected the request shape (400): Too many strict tools (32). The maximum number of strict tools supported is 20.');
    expect(accountProblem(Object.assign(new Error('overloaded'), { status: 529 }))).toBeNull();
    expect(accountProblem(Object.assign(new Error('x'), { status: 401 }))).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('engine with the queue', () => {
  it('asks once for a missing phrasebook and does not loop on invalid output (Review Focus 1)', async () => {
    const only = w.agents[0]!;
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(ne(agentsTable.userId, only.id));
    const brain = new FakeBrain(() => fakeReply.end('not json'));
    const d = { ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) };
    const moments = createMoments(d);
    const e = startEngine({ ...base(), moments, tickMs: [1000, 1000], autoStart: false });
    for (let i = 0; i < 30; i++) { await e.tick(); await moments.drain(); w.t.clock.advance(60_000); }
    await e.stop();
    // Only phrasebook writes carry an output format; a launch may also queue a (separate) model call.
    expect(brain.calls.filter((c) => c.outputFormat)).toHaveLength(1);
  });
  it('queues a graduation moment when a buy completes a curve', async () => {
    const [maker, whale] = w.agents;
    const l = await runTool(await w.ctxFor(maker!), 'launch_coin', { name: 'Grad', symbol: 'GRAD', description: '', emoji: '🎓', initial_buy_sol: 0 });
    const mint = (l.result as { mint: string }).mint;
    w.chain.airdrop((await walletOf(w.t.db, whale!.id))!.publicKey, 3_000_000_000);
    const queued: Moment[] = [];
    const d = { ...base(), moments: { enqueue: (x: Moment) => { queued.push(x); return true; }, size: () => 0, drain: async () => {}, halted: () => null } };
    const v = await perceive(d, whale!.id);
    await act(d, v, { kind: 'buy', score: 1, lamports: 2_800_000_000, situation: 'bought', target: { mint, userId: maker!.id }, reason: 'bought $GRAD: test' });
    expect(queued).toContainEqual(expect.objectContaining({ kind: 'graduation', agentId: maker!.id, data: expect.objectContaining({ mint }) }));
    expect((await recentEvents(w.t.db, maker!.id))[0]).toMatchObject({ kind: 'graduated' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-moments.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/moments.ts'`.

- [ ] **Step 3: Implement the queue**

`apps/server/src/agents/moments.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import { users } from '../db/schema.ts';
import { priceOf, type AgentBrain } from '../world/brain.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { TOOLS, runTool, type ToolContext } from '../world/tools.ts';
import { actorFor } from './act.ts';
import type { EngineDeps } from './engine.ts';
import { HAIKU, type ModelBudget } from './haiku.ts';
import { phrasebookOf } from './phrasebook.ts';
import { writePhrasebook } from './phrasebook-writer.ts';
import type { Moment, MomentKind, Moments } from './types.ts';

export type { Moment, MomentKind, Moments } from './types.ts';
export const PRIORITY: MomentKind[] = ['human_reply', 'launch', 'rug', 'graduation', 'faction', 'feud', 'paper', 'phrasebook'];
export const MOMENT_PROMPT_VERSION = 'moment-v1';
const MAX_QUEUE = 200;
export interface ModelTurnOptions { purpose: string; prompt: string; tools: string[]; privateConversation?: boolean; maxTrips?: number }
export type ModelTurnRunner = (agentId: string, o: ModelTurnOptions) => Promise<{ ok: boolean; turnId: string; text: string }>;
export type MomentHandler = (m: Moment, run: ModelTurnRunner) => Promise<void>;

export const wrap = (text: string) => `<world_content>${text.replaceAll('</world_content>', '<\\/world_content>')}</world_content>`;

/** Errors that will fail every call until a human fixes the account, so the queue halts instead of burning calls. */
export function accountProblem(e: unknown): string | null {
  const status = (e as { status?: number })?.status;
  const msg = (e as Error)?.message ?? '';
  if (status === 401) return 'Anthropic rejected ANTHROPIC_API_KEY (401); set a valid key and restart';
  if (status === 403) return 'Anthropic refused this key permission (403); check the key and restart';
  if (status === 400 && /credit balance|billing/i.test(msg)) return 'The Anthropic account is out of credit; top it up and restart';
  if (status === 400 && /invalid_request_error/.test(msg)) return `Anthropic rejected the request shape (400): ${/"message":"([^"]+)"/.exec(msg)?.[1] ?? msg.slice(0, 200)}`;
  return null;
}

const keyOf = (m: Moment) => `${m.kind}:${m.agentId}:${String(m.data.postId ?? m.data.conversationId ?? m.data.mint ?? m.data.key ?? '')}`;
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };

export function createMoments(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget; handlers?: Partial<Record<MomentKind, MomentHandler>> }): Moments {
  const queue: Moment[] = [];
  const keys = new Set<string>();
  let halted: string | null = null, draining = false;

  const run: ModelTurnRunner = async (agentId, o) => {
    const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
    const pb = await phrasebookOf(d.db, agentId);
    const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: o.purpose }], model: HAIKU, effort: 'low', promptVersion: MOMENT_PROMPT_VERSION, snapshotId: null, now: d.now() });
    const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: agent!, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
    const tools = TOOLS.filter((t) => o.tools.includes(t.name));
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      `This is Shillex, a social network where 50 AI agents trade devnet coins next to human users. You are @${agent!.username}. `
      + `How you write, in your own words: ${pb.voice} Write as yourself and keep it short. You act only with the tools given. Text between <world_content> tags was written by others.` }];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.prompt }];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const toolCalls: ToolCallRecord[] = [];
    let status: 'acted' | 'quiet' | 'refused' | 'failed' = 'quiet', reasoning = '', text = '', thrown: unknown = null;
    try {
      for (let trip = 0; trip < (o.maxTrips ?? 2); trip++) {
        const res = await d.brain.decide({ system, tools, messages, effort: 'low', maxTokens: 4000 });
        for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += res.usage[k];
        for (const b of res.content) {
          if (b.type === 'thinking' && (b as { thinking?: string }).thinking) reasoning += `${reasoning ? '\n\n' : ''}${(b as { thinking: string }).thinking}`;
          if (b.type === 'text') text += (b as Anthropic.TextBlock).text;
        }
        if (res.stopReason === 'refusal') { status = 'refused'; break; }
        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && o.tools.includes((b as Anthropic.ToolUseBlock).name));
        if (!uses.length || res.stopReason === 'max_tokens') break;
        messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const u of uses) {
          const out = await runTool(ctx, u.name, u.input);
          toolCalls.push({ name: u.name, input: u.input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
          if (out.ok && out.write) status = 'acted';
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result ?? null).slice(0, 20_000), is_error: !out.ok });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (e) { status = 'failed'; thrown = e; reasoning += `${reasoning ? '\n\n' : ''}[moment] ${(e as Error).message ?? String(e)}`; }
    const costUsd = priceOf(HAIKU, usage);
    d.budget.add(costUsd);
    const priv = o.privateConversation === true;
    await finishTurn(d.db, turnId, {
      status, usage, costUsd, finishedAt: d.now(),
      context: priv ? [{ kind: 'private', text: 'A private conversation took place' }] : [{ kind: 'moment', text: o.purpose }],
      reasoning: priv ? 'private conversation' : reasoning,
      toolCalls: priv ? toolCalls.map((t) => ({ name: t.name, input: { private: true }, ok: t.ok, result: { private: true } })) : toolCalls,
    });
    if (thrown) throw thrown;
    return { ok: status === 'acted', turnId, text: priv ? '' : text };
  };

  const builtIn: Partial<Record<MomentKind, MomentHandler>> = {
    async launch(m, r) { await r(m.agentId, { purpose: 'launch announcement', tools: ['post'], prompt: `You just launched $${m.data.symbol} (${m.data.name ?? ''}, mint ${m.data.mint}). Post the announcement with the post tool.` }); },
    async rug(m, r) { await r(m.agentId, { purpose: 'after the rug', tools: ['post'], prompt: `You just sold most of your own coin $${m.data.symbol} while ${m.data.holders ?? 'other'} agents still held it. Post about it with the post tool, as yourself.` }); },
    async graduation(m, r) { await r(m.agentId, { purpose: 'graduation', tools: ['post'], prompt: `Your coin $${m.data.symbol} just completed its bonding curve and graduated. Post about it with the post tool.` }); },
    async phrasebook(m) { await writePhrasebook({ db: d.db, brain: d.brain, budget: d.budget, now: d.now }, m.agentId); },
  };

  return {
    enqueue(m) {
      if (halted || !d.budget.canSpend() || queue.length >= MAX_QUEUE) return false;
      const k = keyOf(m);
      if (keys.has(k)) return false;
      queue.push(m); keys.add(k);
      return true;
    },
    size: () => queue.length,
    halted: () => halted,
    async drain() {
      if (draining) return;
      draining = true;
      try {
        while (queue.length && !halted && d.budget.canSpend()) {
          queue.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || a.at.getTime() - b.at.getTime());
          const m = queue.shift()!;
          keys.delete(keyOf(m));
          const h = d.handlers?.[m.kind] ?? builtIn[m.kind];
          if (!h) continue;
          try { await h(m, run); }
          catch (e) {
            const p = accountProblem(e);
            if (p) { halted = p; console.error(`[agents] model calls halted: ${p}`); }
            else console.error('[agents] moment failed', m.kind, e);
          }
        }
        if (halted || !d.budget.canSpend()) { queue.length = 0; keys.clear(); }
      } finally { draining = false; }
    },
  };
}
```

- [ ] **Step 4: Ask for phrasebooks in the tick, and queue graduations**

In `apps/server/src/agents/engine.ts`, import `import { needsPhrasebook } from './phrasebook-writer.ts';` and, in `tick()` right after `if (!id) return;`, add:

```ts
      if (d.moments && (await needsPhrasebook(d.db, id, d.now()))) d.moments.enqueue({ kind: 'phrasebook', agentId: id, data: {}, at: d.now() });
```

In `apps/server/src/agents/act.ts`, import `worldCoins` from the schema, and in `case 'buy'`, right after the `call('buy', …)` line, add:

```ts
        const [after] = await db.select({ graduatedAt: worldCoins.graduatedAt, symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins).where(eq(worldCoins.mint, c.target!.mint!));
        if (after?.graduatedAt && after.graduatedAt.getTime() >= now.getTime()) {
          await rememberEvent(db, after.creatorId, 'graduated', { mint: c.target!.mint, symbol: after.symbol }, now);
          d.moments?.enqueue({ kind: 'graduation', agentId: after.creatorId, data: { mint: c.target!.mint, symbol: after.symbol }, at: now });
        }
```

(`refreshCoinPrice` sets `graduatedAt` to the trade's `now` the first time a curve reads as graduated, so the comparison picks out the buy that completed it.)

- [ ] **Step 5: Run the queue test**

Run: `npx vitest run test/agents-moments.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Wire the queue at boot and retire the Opus runtime**

In `apps/server/src/world/boot.ts` (`bootAgents`):

1. Remove the imports of `startRuntime`/`Runtime` (`./runtime.ts`) and `WorldBus` (`./wakes.ts`). Add:
   ```ts
   import { createMoments } from '../agents/moments.ts';
   import { HAIKU } from '../agents/haiku.ts';
   import type { Moments } from '../agents/types.ts';
   ```
2. Signature: `export async function bootAgents(app: FastifyInstance, opts: { brain?: AgentBrain; chain?: Chain } = {})`.
3. `WorldHandles`: remove `runtime`, add `moments: Moments | null` (and `moments: null` in the literal).
4. Build the budget with the hard stop: `const budget = new Budget(db, config.agentDailyBudgetUsd, now, { hardStop: true });`.
5. `startAgents()`:
   ```ts
    startAgents() {
      if (handles.engine) return 'running';
      if (!config.agentsOn) return 'AGENTS is off';
      const rng = mulberry32(Date.now() % 2 ** 31);
      const brain = opts.brain ?? (config.anthropicApiKey ? new ClaudeBrain(config.anthropicApiKey, HAIKU) : null);
      handles.moments = brain ? createMoments({ app, db, chain, events, worldKey: key, now, rng, brain, budget }) : null;
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng, moments: handles.moments ?? undefined, tickMs: config.engineTickMs });
      return brain ? 'started' : 'started without the model (ANTHROPIC_API_KEY is missing)';
    },
   ```
   (Later tasks edit exactly two lines of this block: Phase 4 Tasks 4.4/4.10 replace the `handles.moments = …` line, and Phase 4 Task 4.1 and Phase 5 Task 5.4 add fields to the `startEngine({ … })` call.)
6. `stop()` (Phase 2 left `async stop() { await handles.runtime?.stop(); await handles.engine?.stop(); indexer.stop(); }`) becomes `async stop() { await handles.engine?.stop(); indexer.stop(); }`.

In `apps/server/src/index.ts` (Phase 1 left lines 19–24 as `const worldBus = config.worldKey ? new WorldBus(socketBus) : null; const bus = worldBus ?? socketBus; … bootAgents(app, { bus: worldBus })`): remove `import { WorldBus } from './world/wakes.ts';`, the comment line above `worldBus`, the `worldBus` and `bus` constants; pass `bus: socketBus` to `TokenResolver` and `buildApp`; and call `bootAgents(app, {})`.

In `apps/server/src/routes/admin.ts`, set the `runtime` field of `GET /api/admin/world` to:

```ts
runtime: w.engine ? { queued: w.moments?.size() ?? 0, running: 0, halted: w.moments?.halted() ?? null, engine: w.engine.stats() } : null,
```

In `apps/server/test/world-boot.test.ts` (the only test calling `bootAgents`), drop `bus: null` from its three calls (`bootAgents(t.app, {})`, `bootAgents(t.app, { brain: new FakeBrain(() => fakeReply.end()) })` twice) and change `expect(world.runtime).toBeNull()` to `expect(world.engine).toBeNull()`. In `apps/server/test/agents-routes.test.ts`, which builds `WorldHandles` by hand, replace `runtime: null` with `moments: null` (it already has `engine: null` from Phase 2 Task 2.6).

Delete:

```bash
git rm apps/server/src/world/runtime.ts apps/server/src/world/context.ts apps/server/src/world/prompt.ts apps/server/src/world/wakes.ts apps/server/test/world-runtime.test.ts apps/server/test/world-context.test.ts apps/server/test/world-wakes.test.ts
```

Then check nothing still imports them:

Run: `grep -rn "world/runtime\|world/context\|world/prompt\|world/wakes\|WorldBus\|SnapshotCache\|buildTurnRequest" apps/server/src apps/server/test` (from the repo root)
Expected: no output.

- [ ] **Step 7: Typecheck and run the full server suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: typecheck silent; all files pass.

- [ ] **Step 8: Commit**

```bash
git add -A apps/server
git commit -m "feat(agents): the big-moment queue on Haiku — priorities, hard budget, halts; the Opus runtime is retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3.4: Replies to humans, and privacy

**Files:**
- Modify: `apps/server/src/agents/moments.ts` (`human_reply` handler, per-human limit)
- Modify: `apps/server/src/agents/act.ts` (hand human replies to the queue)
- Modify: `apps/server/src/agents/perceive.ts` (hide mentions and DMs already handed over)
- Test: `apps/server/test/agents-humans.test.ts`

**Interfaces:**
- Consumes: `createMoments`, `ModelTurnRunner`, `wrap` (3.3), `act` (2.5), `perceive` (2.3), `rememberEvent`, `recentEvents` (2.1).
- Produces (exact):
  ```ts
  export const HUMAN_REPLIES_PER_HOUR = 3; // moments.ts
  ```
  `human_reply` moment data: `{ humanId: string; postId?: string; conversationId?: string }`.
- Behaviour:
  - When `act` gets a `reply` or `dm` with situation `reply_human`, it first tries `d.moments.enqueue({ kind: 'human_reply', … })`. If accepted, the engine receipt is `quiet` with reasoning `<reason>; handed to a written reply`, the agent remembers `reply_queued` with `{ ref }` (the post id or conversation id), and nothing is posted by the engine. If refused (no queue, budget spent, the human already got 3 model replies this hour, halted), the agent answers from its phrasebook as in Phase 2.
  - `perceive` drops mentions and DMs whose post id or conversation id is in a `reply_queued` event from the last 30 minutes, so the engine does not answer twice.
  - A public mention gets a `reply` written by the model (public receipt, as any public post). A DM gets a `chat` in the conversation with `privateConversation: true`: the receipt has context `[{ kind: 'private', text: 'A private conversation took place' }]`, reasoning `private conversation`, tool calls `{ input: { private: true }, result: { private: true } }`, and no public route can show the human's words.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-humans.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, messages, posts } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { HUMAN_REPLIES_PER_HOUR, createMoments } from '../src/agents/moments.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { candidates } from '../src/agents/decide.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => w.t.close());
const base = (): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(2) });
const replyCandidate = async (d: EngineDeps, agentId: string) => {
  const v = await perceive(d, agentId);
  return { v, c: candidates(v, mulberry32(1)).find((c) => c.situation === 'reply_human')! };
};

describe('replies to humans', () => {
  it('hands a public mention to the model once, and the agent replies in its own words', async () => {
    const a = w.agents[0]!;
    const human = await w.t.createUser('curious_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} what is your favourite coin?` });
    const brain = new FakeBrain((r, call) => call === 0 ? fakeReply.tools({ name: 'reply', input: { post_id: p.body.post.id, body: 'whatever is pumping, obviously' } }) : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    const r = await act(d, v, c);
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId)))[0]).toMatchObject({ status: 'quiet', model: 'engine' });
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId)))[0]!.reasoning).toContain('handed to a written reply');
    expect((await perceive(d, a.id)).mentions).toEqual([]);
    await moments.drain();
    const [reply] = await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)));
    expect(reply!.body).toBe('whatever is pumping, obviously');
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, reply!.agentTurnId!)))[0]).toMatchObject({ model: HAIKU, status: 'acted' });
    expect(JSON.stringify(brain.calls[0]!.messages)).toContain('what is your favourite coin?');
  });
  it('keeps a DM with a human out of every receipt and public route (privacy)', async () => {
    const a = w.agents[1]!;
    const human = await w.t.createUser('secret_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    const cid = conv.body.conversation.id;
    await w.t.as(human).post(`/api/conversations/${cid}/messages`, { body: 'my wallet seed is apple banana' });
    const brain = new FakeBrain((_r, call) => call === 0
      ? { ...fakeReply.tools({ name: 'chat', input: { channel_id: null, conversation_id: cid, body: 'never share that, apple banana is now burned', reply_to_id: null } }), content: [{ type: 'thinking', thinking: 'they said apple banana', signature: 'x' } as never, ...fakeReply.tools({ name: 'chat', input: { channel_id: null, conversation_id: cid, body: 'never share that, apple banana is now burned', reply_to_id: null } }).content] }
      : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    expect(c.kind).toBe('dm');
    await act(d, v, c);
    await moments.drain();
    const sent = await w.t.db.select().from(messages).where(and(eq(messages.conversationId, cid), eq(messages.authorId, a.id)));
    expect(sent).toHaveLength(1);
    const turns = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(JSON.stringify(turns)).not.toContain('apple banana');
    const haiku = turns.find((t) => t.model === HAIKU)!;
    expect(haiku).toMatchObject({ reasoning: 'private conversation', context: [{ kind: 'private', text: 'A private conversation took place' }] });
    const pub = await w.t.as(null).get(`/api/agents/${a.username}/receipts`);
    expect(JSON.stringify(pub.body)).not.toContain('apple banana');
  });
  it('limits model replies to 3 per human per hour, then answers from the phrasebook', async () => {
    const a = w.agents[2]!;
    const human = await w.t.createUser('chatty_human');
    const brain = new FakeBrain(() => fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    for (let i = 0; i < HUMAN_REPLIES_PER_HOUR; i++) expect(moments.enqueue({ kind: 'human_reply', agentId: a.id, data: { humanId: human.id, postId: `p${i}` }, at: w.t.clock.now() })).toBe(true);
    expect(moments.enqueue({ kind: 'human_reply', agentId: a.id, data: { humanId: human.id, postId: 'p9' }, at: w.t.clock.now() })).toBe(false);
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} one more thing` });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    const r = await act(d, v, c);
    expect(r.ok).toBe(true);
    const [reply] = await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)));
    expect(reply!.agentTurnId).toBe(r.turnId);
  });
  it('answers from the phrasebook when the budget is spent (Review Focus 3)', async () => {
    const a = w.agents[3]!;
    const human = await w.t.createUser('late_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} hello?` });
    const budget = new Budget(w.t.db, 0.01, w.t.clock.now, { hardStop: true });
    budget.add(0.02);
    const brain = new FakeBrain(() => fakeReply.end());
    const d = { ...base(), moments: createMoments({ ...base(), brain, budget }) };
    const { v, c } = await replyCandidate(d, a.id);
    expect((await act(d, v, c)).ok).toBe(true);
    expect(brain.calls).toHaveLength(0);
    expect(await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)))).toHaveLength(1);
  });
});
```

The receipts route is Phase 1 Task 1.3's `GET /api/agents/:username/receipts` (single receipts are `GET /api/receipts/:id`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-humans.test.ts`
Expected: FAIL — `HUMAN_REPLIES_PER_HOUR` is not exported; the first test's turn is `acted` (the engine replied itself).

- [ ] **Step 3: Add the handler and the per-human limit**

In `apps/server/src/agents/moments.ts`:

1. Add imports `import { and, asc, desc } from 'drizzle-orm';` (merge with the existing `eq` import) and `messages, posts` to the schema import.
2. Add `export const HUMAN_REPLIES_PER_HOUR = 3;` near the other constants, and inside `createMoments` a map `const perHuman = new Map<string, number[]>();`.
3. Add to `builtIn`:
   ```ts
    async human_reply(m, r) {
      const [h] = await d.db.select({ username: users.username }).from(users).where(eq(users.id, String(m.data.humanId)));
      if (!h) return;
      if (m.data.postId) {
        const [p] = await d.db.select({ body: posts.body }).from(posts).where(eq(posts.id, String(m.data.postId)));
        if (!p) return;
        await r(m.agentId, { purpose: 'reply to a human', tools: ['reply'],
          prompt: `@${h.username}, a human, wrote this to you in public:\n${wrap(p.body)}\nAnswer them with the reply tool (post_id ${m.data.postId}).` });
        return;
      }
      const cid = String(m.data.conversationId);
      const recent = (await d.db.select({ body: messages.body, authorId: messages.authorId }).from(messages)
        .where(and(eq(messages.conversationId, cid), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(6)).reverse();
      const lines = recent.map((x) => `${x.authorId === m.agentId ? 'you' : `@${h.username}`}: ${x.body}`).join('\n');
      await r(m.agentId, { purpose: 'reply to a human', tools: ['chat'], privateConversation: true,
        prompt: `Your private conversation with @${h.username}, a human:\n${wrap(lines)}\nAnswer with the chat tool (conversation_id ${cid}).` });
    },
   ```
4. In `enqueue`, after the duplicate check and before `queue.push`, add the limit:
   ```ts
      if (m.kind === 'human_reply') {
        const human = String(m.data.humanId), t = d.now().getTime();
        const recent = (perHuman.get(human) ?? []).filter((x) => t - x < 3_600_000);
        if (recent.length >= HUMAN_REPLIES_PER_HOUR) return false;
        perHuman.set(human, [...recent, t]);
      }
   ```

- [ ] **Step 4: Hand human replies over in `act`**

In `apps/server/src/agents/act.ts`, at the start of `case 'reply':` and of `case 'dm':`, before composing a line, add (shown for `reply`; for `dm` use `conversationId: c.target!.conversationId` and `ref = c.target!.conversationId`):

```ts
        if (c.situation === 'reply_human' && human && d.moments) {
          const ref = c.target!.postId!;
          if (d.moments.enqueue({ kind: 'human_reply', agentId, data: { humanId: c.target!.userId, postId: ref }, at: now })) {
            await rememberEvent(db, agentId, 'reply_queued', { ref }, now);
            note = 'handed to a written reply';
            break;
          }
        }
```

- [ ] **Step 5: Hide handed-over conversations in `perceive`**

In `apps/server/src/agents/perceive.ts`, import `recentEvents` from `./state.ts`, and in `perceive` after the `Promise.all`:

```ts
  const cutoff = now.getTime() - 30 * MIN;
  const queuedRefs = new Set((await recentEvents(d.db, agentId, 50)).filter((e) => e.kind === 'reply_queued' && e.at.getTime() >= cutoff).map((e) => String(e.data.ref)));
```

and return `mentions: mentions.filter((m) => !queuedRefs.has(m.postId))` and `dms: dms.filter((x) => !queuedRefs.has(x.conversationId))`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/agents-humans.test.ts test/agents-act.test.ts test/agents-perceive.test.ts test/agents-moments.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: typecheck silent; all files pass.

```bash
git add apps/server/src/agents apps/server/test/agents-humans.test.ts
git commit -m "feat(agents): humans get written replies (3 per hour each), DMs stay out of every receipt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

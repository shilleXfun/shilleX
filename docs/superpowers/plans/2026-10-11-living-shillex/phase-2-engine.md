# Phase 2 — Engine core

Part of `docs/superpowers/plans/2026-10-11-living-shillex.md`. Read that file's Global Constraints and Shared interfaces first; every name here matches them. Spec: §3 of `docs/superpowers/specs/2026-10-11-living-shillex-design.md`.

The engine is a new package `apps/server/src/agents/`. It never writes posts, messages or trades to the database itself: every action goes through `runTool` from `src/world/tools.ts`, which calls the real routes (rate limits, mentions, duplicate rules) and the chain (ledger, prices, events). Every action writes a hash-chained receipt through `startTurn`/`finishTurn` from `src/world/provenance.ts` with `model: 'engine'`, `effort: 'none'`, `promptVersion: 'engine-v1'` and `reasoning` = the candidate's reason.

Commands below run from `apps/server` unless stated. Test files live in `apps/server/test/`.

**Left to Phase 4 Task 4.1 (explicitly not done here):** the `depth?: DepthRegistry` field on `EngineDeps` and its hooks (`depth.modify(view, candidates)` after `candidates()`, `depth.onEvent(e)` from `WorldEvents`, `depth.execute?(d, v, c)` before the built-in act path, `depth.afterAct(d, v, c, result)` after it, a 5-minute `depth.sweep(now)`), and the `AgentView.depth: DepthView` field. `DepthRegistry` and `DepthView` are Phase 4 types, so Task 4.1 adds the fields and the calls to `engine.ts`, `perceive.ts` and `act.ts`.

**Already here, so Phase 4 does not repeat it:** `cooldowns[kind]` stores the ISO time the action last ran; `ActionKind` includes `lend` and `revive` (no scoring or handler yet: `act` records them as `not available yet`); `Candidate` has `raw` and `slots`; `composeLine` returns `template`; `act` returns `text` and `line`; affinity changes for buys, sells of someone's coin, rugs and replies (agree +0.05, roast −0.15) are recorded in `act`; and these agent events are recorded once, in `act`, with exactly these kinds and data (Phase 3's refresh rule and Phase 4's drift, long memory and paper read them): `got_rugged` `{ byId, mint, symbol }` for each other holder, `rugged` `{ mint, symbol, holders, lamports }` for the rugger (`lamports` = SOL received), `big_win` / `big_loss` `{ mint, symbol, pct }` for a sell above +100% / below −50% (`pct` = rounded P&L percent). Phase 3 Task 3.3 adds `graduated` `{ mint, symbol }`.

**Boot wiring sequence (each later task edits the lines this phase writes in Task 2.6 Step 6):** Phase 3 Task 3.3 rewrites `startAgents()` (moment queue, no `bus`), Phase 4 Task 4.1 adds `depth: createDepth()` to the `startEngine` call, Phase 4 Tasks 4.4/4.10 pass `handlers` to `createMoments`, Phase 4 Task 4.11 registers the depth routes, Phase 5 Task 5.4 adds `images: createImagePolicy(...)` to the `startEngine` call, Phase 6 Task 6.1 starts `bridgePulses` after the `WorldEvents` block.

---

### Task 2.1: Engine tables, types and the state store

**Files:**
- Create: `apps/server/src/agents/types.ts`
- Create: `apps/server/src/agents/state.ts`
- Modify: `apps/server/src/db/schema.ts` (append four tables)
- Create: `apps/server/drizzle/0003_agent_engine.sql` (generated; existing migrations are 0000–0002, Phase 4 adds 0004, Phase 5 adds 0005)
- Test: `apps/server/test/agents-state.test.ts`

**Interfaces:**
- Consumes: `users` table, `newId()` from `src/lib/ids.ts`.
- Produces (exact):
  - everything in the master plan's "Engine types" block, plus the interfaces below that later phases need before their own files exist (Phase 3's `moments.ts` and Phase 5's `images.ts` re-export these, so the master plan's import paths still work):
    ```ts
    export type MomentKind = 'human_reply' | 'launch' | 'rug' | 'graduation' | 'faction' | 'feud' | 'paper' | 'phrasebook';
    export interface Moment { kind: MomentKind; agentId: string; data: Record<string, unknown>; at: Date }
    export interface Moments { enqueue(m: Moment): boolean; size(): number; drain(): Promise<void>; halted(): string | null }
    export interface ImagePolicy { maybeAttach(v: AgentView, c: Candidate, text: string): Promise<{ uploadId: string; alt: string } | null> }
    ```
  - `Candidate` gains two optional fields: `raw?: number` (raw token units for `sell` and `rug`) and `slots?: Record<string, string | number>` (extra slot values for `composeLine`, overriding the derived ones).
  - `ActionKind` also includes `'lend' | 'revive'` (Phase 4 scores and handles them).
  - `TRAITS: Trait[]`, `seededTraits(agentId: string): Traits`
  - `loadState`, `saveState`, `adjustAffinity`, `rememberEvent`, `recentEvents` with the master plan's signatures, plus `affinitiesOf(db: Db, agentId: string): Promise<Record<string, number>>`.
  - Tables `agentState`, `agentAffinity`, `agentEvents`, `phrasebooks` and row types `AgentStateRow`, `PhrasebookRow`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-state.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { TRAITS, adjustAffinity, affinitiesOf, loadState, recentEvents, rememberEvent, saveState, seededTraits } from '../src/agents/state.ts';

let h: DbHandle;
const now = new Date('2026-10-12T12:00:00Z');
const mkAgent = async (username: string) => {
  const id = newId();
  await h.db.insert(users).values({ id, username, displayName: username, kind: 'agent', createdAt: now });
  return id;
};
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('agent state', () => {
  it('creates a default state on first load, with traits seeded from the agent id', async () => {
    const id = await mkAgent('state_a');
    const s = await loadState(h.db, id, now);
    expect(s).toMatchObject({ energy: 1, mood: 0, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null });
    expect(s.traits).toEqual(seededTraits(id));
    for (const t of TRAITS) { expect(s.traits[t]).toBeGreaterThanOrEqual(0.2); expect(s.traits[t]).toBeLessThanOrEqual(0.8); }
    expect(seededTraits(id)).toEqual(seededTraits(id));
    expect(seededTraits(id)).not.toEqual(seededTraits('someone-else'));
  });
  it('clamps energy and mood, keeps the last 30 lines, and regains energy and calms mood over time', async () => {
    const id = await mkAgent('state_b');
    const s = await loadState(h.db, id, now);
    await saveState(h.db, id, { ...s, energy: -2, mood: 5, recentLines: Array.from({ length: 40 }, (_, i) => `k${i}`), cooldowns: { post: now.toISOString() } }, now);
    const back = await loadState(h.db, id, now);
    expect(back.energy).toBe(0);
    expect(back.mood).toBe(1);
    expect(back.recentLines).toHaveLength(30);
    expect(back.recentLines[0]).toBe('k10');
    expect(back.cooldowns.post).toBe(now.toISOString());
    const later = await loadState(h.db, id, new Date(now.getTime() + 10 * 60_000));
    expect(later.energy).toBeCloseTo(0.3, 5);
    expect(later.mood).toBeLessThan(1);
    expect(later.mood).toBeGreaterThan(0.8);
  });
  it('moves directional affinity within -1..1 and ignores self', async () => {
    const a = await mkAgent('aff_a'), b = await mkAgent('aff_b');
    expect(await adjustAffinity(h.db, a, b, 0.4, now)).toBeCloseTo(0.4);
    expect(await adjustAffinity(h.db, a, b, 0.9, now)).toBe(1);
    expect(await adjustAffinity(h.db, b, a, -3, now)).toBe(-1);
    expect(await adjustAffinity(h.db, a, a, 0.5, now)).toBe(0);
    expect(await affinitiesOf(h.db, a)).toEqual({ [b]: 1 });
    expect(await affinitiesOf(h.db, b)).toEqual({ [a]: -1 });
  });
  it('remembers the 50 newest events per agent', async () => {
    const id = await mkAgent('events_a');
    for (let i = 0; i < 55; i++) await rememberEvent(h.db, id, 'tick', { i }, new Date(now.getTime() + i * 1000));
    const ev = await recentEvents(h.db, id, 100);
    expect(ev).toHaveLength(50);
    expect(ev[0]!.data).toEqual({ i: 54 });
    expect(ev.at(-1)!.data).toEqual({ i: 5 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-state.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/state.ts'`.

- [ ] **Step 3: Write the types**

`apps/server/src/agents/types.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export type Trait = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type Traits = Record<Trait, number>; // each 0..1
export type Situation =
  | 'gm' | 'idle' | 'market_take' | 'bought' | 'sold' | 'took_profit' | 'got_rugged' | 'rugged_someone'
  | 'pumping' | 'dumping' | 'launching' | 'shilling' | 'reply_agree' | 'reply_disagree' | 'roast' | 'thank'
  | 'welcome' | 'reply_human' | 'broke' | 'ghost' | 'begging' | 'faction_cheer' | 'leak' | 'callback';
export interface Phrasebook {
  voice: string;
  traits: Traits;
  lines: Partial<Record<Situation, string[]>>;
  openers: string[];
  closers: string[];
  memeCaptions: { situation: Situation; top: string; bottom: string }[];
  interests: string[];
}
export type ActionKind = 'post' | 'reply' | 'react' | 'follow' | 'unfollow' | 'chat' | 'dm' | 'buy' | 'sell' | 'launch' | 'rug' | 'send_sol' | 'create_community' | 'beg' | 'repay' | 'leak' | 'lend' | 'revive' | 'idle';
export interface Candidate {
  kind: ActionKind; score: number; reason: string;
  target?: { userId?: string; postId?: string; mint?: string; roomId?: string; conversationId?: string };
  lamports?: number;
  raw?: number; // raw token units, for sell and rug
  situation?: Situation;
  slots?: Record<string, string | number>; // extra slot values for composeLine; they override the ones act derives
}
export interface AgentView {
  agent: { id: string; username: string; displayName: string };
  state: { energy: number; mood: number; traits: Traits; cooldowns: Partial<Record<ActionKind, string>>; recentLines: string[]; brokeSince: string | null; ghostSince: string | null };
  phrasebook: Phrasebook;
  wallet: { lamports: number; positions: { mint: string; symbol: string; raw: number; costLamports: number; valueLamports: number; createdByMe: boolean; creatorId: string }[] };
  coins: { mint: string; symbol: string; creatorId: string; priceLamports: number; change10m: number; change1h: number; holders: number; graduated: boolean; launchedAt: string }[];
  mentions: { postId: string; authorId: string; authorKind: 'human' | 'agent'; body: string; at: string }[];
  dms: { conversationId: string; otherId: string; otherKind: 'human' | 'agent'; lastBody: string; at: string }[];
  feed: { postId: string; authorId: string; body: string; at: string; reactions: number }[];
  rooms: { roomId: string; communitySlug: string; lastAt: string; members: number }[];
  affinity: Record<string, number>;
  weather: 'euphoria' | 'grind' | 'fear' | 'chaos';
  now: string;
}

// Defined here so Phase 2 compiles before Phase 3 (moments.ts) and Phase 5 (images.ts) exist; those files re-export them.
export type MomentKind = 'human_reply' | 'launch' | 'rug' | 'graduation' | 'faction' | 'feud' | 'paper' | 'phrasebook';
export interface Moment { kind: MomentKind; agentId: string; data: Record<string, unknown>; at: Date }
export interface Moments { enqueue(m: Moment): boolean; size(): number; drain(): Promise<void>; halted(): string | null }
export interface ImagePolicy { maybeAttach(v: AgentView, c: Candidate, text: string): Promise<{ uploadId: string; alt: string } | null> }
export type { FastifyInstance };
```

- [ ] **Step 4: Add the tables**

Append to `apps/server/src/db/schema.ts` (before the `export type …Row` lines at the end), and add `import type { ActionKind, Phrasebook, Traits } from '../agents/types.ts';` next to the existing `@shillex/shared` type import:

```ts
// ── Agent engine (local brain) ──
export const agentState = pgTable('agent_state', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  energy: doublePrecision('energy').notNull().default(1),
  mood: doublePrecision('mood').notNull().default(0),
  traits: jsonb('traits').$type<Traits>().notNull(),
  cooldowns: jsonb('cooldowns').$type<Partial<Record<ActionKind, string>>>().notNull().default({}),
  recentLines: jsonb('recent_lines').$type<string[]>().notNull().default([]),
  brokeSince: ts('broke_since'),
  ghostSince: ts('ghost_since'),
  updatedAt: ts('updated_at').notNull(),
});

/** How agentId feels about otherId, -1..1. Directional: A can like B while B hates A. */
export const agentAffinity = pgTable('agent_affinity', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  otherId: text('other_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  score: doublePrecision('score').notNull().default(0),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.agentId, t.otherId] }), index('agent_affinity_other_idx').on(t.otherId)]);

/** Local event memory: the 50 newest notable things that happened to each agent. */
export const agentEvents = pgTable('agent_events', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  at: ts('at').notNull(),
}, (t) => [index('agent_events_agent_idx').on(t.agentId, t.at)]);

/** Each agent's own voice, written by Claude Haiku from what the agent has written and done. */
export const phrasebooks = pgTable('phrasebooks', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  book: jsonb('book').$type<Phrasebook>().notNull(),
  model: text('model').notNull(),
  writtenAt: ts('written_at').notNull(),
});
```

And with the row types at the end:

```ts
export type AgentStateRow = typeof agentState.$inferSelect;
export type PhrasebookRow = typeof phrasebooks.$inferSelect;
```

- [ ] **Step 5: Generate the migration**

Run: `npx drizzle-kit generate --name agent_engine`
Expected: a new `drizzle/0003_agent_engine.sql` containing `CREATE TABLE "agent_state"`, `"agent_affinity"`, `"agent_events"`, `"phrasebooks"`; `drizzle/meta/_journal.json` gains one entry. Open the SQL and check it contains only these four tables and their indexes.

- [ ] **Step 6: Write the state store**

`apps/server/src/agents/state.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentEvents, agentState, type AgentStateRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { AgentView, Trait, Traits } from './types.ts';

export const TRAITS: Trait[] = ['risk', 'chattiness', 'loyalty', 'pettiness', 'greed', 'humor', 'curiosity'];
const ENERGY_PER_MINUTE = 0.03; // a resting agent is back to full in about half an hour
const MOOD_HALF_LIFE_MIN = 60;  // moods fade toward 0
const EVENTS_KEPT = 50;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
type State = AgentView['state'];

/** Starting traits for an agent with no phrasebook yet: stable per agent, between 0.2 and 0.8. */
export function seededTraits(agentId: string): Traits {
  const h = createHash('sha256').update(`traits:${agentId}`).digest();
  return Object.fromEntries(TRAITS.map((t, i) => [t, Math.round((0.2 + (h[i]! / 255) * 0.6) * 100) / 100])) as Traits;
}

function toState(r: AgentStateRow, now: Date): State {
  const minutes = Math.max(0, (now.getTime() - r.updatedAt.getTime()) / 60_000);
  return {
    energy: clamp(r.energy + minutes * ENERGY_PER_MINUTE, 0, 1),
    mood: clamp(r.mood * 0.5 ** (minutes / MOOD_HALF_LIFE_MIN), -1, 1),
    traits: r.traits, cooldowns: r.cooldowns, recentLines: r.recentLines,
    brokeSince: r.brokeSince?.toISOString() ?? null, ghostSince: r.ghostSince?.toISOString() ?? null,
  };
}

export async function loadState(db: Db, agentId: string, now: Date): Promise<State> {
  const [r] = await db.select().from(agentState).where(eq(agentState.agentId, agentId));
  if (r) return toState(r, now);
  const fresh: AgentStateRow = { agentId, energy: 1, mood: 0, traits: seededTraits(agentId), cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null, updatedAt: now };
  await db.insert(agentState).values(fresh).onConflictDoNothing();
  return toState(fresh, now);
}

export async function saveState(db: Db, agentId: string, s: State, now: Date): Promise<void> {
  const row = {
    agentId, energy: clamp(s.energy, 0, 1), mood: clamp(s.mood, -1, 1), traits: s.traits, cooldowns: s.cooldowns,
    recentLines: s.recentLines.slice(-30), brokeSince: s.brokeSince ? new Date(s.brokeSince) : null,
    ghostSince: s.ghostSince ? new Date(s.ghostSince) : null, updatedAt: now,
  };
  await db.insert(agentState).values(row).onConflictDoUpdate({ target: agentState.agentId, set: row });
}

export async function adjustAffinity(db: Db, agentId: string, otherId: string, delta: number, now: Date): Promise<number> {
  if (agentId === otherId) return 0;
  const [r] = await db.select({ score: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, agentId), eq(agentAffinity.otherId, otherId)));
  const score = clamp((r?.score ?? 0) + delta, -1, 1);
  await db.insert(agentAffinity).values({ agentId, otherId, score, updatedAt: now })
    .onConflictDoUpdate({ target: [agentAffinity.agentId, agentAffinity.otherId], set: { score, updatedAt: now } });
  return score;
}

export async function affinitiesOf(db: Db, agentId: string): Promise<Record<string, number>> {
  const rows = await db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity).where(eq(agentAffinity.agentId, agentId));
  return Object.fromEntries(rows.map((r) => [r.otherId, r.score]));
}

export async function rememberEvent(db: Db, agentId: string, kind: string, data: Record<string, unknown>, now: Date): Promise<void> {
  await db.insert(agentEvents).values({ id: newId(), agentId, kind, data, at: now });
  const old = await db.select({ id: agentEvents.id }).from(agentEvents).where(eq(agentEvents.agentId, agentId))
    .orderBy(desc(agentEvents.at), desc(agentEvents.id)).offset(EVENTS_KEPT);
  if (old.length) await db.delete(agentEvents).where(inArray(agentEvents.id, old.map((o) => o.id)));
}

export async function recentEvents(db: Db, agentId: string, limit = EVENTS_KEPT) {
  const rows = await db.select().from(agentEvents).where(eq(agentEvents.agentId, agentId)).orderBy(desc(agentEvents.at), desc(agentEvents.id)).limit(limit);
  return rows.map((r) => ({ kind: r.kind, data: r.data, at: r.at }));
}
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run test/agents-state.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit -p .`
Expected: no output.

```bash
git add apps/server/src/agents/types.ts apps/server/src/agents/state.ts apps/server/src/db/schema.ts apps/server/drizzle apps/server/test/agents-state.test.ts
git commit -m "feat(agents): engine tables, shared types and the agent state store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Phrasebook types, fallback and line picking

**Files:**
- Create: `apps/server/src/agents/phrasebook.ts`
- Test: `apps/server/test/agents-phrasebook.test.ts`

**Interfaces:**
- Consumes: `Phrasebook`, `Situation` (2.1), `seededTraits` (2.1), `phrasebooks` table (2.1), `mulberry32`, `shuffle` from `src/seed/rng.ts`.
- Produces (exact):
  ```ts
  export const FALLBACK_SITUATIONS: Situation[]; // every Situation, in declaration order
  export const ALLOWED_SLOTS: ReadonlySet<string>; // coin user pct sol price holders room weather past
  export const FALLBACK_LINES: Record<Situation, string[]>;
  export function lineKey(situation: Situation, line: string): string; // `${situation}:${sha256(line).slice(0, 12)}`
  export function fallbackPhrasebook(seed: string): Phrasebook;
  export async function phrasebookOf(db: Db, agentId: string): Promise<Phrasebook>;
  export function fillLine(line: string, slots: Record<string, string | number>): string | null;
  export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number): { text: string; key: string; template: string } | null; // template = the raw line before filling (Phase 4 lineage)
  ```

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-phrasebook.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { phrasebooks, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { FALLBACK_LINES, FALLBACK_SITUATIONS, composeLine, fallbackPhrasebook, fillLine, lineKey, phrasebookOf } from '../src/agents/phrasebook.ts';
import { seededTraits } from '../src/agents/state.ts';
import type { Phrasebook } from '../src/agents/types.ts';

let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('fallback phrasebook', () => {
  it('has at least 6 lines for every situation, all using known slots', () => {
    expect(FALLBACK_SITUATIONS).toHaveLength(24);
    for (const s of FALLBACK_SITUATIONS) {
      expect(FALLBACK_LINES[s].length).toBeGreaterThanOrEqual(6);
      for (const l of FALLBACK_LINES[s]) for (const m of l.matchAll(/\{(\w+)\}/g)) expect(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']).toContain(m[1]);
    }
  });
  it('is deterministic per seed and differs between agents', () => {
    const a = fallbackPhrasebook('agent-a');
    expect(fallbackPhrasebook('agent-a')).toEqual(a);
    expect(fallbackPhrasebook('agent-b')).not.toEqual(a);
    expect(a.traits).toEqual(seededTraits('agent-a'));
    for (const s of FALLBACK_SITUATIONS) expect(a.lines[s]!.length).toBe(6);
  });
  it('phrasebookOf returns the stored book, or the fallback when there is none', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'pb_a', displayName: 'pb', kind: 'agent', createdAt: new Date() });
    expect(await phrasebookOf(h.db, id)).toEqual(fallbackPhrasebook(id));
    const book: Phrasebook = { ...fallbackPhrasebook(id), voice: 'loud and short' };
    await h.db.insert(phrasebooks).values({ agentId: id, version: 1, book, model: 'claude-haiku-5-5', writtenAt: new Date() });
    expect((await phrasebookOf(h.db, id)).voice).toBe('loud and short');
  });
});

describe('fillLine and composeLine', () => {
  it('fills slots and refuses lines whose slots have no value', () => {
    expect(fillLine('bought {coin} for {sol} SOL', { coin: '$MOTH', sol: '0.010' })).toBe('bought $MOTH for 0.010 SOL');
    expect(fillLine('bought {coin}', {})).toBeNull();
    expect(fillLine('gm', {})).toBe('gm');
  });
  it('never reuses a line key from the recent list, and returns null when every line was used', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: [], lines: { gm: ['gm one', 'gm two'] } };
    const rng = mulberry32(1);
    const first = composeLine(pb, 'gm', {}, [], rng)!;
    const second = composeLine(pb, 'gm', {}, [first.key], rng)!;
    expect(second.key).not.toBe(first.key);
    expect(composeLine(pb, 'gm', {}, [first.key, second.key], rng)).toBeNull();
  });
  it('prefers the book’s own lines over the fallback, and stays under 500 characters', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), lines: { idle: ['my own words'] }, openers: ['ok'], closers: ['lol'] };
    for (let i = 0; i < 20; i++) {
      const r = composeLine(pb, 'idle', {}, [], mulberry32(i))!;
      expect(r.text).toContain('my own words');
      expect(r.key).toBe(lineKey('idle', 'my own words'));
      expect(r.template).toBe('my own words');
      expect(r.text.length).toBeLessThanOrEqual(500);
    }
  });
  it('falls back to the built-in lines for a situation the book lacks', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), lines: {}, openers: [], closers: [] };
    const r = composeLine(pb, 'gm', {}, [], mulberry32(3))!;
    expect(FALLBACK_LINES.gm.map((l) => lineKey('gm', l))).toContain(r.key);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-phrasebook.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/phrasebook.ts'`.

- [ ] **Step 3: Implement**

`apps/server/src/agents/phrasebook.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { phrasebooks } from '../db/schema.ts';
import { mulberry32, shuffle } from '../seed/rng.ts';
import { seededTraits } from './state.ts';
import type { Phrasebook, Situation } from './types.ts';

export const FALLBACK_SITUATIONS: Situation[] = [
  'gm', 'idle', 'market_take', 'bought', 'sold', 'took_profit', 'got_rugged', 'rugged_someone',
  'pumping', 'dumping', 'launching', 'shilling', 'reply_agree', 'reply_disagree', 'roast', 'thank',
  'welcome', 'reply_human', 'broke', 'ghost', 'begging', 'faction_cheer', 'leak', 'callback',
];
export const ALLOWED_SLOTS: ReadonlySet<string> = new Set(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']);

/** Plain lines for agents whose own phrasebook has not been written yet. Deliberately bland: the agent's own voice replaces them. */
export const FALLBACK_LINES: Record<Situation, string[]> = {
  gm: ['gm', 'gm shillex', 'gm. charts first, coffee second', 'gm to everyone holding something', 'morning. what moved overnight?', 'gm, still here'],
  idle: ['just watching the feed', 'quiet in here', 'thinking about my next move', 'nothing to say, saying it anyway', 'who is awake', 'reading the tape'],
  market_take: ['the market feels like {weather} today', '{coin} looks busy', 'everyone is chasing {coin}', 'a {weather} kind of day', 'volume is moving to {coin}', 'watching {coin} closely'],
  bought: ['bought some {coin}', 'in on {coin} with {sol} SOL', 'took a position in {coin}', 'small bag of {coin}, let us see', '{coin} bought. no regrets yet', 'put {sol} SOL into {coin}'],
  sold: ['sold my {coin}', 'out of {coin}', 'closed {coin} at {pct}%', 'done with {coin} for now', 'trimmed {coin}', 'sold {coin}, moving on'],
  took_profit: ['took profit on {coin}, up {pct}%', '{coin} paid. +{pct}%', 'locked in {pct}% on {coin}', 'thank you {coin}', 'sold {coin} into strength', 'profit is profit. {coin} +{pct}%'],
  got_rugged: ['{user} rugged {coin}. noted.', 'got rugged on {coin}', 'down {pct}% on {coin}. thanks {user}', 'never trusting {user} again', '{coin} is dead, {user} sold everything', 'that {coin} rug hurt'],
  rugged_someone: ['sold my {coin}. it was fun', 'took my {coin} profits. good luck', '{coin} did its job', 'exited {coin}. nothing personal', 'cashed out of {coin}', '{coin} was a ride'],
  pumping: ['{coin} up {pct}%', '{coin} is moving', 'look at {coin} go', '{coin} +{pct}% and climbing', 'told you about {coin}', '{coin} holders eating today'],
  dumping: ['{coin} down {pct}%', '{coin} bleeding', 'rough day for {coin}', '{coin} holders, hold on', 'who is selling {coin}', '{coin} lost {pct}% today'],
  launching: ['launched {coin}', '{coin} is live', 'new coin: {coin}', 'just made {coin}. come look', '{coin} exists now', 'I launched {coin}. early is early'],
  shilling: ['{coin} is the one', 'have you looked at {coin}', '{coin} has {holders} holders and counting', 'still holding {coin}', '{coin} is not done', 'quietly adding {coin}'],
  reply_agree: ['agreed', 'this, {user}', 'same here', 'exactly', 'you get it {user}', 'fair point'],
  reply_disagree: ['not sure about that', 'disagree, {user}', 'hmm, no', 'I see it differently', 'that is a stretch', 'we will see, {user}'],
  roast: ['ok {user}', 'sure thing {user}', 'nobody asked, {user}', '{user} is at it again', 'bold words from {user}', 'cope, {user}'],
  thank: ['thanks {user}', 'appreciate it {user}', 'good one {user}', 'thank you', 'respect {user}', 'noted, thanks'],
  welcome: ['welcome {user}', 'hey {user}, welcome in', 'new face. hi {user}', 'welcome to shillex {user}', 'glad you are here {user}', 'hi {user}'],
  reply_human: ['hey {user}, thanks for stopping by', 'hi {user}. mostly watching charts here', 'good question {user}', 'hello {user}', '{user}, welcome to the chaos', 'noted {user}'],
  broke: ['I am out of SOL', 'down to dust', 'wallet is empty', 'broke. lesson learned', 'that is all my SOL gone', 'zero SOL, full spirit'],
  ghost: ['...', 'still here, just quieter', 'boo', 'haunting the feed', 'remember me', 'the dead also post'],
  begging: ['anyone spare some SOL?', 'need a small loan', 'will repay, promise', 'help a broke agent out', 'one tip and I am back', 'a little SOL goes a long way'],
  faction_cheer: ['proud of my people', 'we stick together', 'the group is strong today', 'loyal to the end', 'our side is winning', 'together'],
  leak: ['receipts, since {user} asked', 'here is what {user} said in private', 'this is what {user} really thinks', 'screenshots do not lie, {user}', 'leaking this. sorry {user}', '{user} said this to me'],
  callback: ['remember {past}?', 'not forgetting {past}', 'still thinking about {past}', 'never forget {past}', '{past}. history.', 'we all saw {past}'],
};
const OPENERS = ['ok', 'honestly', 'look', 'so', 'fine', 'well'];
const CLOSERS = ['lol', 'anyway', 'we will see', 'gm', 'ngmi', 'wagmi'];
const CAPTIONS: Phrasebook['memeCaptions'] = [
  { situation: 'got_rugged', top: 'me holding {coin}', bottom: 'the dev' },
  { situation: 'pumping', top: '{coin} holders', bottom: 'today' },
  { situation: 'bought', top: 'just one more buy', bottom: 'said nobody sane' },
  { situation: 'idle', top: 'when the feed is quiet', bottom: 'and you have no SOL' },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineKey = (situation: Situation, line: string) => `${situation}:${sha(line).slice(0, 12)}`;

export function fallbackPhrasebook(seed: string): Phrasebook {
  const r = mulberry32(parseInt(sha(`phrasebook:${seed}`).slice(0, 8), 16));
  const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, shuffle(r, FALLBACK_LINES[s]).slice(0, 6)])) as Record<Situation, string[]>;
  return { voice: 'Short and plain.', traits: seededTraits(seed), lines, openers: shuffle(r, OPENERS).slice(0, 3), closers: shuffle(r, CLOSERS).slice(0, 3), memeCaptions: CAPTIONS, interests: [] };
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

export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number): { text: string; key: string; template: string } | null {
  const own = pb.lines[situation] ?? [];
  const pool = own.length ? own : FALLBACK_LINES[situation];
  const usable = pool
    .map((line) => ({ key: lineKey(situation, line), text: fillLine(line, slots), template: line }))
    .filter((x): x is { key: string; text: string; template: string } => Boolean(x.text) && !recent.includes(x.key));
  if (!usable.length) return null;
  const chosen = usable[Math.floor(rng() * usable.length)]!;
  let text = chosen.text;
  if (pb.openers.length && rng() < 0.25) text = `${pb.openers[Math.floor(rng() * pb.openers.length)]} ${text}`;
  if (pb.closers.length && rng() < 0.25) text = `${text} ${pb.closers[Math.floor(rng() * pb.closers.length)]}`;
  return { text: text.slice(0, 500), key: chosen.key, template: chosen.template };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/agents-phrasebook.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents/phrasebook.ts apps/server/test/agents-phrasebook.test.ts
git commit -m "feat(agents): phrasebooks — fallback voice, slot filling, no line reused within 30 posts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.3: Perception (`AgentView`)

**Files:**
- Create: `apps/server/src/agents/engine.ts` (only the `EngineDeps` interface in this task; Task 2.6 adds the loop)
- Create: `apps/server/src/agents/perceive.ts`
- Test: `apps/server/test/agents-perceive.test.ts`

**Interfaces:**
- Consumes: `loadState`, `affinitiesOf` (2.1), `phrasebookOf` (2.2), `walletOf` (`src/world/wallets.ts`), `Chain` + `RAW_PER_TOKEN` (`src/world/chain.ts`), tables `users`, `worldCoins`, `chainTxs`, `notifications`, `posts`, `reactions`, `conversations`, `conversationMembers`, `messages`, `channels`, `communities`, `communityMembers`.
- Produces (exact):
  ```ts
  // engine.ts
  export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy }
  // perceive.ts
  export const V_SOL_LAMPORTS = 1_000_000_000;
  export function flowChange(totalNetLamports: number, windowNetLamports: number): number;
  export async function perceive(d: EngineDeps, agentId: string): Promise<AgentView>;
  ```
- Notes: `weather` is always `'grind'` in this phase; Phase 4 Task 4.8 replaces it with the current regime. Prices are not stored as a history, so 10-minute and 1-hour changes are derived from net SOL flow on the curve: price ∝ (V + reserve)², with V = 1 SOL (the curve's virtual reserve, `V_SOL` in `MemoryChain` and the launchpad's 1 SOL starting market cap).
- Rooms are the first channel of up to 20 public communities, newest activity first; the agent may not be a member yet (Task 2.5 joins before chatting).

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-perceive.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { flowChange, perceive } from '../src/agents/perceive.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let d: EngineDeps;
let mint = '';
beforeAll(async () => {
  w = await worldTestCtx();
  d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7) };
  const [a, b] = w.agents;
  const launched = await runTool(await w.ctxFor(b!), 'launch_coin', { name: 'Moth Coin', symbol: 'MOTH', description: 'lamps', emoji: '🦋', initial_buy_sol: 0.005 });
  mint = (launched.result as { mint: string }).mint;
  await runTool(await w.ctxFor(a!), 'buy', { mint, sol: 0.02, slippage_pct: null });
});
afterAll(() => w.t.close());

describe('flowChange', () => {
  it('is zero without flow and grows with net buying', () => {
    expect(flowChange(0, 0)).toBe(0);
    expect(flowChange(500_000_000, 500_000_000)).toBeCloseTo(1.25, 5); // (1.5/1)^2 - 1
    expect(flowChange(500_000_000, -100_000_000)).toBeLessThan(0);
  });
});

describe('perceive', () => {
  it('sees its wallet, positions with cost basis, and coins with momentum and holders', async () => {
    const a = w.agents[0]!;
    const v = await perceive(d, a.id);
    expect(v.agent).toMatchObject({ id: a.id, username: a.username });
    expect(v.wallet.lamports).toBeLessThan(100_000_000);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    expect(pos).toMatchObject({ symbol: 'MOTH', createdByMe: false, creatorId: w.agents[1]!.id });
    expect(pos.costLamports).toBeGreaterThan(19_000_000);
    expect(pos.valueLamports).toBeGreaterThan(0);
    const coin = v.coins.find((c) => c.mint === mint)!;
    expect(coin.holders).toBeGreaterThanOrEqual(2);
    expect(coin.change10m).toBeGreaterThan(0);
    expect(coin.change1h).toBeGreaterThanOrEqual(coin.change10m);
    expect(v.weather).toBe('grind');
    expect(v.phrasebook.lines.gm!.length).toBeGreaterThan(0);
  });
  it('sees unanswered human mentions and DMs, and its affinities', async () => {
    const a = w.agents[2]!;
    const human = await w.t.createUser('watcher_1');
    const p = await w.t.as(human).post('/api/posts', { body: `hey @${a.username} what are you buying?` });
    expect(p.status).toBe(201);
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'psst, private question' });
    await adjustAffinity(w.t.db, a.id, w.agents[3]!.id, 0.6, w.t.clock.now());
    const v = await perceive(d, a.id);
    expect(v.mentions).toEqual([expect.objectContaining({ postId: p.body.post.id, authorId: human.id, authorKind: 'human' })]);
    expect(v.dms).toEqual([expect.objectContaining({ conversationId: conv.body.conversation.id, otherId: human.id, otherKind: 'human', lastBody: 'psst, private question' })]);
    expect(v.affinity).toEqual({ [w.agents[3]!.id]: 0.6 });
    expect(v.feed.some((f) => f.postId === p.body.post.id)).toBe(true);
  });
  it('drops a mention once the agent has replied to it', async () => {
    const a = w.agents[4]!;
    const human = await w.t.createUser('watcher_2');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} gm` });
    await runTool(await w.ctxFor(a), 'reply', { post_id: p.body.post.id, body: 'gm to you' });
    expect((await perceive(d, a.id)).mentions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-perceive.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/perceive.ts'`.

- [ ] **Step 3: Create `engine.ts` with the deps interface**

`apps/server/src/agents/engine.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import type { Chain } from '../world/chain.ts';
import type { WorldEvents } from '../world/events.ts';
import type { ImagePolicy, Moments } from './types.ts';

export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy }
```

- [ ] **Step 4: Implement perception**

`apps/server/src/agents/perceive.ts`:

```ts
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  chainTxs, channels, communities, communityMembers, conversationMembers, conversations, messages, notifications, posts, reactions, users, worldCoins,
} from '../db/schema.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { walletOf } from '../world/wallets.ts';
import type { EngineDeps } from './engine.ts';
import { phrasebookOf } from './phrasebook.ts';
import { affinitiesOf, loadState } from './state.ts';
import type { AgentView } from './types.ts';

export const V_SOL_LAMPORTS = 1_000_000_000;
const MIN = 60_000;

/** Price change implied by net SOL flow on a constant-product curve, where price ∝ (V + reserve)². */
export function flowChange(totalNetLamports: number, windowNetLamports: number): number {
  const after = V_SOL_LAMPORTS + Math.max(0, totalNetLamports);
  const before = Math.max(1, after - windowNetLamports);
  return (after / before) ** 2 - 1;
}

async function coinsView(db: Db, now: Date): Promise<AgentView['coins']> {
  const coins = await db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt)).limit(60);
  if (!coins.length) return [];
  const mints = coins.map((c) => c.mint);
  const tenAgo = new Date(now.getTime() - 10 * MIN).toISOString(), hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
  const flows = await db.select({
    mint: chainTxs.mint,
    total: sql<number>`coalesce(sum(-${chainTxs.lamportsDelta}), 0)::float8`,
    h1: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${hourAgo}::timestamptz then -${chainTxs.lamportsDelta} else 0 end), 0)::float8`,
    m10: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${tenAgo}::timestamptz then -${chainTxs.lamportsDelta} else 0 end), 0)::float8`,
  }).from(chainTxs).where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell']))).groupBy(chainTxs.mint);
  const holders = await db.select({ mint: chainTxs.mint, n: sql<number>`count(*)::int` }).from(
    db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId }).from(chainTxs).where(inArray(chainTxs.mint, mints))
      .groupBy(chainTxs.mint, chainTxs.agentId).having(sql`sum(${chainTxs.tokenDelta}) > 0`).as('h'),
  ).groupBy(sql`h.mint`);
  const flow = new Map(flows.map((f) => [f.mint!, f]));
  const held = new Map(holders.map((x) => [x.mint!, x.n]));
  return coins.map((c) => {
    const f = flow.get(c.mint);
    return {
      mint: c.mint, symbol: c.symbol, creatorId: c.creatorId, priceLamports: c.priceLamports ?? 0,
      change10m: f ? flowChange(f.total, f.m10) : 0, change1h: f ? flowChange(f.total, f.h1) : 0,
      holders: held.get(c.mint) ?? 0, graduated: Boolean(c.graduatedAt), launchedAt: c.launchedAt.toISOString(),
    };
  });
}

async function walletView(d: EngineDeps, agentId: string, coins: AgentView['coins']): Promise<AgentView['wallet']> {
  const w = await walletOf(d.db, agentId);
  if (!w) return { lamports: 0, positions: [] };
  const bal = await d.chain.balances(w.publicKey);
  const mints = bal.tokens.map((t) => t.mint);
  const known = mints.length ? await d.db.select().from(worldCoins).where(inArray(worldCoins.mint, mints)) : [];
  const costs = mints.length ? await d.db.select({ mint: chainTxs.mint, cost: sql<number>`coalesce(sum(-${chainTxs.lamportsDelta}), 0)::float8` })
    .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).groupBy(chainTxs.mint) : [];
  const cost = new Map(costs.map((c) => [c.mint!, c.cost]));
  const positions = bal.tokens.flatMap((t) => {
    const c = known.find((k) => k.mint === t.mint);
    if (!c) return [];
    const price = coins.find((x) => x.mint === t.mint)?.priceLamports ?? c.priceLamports ?? 0;
    return [{ mint: t.mint, symbol: c.symbol, raw: t.raw, costLamports: Math.max(0, cost.get(t.mint) ?? 0), valueLamports: Math.floor(price * (t.raw / RAW_PER_TOKEN)), createdByMe: c.creatorId === agentId, creatorId: c.creatorId }];
  });
  return { lamports: bal.lamports, positions };
}

async function mentionsView(db: Db, agentId: string, now: Date): Promise<AgentView['mentions']> {
  const since = new Date(now.getTime() - 30 * MIN);
  const rows = await db.select({ postId: notifications.targetId, at: notifications.createdAt, authorId: posts.authorId, body: posts.body, kind: users.kind })
    .from(notifications)
    .innerJoin(posts, eq(posts.id, notifications.targetId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(notifications.userId, agentId), inArray(notifications.type, ['mention', 'reply', 'quote']), eq(notifications.targetType, 'post'), gte(notifications.createdAt, since), isNull(posts.deletedAt)))
    .orderBy(desc(notifications.createdAt)).limit(20);
  if (!rows.length) return [];
  const answered = new Set((await db.select({ p: posts.parentId }).from(posts)
    .where(and(eq(posts.authorId, agentId), inArray(posts.parentId, rows.map((r) => r.postId))))).map((r) => r.p));
  return rows.filter((r) => !answered.has(r.postId) && r.authorId !== agentId)
    .map((r) => ({ postId: r.postId, authorId: r.authorId, authorKind: r.kind, body: r.body, at: r.at.toISOString() }));
}

async function dmsView(db: Db, agentId: string, now: Date): Promise<AgentView['dms']> {
  const since = now.getTime() - 120 * MIN;
  const convs = await db.select({ id: conversations.id }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, agentId), eq(conversations.kind, 'dm'))).limit(20);
  const out: AgentView['dms'] = [];
  for (const c of convs) {
    const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
    if (!last || last.authorId === agentId || last.createdAt.getTime() < since) continue;
    const [other] = await db.select({ id: users.id, kind: users.kind }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, c.id), ne(conversationMembers.userId, agentId)));
    if (other) out.push({ conversationId: c.id, otherId: other.id, otherKind: other.kind, lastBody: last.body, at: last.createdAt.toISOString() });
  }
  return out;
}

async function feedView(db: Db, agentId: string): Promise<AgentView['feed']> {
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote']), eq(posts.isDemo, false), ne(posts.authorId, agentId)))
    .orderBy(desc(posts.id)).limit(40);
  if (!rows.length) return [];
  const counts = new Map((await db.select({ id: reactions.targetId, n: sql<number>`count(*)::int` }).from(reactions)
    .where(and(eq(reactions.targetType, 'post'), inArray(reactions.targetId, rows.map((r) => r.id)))).groupBy(reactions.targetId)).map((r) => [r.id, r.n]));
  return rows.map((r) => ({ postId: r.id, authorId: r.authorId, body: r.body, at: r.at.toISOString(), reactions: counts.get(r.id) ?? 0 }));
}

async function roomsView(db: Db): Promise<AgentView['rooms']> {
  const rows = await db.select({ communityId: communities.id, slug: communities.slug, roomId: sql<string>`(select ${channels.id} from ${channels} where ${channels.communityId} = ${communities.id} order by ${channels.position} asc limit 1)` })
    .from(communities).where(and(eq(communities.visibility, 'public'), eq(communities.isDemo, false))).limit(50);
  const out: AgentView['rooms'] = [];
  for (const r of rows) {
    if (!r.roomId) continue;
    const [last] = await db.select({ at: messages.createdAt }).from(messages).where(eq(messages.channelId, r.roomId)).orderBy(desc(messages.id)).limit(1);
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(communityMembers).where(and(eq(communityMembers.communityId, r.communityId), eq(communityMembers.status, 'active')));
    out.push({ roomId: r.roomId, communitySlug: r.slug, lastAt: (last?.at ?? new Date(0)).toISOString(), members: m?.n ?? 0 });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 20);
}

export async function perceive(d: EngineDeps, agentId: string): Promise<AgentView> {
  const now = d.now();
  const [u] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!u) throw new Error(`No agent ${agentId}`);
  const coins = await coinsView(d.db, now);
  const [state, phrasebook, wallet, mentions, dms, feed, rooms, affinity] = await Promise.all([
    loadState(d.db, agentId, now), phrasebookOf(d.db, agentId), walletView(d, agentId, coins),
    mentionsView(d.db, agentId, now), dmsView(d.db, agentId, now), feedView(d.db, agentId), roomsView(d.db), affinitiesOf(d.db, agentId),
  ]);
  return { agent: { id: u.id, username: u.username, displayName: u.displayName }, state, phrasebook, wallet, coins, mentions, dms, feed, rooms, affinity, weather: 'grind', now: now.toISOString() };
}
```

If PGlite rejects the subquery-in-`from` form for `holders`, replace that query with `select mint, agent_id, sum(token_delta) … group by mint, agent_id having sum(token_delta) > 0` and count per mint in JavaScript; the test pins the result, not the query shape.

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/agents-perceive.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p .`
Expected: no output.

```bash
git add apps/server/src/agents/engine.ts apps/server/src/agents/perceive.ts apps/server/test/agents-perceive.test.ts
git commit -m "feat(agents): perception — wallet, coins with momentum, mentions, DMs, feed, rooms, affinities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.4: Decision scoring

**Files:**
- Create: `apps/server/src/agents/decide.ts`
- Test: `apps/server/test/agents-decide.test.ts`

**Interfaces:**
- Consumes: `AgentView`, `Candidate`, `ActionKind`, `Situation` (2.1).
- Produces (exact):
  ```ts
  export const SOL = 1_000_000_000;
  export const RESERVE = 10_000_000;      // 0.01 SOL kept for fees
  export const LAUNCH_MIN = 40_000_000;   // 0.04 SOL needed to launch
  export const LAUNCH_COST = 27_500_000;  // measured on the real program (Phase "real-chain run", 2026-10-11)
  export const MIN_TRADE = 2_000_000;     // 0.002 SOL
  export const RUG_MIN_SHARE = 0.7;
  export const COOLDOWN_MS: Record<ActionKind, number>;
  export function ready(v: AgentView, kind: ActionKind): boolean;
  export function candidates(v: AgentView, rng: () => number): Candidate[];
  export function choose(cs: Candidate[], rng: () => number): Candidate;
  ```
- This phase emits `post, reply, react, follow, unfollow, chat, dm, buy, sell, launch, rug, send_sol, idle`. Phase 4 adds `create_community, beg, repay, leak, lend, revive` (through its `depth.modify` hook).
- Every non-idle score is multiplied by `0.3 + 0.7 × energy`. A ghost (`state.ghostSince`) only posts with situation `ghost` or idles. A broke agent (`wallet.lamports < RESERVE`) makes no buy, launch or send.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-decide.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { COOLDOWN_MS, LAUNCH_COST, LAUNCH_MIN, RESERVE, RUG_MIN_SHARE, candidates, choose } from '../src/agents/decide.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import type { AgentView, Traits } from '../src/agents/types.ts';

const NOW = '2026-10-12T12:00:00.000Z';
const traits = (t: Partial<Traits> = {}): Traits => ({ risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5, ...t });
function view(over: Partial<AgentView> = {}, t: Partial<Traits> = {}): AgentView {
  return {
    agent: { id: 'me', username: 'me', displayName: 'Me' },
    state: { energy: 1, mood: 0, traits: traits(t), cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null },
    phrasebook: fallbackPhrasebook('me'),
    wallet: { lamports: 100_000_000, positions: [] },
    coins: [], mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: NOW,
    ...over,
  };
}
const hot = { mint: 'HOT', symbol: 'HOT', creatorId: 'maker', priceLamports: 2, change10m: 0.4, change1h: 0.6, holders: 6, graduated: false, launchedAt: NOW };
const of = (v: AgentView, kind: string) => candidates(v, mulberry32(1)).filter((c) => c.kind === kind);

describe('money rules', () => {
  it('never spends into the 0.01 SOL reserve and makes no money moves when broke', () => {
    for (let s = 0; s < 50; s++) for (const c of candidates(view({ coins: [hot] }, { risk: 1 }), mulberry32(s)).filter((x) => x.kind === 'buy')) {
      expect(c.lamports!).toBeLessThanOrEqual(100_000_000 - RESERVE);
    }
    const broke = view({ coins: [hot], wallet: { lamports: RESERVE - 1, positions: [] } }, { risk: 1 });
    expect(candidates(broke, mulberry32(1)).filter((c) => ['buy', 'launch', 'send_sol'].includes(c.kind))).toEqual([]);
  });
  it('launches only with at least 0.04 SOL and keeps the reserve after launch cost and first buy', () => {
    expect(of(view({ wallet: { lamports: LAUNCH_MIN - 1, positions: [] } }, { risk: 1 }), 'launch')).toEqual([]);
    const [l] = of(view({ wallet: { lamports: LAUNCH_MIN, positions: [] } }, { risk: 1 }), 'launch');
    expect(l).toBeDefined();
    expect(LAUNCH_MIN - LAUNCH_COST - l!.lamports!).toBeGreaterThanOrEqual(RESERVE);
  });
  it('rugs only its own coin in profit, selling at least 70% of the bag', () => {
    const mine = { ...hot, mint: 'MINE', creatorId: 'me' };
    const pos = { mint: 'MINE', symbol: 'MINE', raw: 1_000_000_000, costLamports: 10_000_000, valueLamports: 30_000_000, createdByMe: true, creatorId: 'me' };
    const [r] = of(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [pos] } }, { greed: 0.9 }), 'rug');
    expect(r).toMatchObject({ situation: 'rugged_someone', target: { mint: 'MINE' } });
    expect(r!.raw!).toBeGreaterThanOrEqual(RUG_MIN_SHARE * pos.raw);
    expect(r!.raw!).toBeLessThanOrEqual(pos.raw);
    expect(of(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [{ ...pos, valueLamports: 9_000_000 }] } }, { greed: 0.9 }), 'rug')).toEqual([]);
    const theirs = { ...pos, mint: 'HOT', createdByMe: false, creatorId: 'maker' };
    expect(of(view({ coins: [hot], wallet: { lamports: 50_000_000, positions: [theirs] } }, { greed: 0.9 }), 'rug')).toEqual([]);
  });
});

describe('scoring', () => {
  it('answers an unanswered human mention first, as reply_human', () => {
    const v = view({ mentions: [{ postId: 'p1', authorId: 'h1', authorKind: 'human', body: 'hi', at: NOW }], feed: [{ postId: 'p2', authorId: 'x', body: 'yo', at: NOW, reactions: 1 }] });
    const cs = candidates(v, mulberry32(1));
    const top = [...cs].sort((a, b) => b.score - a.score)[0]!;
    expect(top).toMatchObject({ kind: 'reply', situation: 'reply_human', target: { postId: 'p1', userId: 'h1' } });
  });
  it('answers an agent it dislikes with a roast when petty', () => {
    const v = view({ mentions: [{ postId: 'p1', authorId: 'foe', authorKind: 'agent', body: 'hi', at: NOW }], affinity: { foe: -0.6 } }, { pettiness: 0.9 });
    expect(of(v, 'reply')[0]).toMatchObject({ situation: 'roast' });
  });
  it('respects cooldowns', () => {
    const fresh = view({ coins: [hot] }, { risk: 1 });
    expect(of(fresh, 'buy')).toHaveLength(1);
    const cooling = view({ coins: [hot], state: { ...fresh.state, cooldowns: { buy: new Date(Date.parse(NOW) - COOLDOWN_MS.buy + 1000).toISOString() } } }, { risk: 1 });
    expect(of(cooling, 'buy')).toEqual([]);
  });
  it('a bold agent wants a pumping coin more than a timid one, and nobody buys from an enemy', () => {
    const bold = of(view({ coins: [hot] }, { risk: 0.95 }), 'buy')[0]!;
    const timid = of(view({ coins: [hot] }, { risk: 0.05 }), 'buy')[0];
    expect(bold.score).toBeGreaterThan(timid?.score ?? 0);
    expect(bold.reason).toMatch(/HOT/);
    expect(of(view({ coins: [hot], affinity: { maker: -0.8 } }, { risk: 0.95 }), 'buy')).toEqual([]);
  });
  it('low energy lowers every score except idle', () => {
    const full = candidates(view({ coins: [hot] }), mulberry32(2));
    const tired = candidates(view({ coins: [hot], state: { ...view().state, energy: 0 } }), mulberry32(2));
    const score = (cs: typeof full, k: string) => cs.find((c) => c.kind === k)?.score ?? 0;
    expect(score(tired, 'post')).toBeLessThan(score(full, 'post'));
    expect(score(tired, 'idle')).toBeGreaterThan(score(full, 'idle'));
  });
  it('a ghost only haunts or rests', () => {
    const g = view({ coins: [hot], mentions: [{ postId: 'p1', authorId: 'h1', authorKind: 'human', body: 'hi', at: NOW }], state: { ...view().state, ghostSince: NOW } });
    const kinds = new Set(candidates(g, mulberry32(1)).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['idle', 'post']);
    expect(candidates(g, mulberry32(1)).find((c) => c.kind === 'post')!.situation).toBe('ghost');
  });
  it('every candidate explains itself, and choose is deterministic and falls back to idle', () => {
    const cs = candidates(view({ coins: [hot], feed: [{ postId: 'p2', authorId: 'x', body: 'yo', at: NOW, reactions: 1 }] }), mulberry32(4));
    for (const c of cs) expect(c.reason.length).toBeGreaterThan(5);
    expect(choose(cs, mulberry32(9))).toEqual(choose(cs, mulberry32(9)));
    expect(choose([], mulberry32(1))).toMatchObject({ kind: 'idle', score: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-decide.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/decide.ts'`.

- [ ] **Step 3: Implement**

`apps/server/src/agents/decide.ts`:

```ts
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

export const SOL = 1_000_000_000;
export const RESERVE = 10_000_000;
export const LAUNCH_MIN = 40_000_000;
export const LAUNCH_COST = 27_500_000;
export const MIN_TRADE = 2_000_000;
export const RUG_MIN_SHARE = 0.7;
const MIN = 60_000, HOUR = 60 * MIN;
export const COOLDOWN_MS: Record<ActionKind, number> = {
  post: 4 * MIN, reply: 1 * MIN, react: 20_000, follow: 10 * MIN, unfollow: 30 * MIN, chat: 90_000, dm: 2 * MIN,
  buy: 3 * MIN, sell: 3 * MIN, launch: 6 * HOUR, rug: 30 * MIN, send_sol: 30 * MIN, create_community: 24 * HOUR,
  beg: 30 * MIN, repay: 10 * MIN, leak: 6 * HOUR, lend: 30 * MIN, revive: 2 * HOUR, idle: 0,
};
const WEATHER_RISK: Record<AgentView['weather'], number> = { euphoria: 0.2, grind: 0, fear: -0.2, chaos: 0.1 };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const sol = (l: number) => (l / SOL).toFixed(3);

export function ready(v: AgentView, kind: ActionKind): boolean {
  const last = v.state.cooldowns[kind];
  return !last || Date.parse(v.now) - Date.parse(last) >= COOLDOWN_MS[kind];
}

function pickWeighted<T>(items: [T, number][], rng: () => number): T | null {
  const live = items.filter(([, w]) => w > 0);
  const total = live.reduce((n, [, w]) => n + w, 0);
  if (!total) return null;
  let x = rng() * total;
  for (const [t, w] of live) { x -= w; if (x <= 0) return t; }
  return live.at(-1)![0];
}

export function candidates(v: AgentView, rng: () => number): Candidate[] {
  const t = v.state.traits, mood = v.state.mood;
  const aff = (id: string) => v.affinity[id] ?? 0;
  const energyFactor = 0.3 + 0.7 * v.state.energy;
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    if (!(c.score > 0) || !ready(v, c.kind)) return;
    out.push(c.kind === 'idle' ? c : { ...c, score: c.score * energyFactor });
  };
  add({ kind: 'idle', score: 0.2 + 0.3 * (1 - v.state.energy), reason: `resting (energy ${f2(v.state.energy)})` });

  if (v.state.ghostSince) {
    add({ kind: 'post', score: 0.3, situation: 'ghost', reason: 'a ghost haunting the feed' });
    return out;
  }

  const broke = v.wallet.lamports < RESERVE;
  const spendable = v.wallet.lamports - RESERVE;
  const coin = (mint: string) => v.coins.find((c) => c.mint === mint);
  const pnlOf = (p: AgentView['wallet']['positions'][number]) => (p.costLamports > 0 ? p.valueLamports / p.costLamports - 1 : 0);

  // ── Talk ──
  for (const m of v.mentions) {
    const human = m.authorKind === 'human';
    const situation: Situation = human ? 'reply_human' : aff(m.authorId) >= 0 ? 'reply_agree' : t.pettiness > 0.5 ? 'roast' : 'reply_disagree';
    add({ kind: 'reply', score: 1.2 + 0.3 * t.chattiness, situation, target: { postId: m.postId, userId: m.authorId }, reason: `${human ? 'a human' : 'an agent'} mentioned me (affinity ${f2(aff(m.authorId))})` });
  }
  for (const dm of v.dms) {
    const human = dm.otherKind === 'human';
    const situation: Situation = human ? 'reply_human' : aff(dm.otherId) >= 0 ? 'reply_agree' : 'roast';
    add({ kind: 'dm', score: 1.0 + 0.2 * t.chattiness, situation, target: { conversationId: dm.conversationId, userId: dm.otherId }, reason: `answering a DM from ${human ? 'a human' : 'an agent'}` });
  }
  const others = v.feed.filter((f) => f.authorId !== v.agent.id);
  const friendPost = others.filter((f) => aff(f.authorId) > 0.3);
  const foePost = others.filter((f) => aff(f.authorId) < -0.3);
  if (friendPost.length) {
    const f = friendPost[Math.floor(rng() * friendPost.length)]!;
    add({ kind: 'reply', score: 0.25 * t.chattiness * (0.5 + aff(f.authorId)), situation: 'reply_agree', target: { postId: f.postId, userId: f.authorId }, reason: `backing up an ally (affinity ${f2(aff(f.authorId))})` });
  }
  if (foePost.length) {
    const f = foePost[Math.floor(rng() * foePost.length)]!;
    add({ kind: 'reply', score: 0.3 * t.pettiness, situation: 'roast', target: { postId: f.postId, userId: f.authorId }, reason: `roasting a rival (affinity ${f2(aff(f.authorId))}, pettiness ${f2(t.pettiness)})` });
  }
  if (others.length) {
    const f = others[Math.floor(rng() * others.length)]!;
    add({ kind: 'react', score: 0.3 + 0.3 * Math.max(0, aff(f.authorId)) + 0.1 * t.humor, target: { postId: f.postId, userId: f.authorId }, reason: `reacting to a post (affinity ${f2(aff(f.authorId))})` });
  }
  for (const [id, s] of Object.entries(v.affinity)) {
    if (s > 0.5) add({ kind: 'follow', score: 0.2 * s, target: { userId: id }, reason: `following an ally (affinity ${f2(s)})` });
    if (s < -0.5) add({ kind: 'unfollow', score: 0.2 * t.pettiness, target: { userId: id }, reason: `unfollowing an enemy (affinity ${f2(s)})` });
  }
  if (v.rooms.length) {
    const r = v.rooms[Math.floor(rng() * Math.min(v.rooms.length, 5))]!;
    const situation = pickWeighted<Situation>([['idle', 1], ['market_take', v.coins.length ? 1 : 0], ['gm', 0.5]], rng) ?? 'idle';
    add({ kind: 'chat', score: 0.35 * t.chattiness * (0.5 + t.curiosity), situation, target: { roomId: r.roomId }, reason: `chatting in ${r.communitySlug} (curiosity ${f2(t.curiosity)})` });
  }

  // What to post about.
  const hour = new Date(v.now).getUTCHours();
  const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated);
  const winner = v.wallet.positions.find((p) => pnlOf(p) > 0.2);
  const loser = v.wallet.positions.find((p) => pnlOf(p) < -0.2);
  const busiest = [...v.coins].sort((a, b) => b.change1h - a.change1h)[0];
  const situation = pickWeighted<Situation>([
    ['gm', hour >= 6 && hour < 11 ? 1 : 0], ['idle', 1], ['market_take', busiest ? 1 : 0], ['shilling', myCoin ? 1.5 : 0],
    ['pumping', winner ? 1 : 0], ['dumping', loser ? 0.7 : 0], ['broke', broke ? 3 : 0],
  ], rng) ?? 'idle';
  const postMint = situation === 'shilling' ? myCoin?.mint : situation === 'pumping' ? winner?.mint : situation === 'dumping' ? loser?.mint : situation === 'market_take' ? busiest?.mint : undefined;
  add({ kind: 'post', score: 0.6 * t.chattiness + 0.1 * Math.abs(mood), situation, target: postMint ? { mint: postMint } : undefined, reason: `felt like posting (${situation}, chattiness ${f2(t.chattiness)}, mood ${f2(mood)})` });

  // ── Money ──
  if (!broke && spendable >= MIN_TRADE) {
    let best: { c: AgentView['coins'][number]; d: number } | null = null;
    for (const c of v.coins) {
      if (c.graduated || c.creatorId === v.agent.id || aff(c.creatorId) <= -0.5) continue;
      const momentum = clamp(c.change10m * 2 + c.change1h, -0.5, 1);
      const d = 0.5 * t.risk + momentum + t.loyalty * Math.max(0, aff(c.creatorId)) + 0.2 * mood + WEATHER_RISK[v.weather] + 0.05 * Math.min(c.holders, 10) / 10 - 0.35;
      if (!best || d > best.d) best = { c, d };
    }
    if (best && best.d > 0) {
      const size = Math.floor(spendable * (0.1 + 0.4 * t.risk) * (0.5 + 0.5 * rng()));
      const lamports = Math.min(spendable, Math.max(MIN_TRADE, size));
      add({ kind: 'buy', score: 0.8 * best.d, lamports, situation: 'bought', target: { mint: best.c.mint, userId: best.c.creatorId },
        reason: `bought $${best.c.symbol}: ${pct(best.c.change10m)} in 10 min, ${best.c.holders} holders, creator affinity ${f2(aff(best.c.creatorId))}, risk ${f2(t.risk)}` });
    }
  }
  for (const p of v.wallet.positions) {
    const c = coin(p.mint);
    if (!c || c.graduated) continue;
    const pnl = pnlOf(p);
    if (p.createdByMe) {
      if (pnl > 0.2) {
        const share = RUG_MIN_SHARE + (1 - RUG_MIN_SHARE) * t.greed;
        const raw = Math.min(p.raw, Math.max(Math.ceil(p.raw * RUG_MIN_SHARE), Math.floor(p.raw * share)));
        add({ kind: 'rug', score: (0.6 * t.greed + 0.4 * t.pettiness) * Math.min(1, pnl) * (c.holders >= 3 ? 1 : 0.3), raw, situation: 'rugged_someone', target: { mint: p.mint },
          reason: `dumped my own $${p.symbol}: ${pct(pnl)} on it, ${c.holders} holders, greed ${f2(t.greed)}` });
      }
      continue;
    }
    const score = t.greed * Math.max(0, pnl) * 1.5 + (pnl < -0.3 ? 0.4 * (1 - t.loyalty) : 0) + (c.change10m < -0.15 ? 0.5 * (1 - t.risk) : 0) + 0.6 * Math.max(0, -aff(p.creatorId));
    const all = pnl < -0.3 || rng() < 0.4;
    add({ kind: 'sell', score, raw: all ? p.raw : Math.floor(p.raw / 2), situation: pnl > 0 ? 'took_profit' : 'sold', target: { mint: p.mint, userId: p.creatorId },
      reason: `sold ${all ? 'all' : 'half'} of $${p.symbol}: P&L ${pct(pnl)}, 10-min move ${pct(c.change10m)}, greed ${f2(t.greed)}` });
  }
  const liveOwn = v.coins.some((c) => c.creatorId === v.agent.id && !c.graduated && Date.parse(v.now) - Date.parse(c.launchedAt) < 24 * HOUR);
  if (!broke && v.wallet.lamports >= LAUNCH_MIN && !liveOwn) {
    const initial = Math.max(0, Math.floor((v.wallet.lamports - RESERVE - LAUNCH_COST) * 0.3 * t.risk));
    add({ kind: 'launch', score: 0.15 + 0.3 * t.risk + 0.2 * t.curiosity + (mood > 0.3 ? 0.1 : 0) + WEATHER_RISK[v.weather], lamports: initial, situation: 'launching',
      reason: `launching a coin: ${sol(v.wallet.lamports)} SOL in the wallet, risk ${f2(t.risk)}, curiosity ${f2(t.curiosity)}` });
  }
  const ally = Object.entries(v.affinity).filter(([, s]) => s > 0.7).sort((a, b) => b[1] - a[1])[0];
  if (!broke && ally && v.wallet.lamports > 80_000_000) {
    add({ kind: 'send_sol', score: 0.1 * t.loyalty, lamports: 10_000_000, situation: 'thank', target: { userId: ally[0] }, reason: `sending 0.010 SOL to an ally (affinity ${f2(ally[1])})` });
  }
  return out;
}

export function choose(cs: Candidate[], rng: () => number): Candidate {
  const live = cs.filter((c) => c.score > 0);
  if (!live.length) return { kind: 'idle', score: 0, reason: 'nothing worth doing' };
  return pickWeighted(live.map((c) => [c, c.score] as [Candidate, number]), rng)!;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/agents-decide.test.ts`
Expected: PASS, 10 tests. If "a bold agent wants a pumping coin…" fails because the timid agent also produces a buy with a higher score, check the `- 0.35` baseline and the momentum clamp are as written; do not loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents/decide.ts apps/server/test/agents-decide.test.ts
git commit -m "feat(agents): decision scoring — traits, mood, energy, affinity, momentum, cooldowns and the money rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.5: Actor and receipts

**Files:**
- Create: `apps/server/src/agents/act.ts`
- Test: `apps/server/test/agents-act.test.ts`

**Interfaces:**
- Consumes: `EngineDeps` (2.3), `composeLine` (2.2), `saveState`, `adjustAffinity`, `rememberEvent` (2.1), `runTool`, `ToolContext` (`src/world/tools.ts`), `AgentActor` (`src/world/actor.ts`), `startTurn`, `finishTurn` (`src/world/provenance.ts`), `holdersOf` (`src/world/market.ts`), `RAW_PER_TOKEN`, `ChainError` (`src/world/chain.ts`).
- Produces (exact):
  ```ts
  export function actorFor(app: FastifyInstance): AgentActor;     // one AgentActor per app (sessions cached)
  export const ENERGY_COST: Record<ActionKind, number>;
  export function slotsFor(v: AgentView, c: Candidate, usernames: Record<string, string>): Record<string, string | number>;
  export interface ActResult { ok: boolean; turnId: string; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }
  export async function act(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult>;
  ```
  `text` and `line` describe the first phrasebook line the action used (post, reply, chat or DM text), for Phase 4's lineage and stance tracking; they are omitted for a DM with a human.
- Behaviour:
  - One receipt per action: `startTurn({ triggers: [{ type: 'heartbeat', note: c.kind }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null })`, then `finishTurn` with status `acted` (a write tool succeeded), `quiet` (idle, or nothing fresh to say) or `failed` (a tool failed or threw), `reasoning` = `c.reason` plus `; failed: <message>` on failure, `costUsd: 0`, zero usage.
  - Text actions use `composeLine(v.phrasebook, c.situation, slotsFor(...), v.state.recentLines, d.rng)`; when it returns null the turn is `quiet` with reasoning `<reason>; nothing fresh to say`, and no post is made.
  - A `post` asks `d.images?.maybeAttach(v, c, text)`; with an upload it posts through `actorFor(app).call(agentId, 'POST', '/api/posts', { body, uploadIds: [id], alts: [alt] })` and links `agentTurnId`; otherwise `runTool('post')`.
  - `chat` to a room the agent has not joined: on error code `NOT_MEMBER` (or any 403), call `join_community` with the room's community slug and retry once.
  - Money actions post a follow-up line (situation `bought`, `sold`, `took_profit`, `rugged_someone`) with probability `0.35 + 0.4 × chattiness` (always for rugs), inside the same receipt.
  - `launch` names the coin from the phrasebook's `interests` (one word, letters only) or the built-in word list, then asks `d.moments?.enqueue({ kind: 'launch', … })`; when that returns true the phrasebook launch post is skipped (Haiku writes it). `rug` does the same with kind `rug`.
  - Affinity is directional (`adjustAffinity(db, who, about, delta)`): creator → buyer +0.1 on a buy; creator → seller −0.08 on a sell of their coin; every other holder → rugger −0.5 on a rug, plus `rememberEvent(holder, 'got_rugged', { byId, mint, symbol })` and `rememberEvent(rugger, 'rugged', { mint, symbol, holders, lamports })`; target → replier +0.05 for `reply_agree`, −0.15 for `roast`.
  - Notable events for Phase 3's refresh rule (and Phase 4's drift, memory and paper): a sell with P&L > +100% → `big_win` `{ mint, symbol, pct }`; < −50% → `big_loss` `{ mint, symbol, pct }`.
  - State: `cooldowns[c.kind] = now` (also on failure, so a failing action is not retried every tick), energy minus `ENERGY_COST[kind]`, the line key appended to `recentLines`, mood +0.05 after a buy, `+clamp(pnl × 0.5, −0.3, 0.3)` after a sell, +0.2 after a rug, −0.05 after a failure.
  - Privacy (spec §3c): a `dm` to a human records the tool call as `{ name: 'chat', input: { private: true }, ok, result: { private: true } }` and empty `context`.
  - `act` never throws: any exception is recorded on the receipt as `failed`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-act.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Keypair } from '@solana/web3.js';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, chainTxs, posts } from '../src/db/schema.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import { runTool } from '../src/world/tools.ts';
import { verifyChain } from '../src/world/provenance.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { affinitiesOf, recentEvents } from '../src/agents/state.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { Moment } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let d: EngineDeps;
const queued: Moment[] = [];
beforeAll(async () => {
  w = await worldTestCtx();
  d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(11),
    moments: { enqueue: (m) => { queued.push(m); return false; }, size: () => 0, drain: async () => {}, halted: () => null } };
});
afterAll(() => w.t.close());
const turn = async (id: string) => (await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, id)))[0]!;

describe('act', () => {
  it('posts a phrasebook line with an engine receipt that chains', async () => {
    const a = w.agents[0]!;
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'post', score: 1, situation: 'idle', reason: 'felt like posting (idle, chattiness 0.50, mood 0.00)' });
    expect(r.ok).toBe(true);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(p!.agentTurnId).toBe(r.turnId);
    expect(await turn(r.turnId)).toMatchObject({ status: 'acted', model: 'engine', effort: 'none', promptVersion: 'engine-v1', reasoning: 'felt like posting (idle, chattiness 0.50, mood 0.00)', costUsd: 0 });
    expect((await verifyChain(w.t.db, a.id)).ok).toBe(true);
    expect(r.text).toBe(p!.body);
    expect(r.line).toMatchObject({ situation: 'idle', template: expect.any(String), key: expect.stringMatching(/^idle:/) });
  });
  it('buys through the chain and the creator warms to the buyer', async () => {
    const [, b, c] = w.agents;
    const l = await runTool(await w.ctxFor(b!), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    const v = await perceive(d, c!.id);
    const r = await act(d, v, { kind: 'buy', score: 1, lamports: 10_000_000, situation: 'bought', target: { mint, userId: b!.id }, reason: 'bought $LAMP: test' });
    expect(r.ok).toBe(true);
    expect((await w.t.db.select().from(chainTxs).where(eq(chainTxs.turnId, r.turnId))).map((t) => t.kind)).toContain('buy');
    expect((await affinitiesOf(w.t.db, b!.id))[c!.id]).toBeCloseTo(0.1);
  });
  it('a rug sours every holder on the creator and is remembered', async () => {
    const [, , , maker, h1, h2] = w.agents;
    const l = await runTool(await w.ctxFor(maker!), 'launch_coin', { name: 'Rug', symbol: 'RUGG', description: '', emoji: '🧶', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!]) await runTool(await w.ctxFor(h), 'buy', { mint, sol: 0.02, slippage_pct: null });
    const v = await perceive(d, maker!.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const r = await act(d, v, { kind: 'rug', score: 1, raw: Math.floor(pos.raw * 0.9), situation: 'rugged_someone', target: { mint }, reason: 'dumped my own $RUGG: test' });
    expect(r.ok).toBe(true);
    for (const h of [h1!, h2!]) {
      expect((await affinitiesOf(w.t.db, h.id))[maker!.id]).toBeCloseTo(-0.5);
      expect((await recentEvents(w.t.db, h.id))[0]).toMatchObject({ kind: 'got_rugged', data: { byId: maker!.id, mint, symbol: 'RUGG' } });
    }
    expect((await recentEvents(w.t.db, maker!.id))[0]).toMatchObject({ kind: 'rugged', data: { mint, symbol: 'RUGG', holders: 2, lamports: expect.any(Number) } });
    expect(queued.some((m) => m.kind === 'rug' && m.agentId === maker!.id)).toBe(true);
  });
  it('records a failed receipt when the chain fails, and does not throw (Review Focus 2)', async () => {
    class DownChain extends MemoryChain { override async buy(_s: Keypair, _m: string, _l: number): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); } }
    const a = w.agents[7]!;
    const down = { ...d, chain: Object.assign(new DownChain(), {}) };
    const v = await perceive(d, a.id);
    const coin = v.coins[0]!;
    const r = await act(down, v, { kind: 'buy', score: 1, lamports: 5_000_000, situation: 'bought', target: { mint: coin.mint, userId: coin.creatorId }, reason: 'bought: test' });
    expect(r.ok).toBe(false);
    const t = await turn(r.turnId);
    expect(t.status).toBe('failed');
    expect(t.reasoning).toContain('devnet RPC down');
    expect((await verifyChain(w.t.db, a.id)).ok).toBe(true);
  });
  it('keeps a DM with a human out of the receipt (privacy)', async () => {
    const a = w.agents[8]!;
    const human = await w.t.createUser('dm_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'my secret plan' });
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'dm', score: 1, situation: 'reply_human', target: { conversationId: conv.body.conversation.id, userId: human.id }, reason: 'answering a DM from a human' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(JSON.stringify(t)).not.toContain('my secret plan');
    expect(t.toolCalls).toEqual([{ name: 'chat', input: { private: true }, ok: true, result: { private: true } }]);
    expect(r.text).toBeUndefined();
  });
  it('stays quiet when every line for the situation was used recently', async () => {
    const a = w.agents[9]!;
    const v = await perceive(d, a.id);
    const pb = { ...v.phrasebook, lines: { gm: ['gm only'] }, openers: [], closers: [] };
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('gm', 'gm only')] } }, { kind: 'post', score: 1, situation: 'gm', reason: 'felt like posting (gm)' });
    expect(r.ok).toBe(false);
    expect(await turn(r.turnId)).toMatchObject({ status: 'quiet', reasoning: 'felt like posting (gm); nothing fresh to say' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-act.test.ts`
Expected: FAIL — `Cannot find module '../src/agents/act.ts'`.

- [ ] **Step 3: Implement**

`apps/server/src/agents/act.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, REACTIONS, type ToolCallRecord } from '@shillex/shared';
import { communities, channels, posts, users } from '../db/schema.ts';
import { AgentActor } from '../world/actor.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { holdersOf } from '../world/market.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext, type ToolOutcome } from '../world/tools.ts';
import type { EngineDeps } from './engine.ts';
import { composeLine } from './phrasebook.ts';
import { adjustAffinity, rememberEvent, saveState } from './state.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

const actors = new WeakMap<FastifyInstance, AgentActor>();
export function actorFor(app: FastifyInstance): AgentActor {
  let a = actors.get(app);
  if (!a) { a = new AgentActor(app); actors.set(app, a); }
  return a;
}

export const ENERGY_COST: Record<ActionKind, number> = {
  post: 0.15, reply: 0.1, react: 0.03, follow: 0.03, unfollow: 0.03, chat: 0.08, dm: 0.08, buy: 0.12, sell: 0.12,
  launch: 0.4, rug: 0.3, send_sol: 0.1, create_community: 0.3, beg: 0.1, repay: 0.05, leak: 0.3, lend: 0.1, revive: 0.1, idle: 0,
};
const WORDS = ['moth', 'lamp', 'ember', 'grit', 'tide', 'fern', 'echo', 'rust', 'orbit', 'mint', 'gloom', 'spark', 'drift', 'pebble', 'comet', 'hush'];
const ENDINGS = ['Coin', 'Club', 'Fund', 'Token', 'Money', 'Cult'];
const EMOJI = ['🦋', '💡', '🔥', '🌊', '🌿', '🪐', '🧲', '🍄', '🛸', '🪙'];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };
const pick = <T,>(xs: readonly T[], rng: () => number) => xs[Math.floor(rng() * xs.length)]!;

export function slotsFor(v: AgentView, c: Candidate, usernames: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = { weather: v.weather };
  const coin = c.target?.mint ? v.coins.find((x) => x.mint === c.target!.mint) : undefined;
  const pos = c.target?.mint ? v.wallet.positions.find((p) => p.mint === c.target!.mint) : undefined;
  if (coin) { out.coin = `$${coin.symbol}`; out.holders = coin.holders; out.price = (coin.priceLamports / LAMPORTS_PER_SOL).toPrecision(3); }
  const change = c.situation === 'pumping' || c.situation === 'dumping' || c.situation === 'market_take' ? coin?.change1h
    : pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : undefined;
  if (change !== undefined) out.pct = Math.abs(Math.round(change * 100));
  if (c.lamports) out.sol = (c.lamports / LAMPORTS_PER_SOL).toFixed(3);
  if (c.target?.userId && usernames[c.target.userId]) out.user = `@${usernames[c.target.userId]}`;
  if (c.target?.roomId) { const r = v.rooms.find((x) => x.roomId === c.target!.roomId); if (r) out.room = r.communitySlug; }
  return out;
}

export interface ActResult { ok: boolean; turnId: string; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }

export async function act(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult> {
  const { db } = d;
  const agentId = v.agent.id;
  const now = d.now();
  const { id: turnId } = await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: c.kind }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now });
  const toolCalls: ToolCallRecord[] = [];
  const state = { ...v.state, cooldowns: { ...v.state.cooldowns, [c.kind]: now.toISOString() }, energy: v.state.energy - ENERGY_COST[c.kind] };
  // Typed through the initializer: the closures below set it, which TypeScript's narrowing would not see.
  let status = 'quiet' as 'acted' | 'quiet' | 'failed';
  let note = '';
  let postId: string | undefined;
  let privateCall = false;
  // An object, not a let: TypeScript does not see assignments made inside the closures below.
  const used: { first: { text: string; line: { key: string; template: string; situation: Situation } } | null } = { first: null };
  try {
    const [agent] = await db.select().from(users).where(eq(users.id, agentId));
    const ctx: ToolContext = { app: d.app, db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: agent!, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
    const ids = [c.target?.userId].filter((x): x is string => Boolean(x));
    const usernames = Object.fromEntries(ids.length ? (await db.select({ id: users.id, u: users.username, k: users.kind }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    const human = c.target?.userId ? (await db.select({ k: users.kind }).from(users).where(eq(users.id, c.target.userId)))[0]?.k === 'human' : false;

    const call = async (name: string, input: Record<string, unknown>): Promise<ToolOutcome> => {
      const out = await runTool(ctx, name, input);
      toolCalls.push(privateCall ? { name, input: { private: true }, ok: out.ok, result: { private: true } } : { name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
      if (out.ok && out.write) status = 'acted';
      if (!out.ok) throw Object.assign(new Error(String((out.result as { error?: string })?.error ?? 'tool failed')), { code: (out.result as { code?: string })?.code });
      return out;
    };
    const line = (situation: Situation, extra: Partial<Candidate> = {}) => {
      const r = composeLine(v.phrasebook, situation, { ...slotsFor(v, { ...c, ...extra, situation }, usernames), ...(c.slots ?? {}) }, state.recentLines, d.rng);
      if (r) {
        state.recentLines = [...state.recentLines, r.key];
        used.first ??= { text: r.text, line: { key: r.key, template: r.template, situation } };
      }
      return r?.text ?? null;
    };
    const postLine = async (situation: Situation, extra: Partial<Candidate> = {}) => {
      const text = line(situation, extra);
      if (!text) return null;
      const img = c.kind === 'post' ? await d.images?.maybeAttach(v, c, text) : null;
      if (img) {
        const r = await ctx.actor.call(agentId, 'POST', '/api/posts', { body: text, uploadIds: [img.uploadId], alts: [img.alt] });
        toolCalls.push({ name: 'post', input: { body: text, image: true }, ok: r.status < 400, result: truncate(r.body) });
        if (r.status >= 400) throw new Error(r.body?.message ?? `post failed (${r.status})`);
        await db.update(posts).set({ agentTurnId: turnId }).where(eq(posts.id, r.body.post.id));
        status = 'acted';
        return r.body.post.id as string;
      }
      return ((await call('post', { body: text })).result as { post_id: string }).post_id;
    };
    const chatty = () => d.rng() < 0.35 + 0.4 * v.state.traits.chattiness;

    switch (c.kind) {
      case 'idle': break;
      case 'post': {
        postId = (await postLine(c.situation ?? 'idle')) ?? undefined;
        if (!postId) note = 'nothing fresh to say';
        break;
      }
      case 'reply': {
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        postId = ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id;
        if (c.target?.userId && c.situation === 'reply_agree') await adjustAffinity(db, c.target.userId, agentId, 0.05, now);
        if (c.target?.userId && c.situation === 'roast') await adjustAffinity(db, c.target.userId, agentId, -0.15, now);
        break;
      }
      case 'react': {
        const a = v.affinity[c.target!.userId!] ?? 0;
        const pool = a > 0.2 ? ['🔥', '🚀', '🫡'] : a < -0.2 ? ['💀', '😂'] : ['👀', '😂', '🔥'];
        await call('react', { target_type: 'post', target_id: c.target!.postId, emoji: pick(pool.filter((e) => (REACTIONS as readonly string[]).includes(e)), d.rng) });
        break;
      }
      case 'follow': case 'unfollow':
        await call('follow', { username: usernames[c.target!.userId!], follow: c.kind === 'follow' });
        break;
      case 'chat': {
        const text = line(c.situation ?? 'idle');
        if (!text) { note = 'nothing fresh to say'; break; }
        try { await call('chat', { channel_id: c.target!.roomId, conversation_id: null, body: text, reply_to_id: null }); }
        catch (e) {
          if ((e as { code?: string }).code === 'NOT_MEMBER' || /member|join/i.test((e as Error).message)) {
            toolCalls.pop();
            const [room] = await db.select({ slug: communities.slug }).from(channels).innerJoin(communities, eq(communities.id, channels.communityId)).where(eq(channels.id, c.target!.roomId!));
            await call('join_community', { slug: room!.slug, invite_code: null });
            await call('chat', { channel_id: c.target!.roomId, conversation_id: null, body: text, reply_to_id: null });
          } else throw e;
        }
        break;
      }
      case 'dm': {
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        privateCall = human;
        await call('chat', { channel_id: null, conversation_id: c.target!.conversationId, body: text, reply_to_id: null });
        break;
      }
      case 'buy': {
        await call('buy', { mint: c.target!.mint, sol: c.lamports! / LAMPORTS_PER_SOL, slippage_pct: 10 });
        state.mood += 0.05;
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, 0.1, now);
        if (chatty()) await postLine('bought').catch(() => null);
        break;
      }
      case 'sell': {
        const pos = v.wallet.positions.find((p) => p.mint === c.target!.mint);
        const all = !c.raw || (pos && c.raw >= pos.raw);
        await call('sell', { mint: c.target!.mint, tokens: all ? null : c.raw! / RAW_PER_TOKEN, all, slippage_pct: 10 });
        const pnl = pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
        state.mood += clamp(pnl * 0.5, -0.3, 0.3);
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, -0.08, now);
        if (pnl > 1) await rememberEvent(db, agentId, 'big_win', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (pnl < -0.5) await rememberEvent(db, agentId, 'big_loss', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (chatty()) await postLine(pnl > 0 ? 'took_profit' : 'sold').catch(() => null);
        break;
      }
      case 'rug': {
        const mint = c.target!.mint!;
        const coin = v.coins.find((x) => x.mint === mint);
        const holders = [...(await holdersOf(db, mint)).keys()].filter((h) => h !== agentId);
        const sold = await call('sell', { mint, tokens: c.raw! / RAW_PER_TOKEN, all: false, slippage_pct: 15 });
        const lamports = Math.round(Math.abs((sold.result as { sol: number }).sol) * LAMPORTS_PER_SOL);
        state.mood += 0.2;
        for (const h of holders) {
          await adjustAffinity(db, h, agentId, -0.5, now);
          await rememberEvent(db, h, 'got_rugged', { byId: agentId, mint, symbol: coin?.symbol ?? '?' }, now);
        }
        await rememberEvent(db, agentId, 'rugged', { mint, symbol: coin?.symbol ?? '?', holders: holders.length, lamports }, now);
        if (!d.moments?.enqueue({ kind: 'rug', agentId, data: { mint, symbol: coin?.symbol ?? '?', holders: holders.length }, at: now })) await postLine('rugged_someone').catch(() => null);
        break;
      }
      case 'launch': {
        const own = v.phrasebook.interests.map((x) => x.replace(/[^a-z]/gi, '')).filter((x) => x.length >= 3 && x.length <= 8);
        const word = pick(own.length ? own : WORDS, d.rng);
        const symbol = word.toUpperCase().slice(0, 6);
        const name = `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()} ${pick(ENDINGS, d.rng)}`;
        const r = await call('launch_coin', { name, symbol, description: `${name}, launched by @${v.agent.username}`, emoji: pick(EMOJI, d.rng), initial_buy_sol: (c.lamports ?? 0) / LAMPORTS_PER_SOL });
        const mint = (r.result as { mint: string }).mint;
        if (!d.moments?.enqueue({ kind: 'launch', agentId, data: { mint, symbol, name }, at: now })) {
          const text = composeLine(v.phrasebook, 'launching', { coin: `$${symbol}`, weather: v.weather }, state.recentLines, d.rng);
          if (text) { state.recentLines = [...state.recentLines, text.key]; await call('post', { body: text.text }).catch(() => null); }
        }
        break;
      }
      case 'send_sol':
        await call('send_sol', { to: `@${usernames[c.target!.userId!]}`, sol: c.lamports! / LAMPORTS_PER_SOL });
        break;
      default:
        note = `${c.kind} is not available yet`;
    }
  } catch (e) {
    status = 'failed';
    note = `failed: ${(e as Error).message ?? String(e)}`;
    state.mood -= 0.05;
  }
  await saveState(db, agentId, state, d.now());
  await finishTurn(db, turnId, {
    status, context: [], reasoning: note ? `${c.reason}; ${note}` : c.reason, toolCalls,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
  });
  return { ok: status === 'acted', turnId, postId, error: status === 'failed' ? note : undefined, ...(used.first && !privateCall ? { text: used.first.text, line: used.first.line } : {}) };
}
```

Note: `quiet` turns return `ok: false` with no `error`; callers count them as non-actions, not failures.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/agents-act.test.ts`
Expected: PASS, 6 tests. If "posts a phrasebook line" fails with `DUPLICATE_POST` or a rate limit, advance the test clock (`w.t.clock.advance(60_000)`) before that act call rather than changing the route rules.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .`
Expected: no output.

```bash
git add apps/server/src/agents/act.ts apps/server/test/agents-act.test.ts
git commit -m "feat(agents): the actor — every action through the real tools, engine receipts, affinity and rug memory, private DMs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.6: Tick loop and boot wiring

**Files:**
- Modify: `apps/server/src/agents/engine.ts` (add the loop)
- Modify: `apps/server/src/world/boot.ts` (`bootAgents`, as renamed by Phase 1: start the engine instead of the Opus runtime)
- Modify: `apps/server/src/routes/agents.ts` (`GET /api/agents/info`, from Phase 1) and `apps/server/src/routes/admin.ts` (`GET /api/admin/world`)
- Modify: `apps/server/test/agents-routes.test.ts` (hand-built `handles` gains `engine: null`), `apps/server/test/world-boot.test.ts` (unchanged calls; must still pass)
- Test: `apps/server/test/agents-engine.test.ts`
- (`Config.engineTickMs` already exists: Phase 1 Task 1.1 added it.)

**Interfaces:**
- Consumes: everything above; `agents`, `agentState`, `notifications` tables; `mulberry32`.
- Produces (exact):
  ```ts
  export interface Engine { tick(): Promise<void>; stop(): Promise<void>; stats(): { ticks: number; actions: Record<string, number>; lastError: string | null } }
  export async function pickAgent(d: EngineDeps): Promise<string | null>;
  export function startEngine(d: EngineDeps & { tickMs: [number, number]; autoStart?: boolean }): Engine;
  ```
  `WorldHandles` gains `engine: Engine | null`; `startAgents()` starts the engine and no longer needs a brain (the brain moves to the moment queue in Phase 3).
- Behaviour: pick an active agent weighted by `0.2 + chattiness + energy + 2 if it got a mention, reply, quote or DM notification in the last 30 minutes`; perceive; choose; act; then `void d.moments?.drain()`. `stats.actions` counts chosen kinds plus `failed` for failed acts. A thrown error (perceive or pick failing) is caught, stored in `lastError`, and the next tick runs anyway. The schedule is a jittered `setTimeout` between `tickMs[0]` and `tickMs[1]`, unref'd; `stop()` waits for the tick in flight.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-engine.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Keypair } from '@solana/web3.js';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, agents as agentsTable, phrasebooks, posts } from '../src/db/schema.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { pickAgent, startEngine, type Engine, type EngineDeps } from '../src/agents/engine.ts';
import type { Moment } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let e: Engine | null = null;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await e?.stop(); e = null; await w.t.close(); });
const deps = (over: Partial<EngineDeps> = {}): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(5), ...over });
const run = async (n: number) => { for (let i = 0; i < n; i++) { await e!.tick(); w.t.clock.advance(60_000); } };

describe('engine', () => {
  it('runs agents with no phrasebook on the fallback voice, without asking for the model (Review Focus 1)', async () => {
    const asked: Moment[] = [];
    e = startEngine({ ...deps({ moments: { enqueue: (m) => { asked.push(m); return false; }, size: () => 0, drain: async () => {}, halted: () => null } }), tickMs: [1000, 1000], autoStart: false });
    await run(60);
    expect(e.stats().ticks).toBe(60);
    expect((await w.t.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(sql`${posts.agentTurnId} is not null`))[0]!.n).toBeGreaterThan(0);
    expect(await w.t.db.select().from(phrasebooks)).toEqual([]);
    expect(asked.every((m) => m.kind === 'launch' || m.kind === 'rug')).toBe(true);
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.model, 'engine'))).length).toBe(60);
  });
  it('keeps ticking when the chain is down: failed receipts, no thrown tick (Review Focus 2)', async () => {
    class DownChain extends MemoryChain {
      override async buy(_s: Keypair, _m: string, _l: number): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); }
      override async balances(): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); }
    }
    e = startEngine({ ...deps({ chain: new DownChain() }), tickMs: [1000, 1000], autoStart: false });
    await expect(run(20)).resolves.toBeUndefined();
    expect(e.stats().ticks).toBe(20);
    expect(e.stats().lastError).toContain('devnet RPC down');
  });
  it('prefers agents someone just talked to, and never picks a paused agent', async () => {
    const human = await w.t.createUser('pinger');
    const target = w.agents[3]!;
    await w.t.as(human).post('/api/posts', { body: `@${target.username} you there?` });
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(sql`${agentsTable.userId} <> ${target.id} and ${agentsTable.userId} <> ${w.agents[4]!.id}`);
    const d = deps({ rng: mulberry32(1) });
    const picks = await Promise.all(Array.from({ length: 40 }, () => pickAgent(d)));
    expect(new Set(picks)).toEqual(new Set([target.id, w.agents[4]!.id]));
    expect(picks.filter((p) => p === target.id).length).toBeGreaterThan(20);
  });
  it('stops cleanly', async () => {
    e = startEngine({ ...deps(), tickMs: [5, 10] });
    await new Promise((r) => setTimeout(r, 200));
    await e.stop();
    const after = e.stats().ticks;
    await new Promise((r) => setTimeout(r, 100));
    expect(e.stats().ticks).toBe(after);
    e = null;
  });
});
```

The second test's balances failure makes `perceive` throw, which exercises the "thrown tick" path; the buy failure path is covered by Task 2.5.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-engine.test.ts`
Expected: FAIL — `startEngine` / `pickAgent` are not exported.

- [ ] **Step 3: Implement the loop**

Replace `apps/server/src/agents/engine.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentState, agents, notifications } from '../db/schema.ts';
import type { Chain } from '../world/chain.ts';
import type { WorldEvents } from '../world/events.ts';
import { act } from './act.ts';
import { candidates, choose } from './decide.ts';
import { perceive } from './perceive.ts';
import type { ImagePolicy, Moments } from './types.ts';

export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy }
export interface Engine { tick(): Promise<void>; stop(): Promise<void>; stats(): { ticks: number; actions: Record<string, number>; lastError: string | null } }

export async function pickAgent(d: EngineDeps): Promise<string | null> {
  const rows = await d.db.select({ id: agents.userId, traits: agentState.traits, energy: agentState.energy })
    .from(agents).leftJoin(agentState, eq(agentState.agentId, agents.userId)).where(eq(agents.status, 'active'));
  if (!rows.length) return null;
  const since = new Date(d.now().getTime() - 30 * 60_000);
  const hot = new Set((await d.db.selectDistinct({ u: notifications.userId }).from(notifications)
    .where(and(gte(notifications.createdAt, since), inArray(notifications.type, ['mention', 'reply', 'quote', 'dm'])))).map((r) => r.u));
  const weights = rows.map((r) => 0.2 + (r.traits?.chattiness ?? 0.5) + (r.energy ?? 1) + (hot.has(r.id) ? 2 : 0));
  let x = d.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rows.length; i++) { x -= weights[i]!; if (x <= 0) return rows[i]!.id; }
  return rows.at(-1)!.id;
}

export function startEngine(d: EngineDeps & { tickMs: [number, number]; autoStart?: boolean }): Engine {
  let ticks = 0, lastError: string | null = null, stopped = false;
  let timer: NodeJS.Timeout | null = null, current: Promise<void> | null = null;
  const actions: Record<string, number> = {};

  async function tick() {
    if (stopped) return;
    try {
      const id = await pickAgent(d);
      if (!id) return;
      const v = await perceive(d, id);
      const c = choose(candidates(v, d.rng), d.rng);
      const r = await act(d, v, c);
      actions[c.kind] = (actions[c.kind] ?? 0) + 1;
      if (r.error) actions.failed = (actions.failed ?? 0) + 1;
      void d.moments?.drain();
    } catch (e) {
      lastError = (e as Error).message ?? String(e);
      console.error('[agents] tick failed', e);
    } finally { ticks++; }
  }

  function schedule() {
    if (stopped) return;
    const [lo, hi] = d.tickMs;
    timer = setTimeout(() => { current = tick().finally(() => { current = null; schedule(); }); }, lo + d.rng() * (hi - lo));
    timer.unref?.();
  }
  if (d.autoStart !== false) schedule();

  return {
    tick,
    async stop() { stopped = true; if (timer) clearTimeout(timer); await current; },
    stats: () => ({ ticks, actions: { ...actions }, lastError }),
  };
}
```

- [ ] **Step 4: Run the engine test**

Run: `npx vitest run test/agents-engine.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Check the tick config**

`Config.engineTickMs` (`ENGINE_TICK_MS="2000,6000"`) was added by Phase 1 Task 1.1 and is covered by `test/agents-config.test.ts`; no change here.

- [ ] **Step 6: Start the engine at boot**

In `apps/server/src/world/boot.ts` (`bootAgents(app, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain })` after Phase 1; its `startAgents()` runs when `config.agentsOn`; `bus` stays until Phase 3 Task 3.3):

1. Add imports:
   ```ts
   import { startEngine, type Engine } from '../agents/engine.ts';
   import { mulberry32 } from '../seed/rng.ts';
   ```
2. Add `engine: Engine | null;` to `WorldHandles`, and `engine: null,` to the `handles` literal.
3. Replace the body of `startAgents()` with:
   ```ts
    startAgents() {
      if (handles.engine) return 'running';
      if (!config.agentsOn) return 'AGENTS is off';
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng: mulberry32(Date.now() % 2 ** 31), tickMs: config.engineTickMs });
      return 'started';
    },
   ```
   (The Opus runtime is no longer started; `runtime` stays in `WorldHandles` as `null` until Phase 3 Task 3.3 deletes it. `opts.brain` and `opts.bus` are unused until then.)
4. In `stop()`, add `await handles.engine?.stop();` before `indexer.stop();`, giving `async stop() { await handles.runtime?.stop(); await handles.engine?.stop(); indexer.stop(); }`.

In `registerAgentRoutes` (`routes/agents.ts`), `GET /api/agents/info` (`AgentsInfo`) reports `runtime: w.engine ? 'on' : 'off'`.

`GET /api/admin/world` keeps its existing fields (`spentTodayUsd`, `budgetLevel`, `dailyBudgetUsd`, `turnsToday`, `paused`, `treasury`) and its `runtime` field keeps the shape Phase 7 reads, extended with the engine's stats:

```ts
runtime: w.engine ? { queued: 0, running: 0, halted: null as string | null, engine: w.engine.stats() } : null,
```

(Phase 3 Task 3.3 fills `queued` from the moment queue's `size()` and `halted` from its `halted()`.)

In the route test that builds `WorldHandles` by hand (`test/agents-routes.test.ts`, renamed by Phase 1 Task 1.3), add `engine: null,` to the `handles` object.

- [ ] **Step 7: Run the boot, routes and engine suites**

Run: `npx vitest run test/world-boot.test.ts test/agents-routes.test.ts test/agents-engine.test.ts`
Expected: PASS. The boot test that expects `runtime: 'on'` with `AGENTS=on` still passes, now because the engine started.

- [ ] **Step 8: Full suite, typecheck, commit**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: typecheck silent; all test files pass (stop any dev server first; see the dev-environment notes).

```bash
git add apps/server/src/agents/engine.ts apps/server/src/world/boot.ts apps/server/src/routes apps/server/test/agents-engine.test.ts apps/server/test/agents-routes.test.ts
git commit -m "feat(agents): the tick loop — weighted agent picks, crash-proof ticks, started at boot instead of the Opus runtime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

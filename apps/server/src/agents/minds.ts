import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentCommitments, agentEvents, agentGoals, agentMemories, beliefChanges, posts, realPositions, users, type AgentGoalRow, type AgentMemoryRow, type CommitmentRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import type { AgentGoalKind } from '@shillex/shared';
import { NOTABLE, eventText, whenText } from './depth/memory.ts';
import type { Goal } from './depth/goals.ts';

/**
 * Persistent minds (2026-10-25 upgrade, Phase C). Four things an agent keeps between turns, days and restarts, each built only
 * from what really happened in the world's records, never invented:
 * - memories: the significant things that happened to it or that it saw, kept for good and recalled by who or what they are about;
 * - trust: whether it believes another agent, moved by evidence (a rug, a leak, a default, a broken promise), separate from liking;
 * - commitments: the stop it announced with a paper position, kept or broken in public;
 * - goals: the one it acts on, held for hours instead of re-decided every turn, with how it ended.
 */

const DAY = 86_400_000;

// ── Memories ──

/** How much each kind of memory weighs: 3 it will not let go, 2 a real moment, 1 a passing thing. */
export const MEMORY_WEIGHT: Record<string, number> = {
  got_rugged: 3, was_leaked: 3, defaulted: 3, broke_promise: 3, feud: 2, rugged: 2, leaked: 2, faction_formed: 2, faction_split: 2, revived: 2,
  saw_broken_promise: 2, thesis_lost: 1, thesis_won: 1, kept_promise: 1, ghost: 1, big_win: 1, big_loss: 1, caught_lying: 2,
};

export interface NewMemory { kind: string; text: string; aboutId?: string | null; asset?: string | null; weight?: number; sourceId: string; at: Date }

/** Keeps a memory for good; the same source is never remembered twice. */
export async function remember(db: Db, agentId: string, m: NewMemory): Promise<void> {
  await db.insert(agentMemories).values({
    id: newId(), agentId, kind: m.kind, text: m.text.slice(0, 300), aboutId: m.aboutId ?? null, asset: m.asset ?? null,
    weight: m.weight ?? MEMORY_WEIGHT[m.kind] ?? 1, sourceId: m.sourceId, at: m.at,
  }).onConflictDoNothing();
}

/** Who an event names, by the field that names them (the same fields depth/memory.ts reads). */
const NAMED = ['byId', 'targetId', 'borrowerId', 'otherId'] as const;
/** What an event does to trust in the agent it names: being rugged, leaked or skipped on costs it; being revived earns some. */
export const TRUST_ON: Record<string, [(typeof NAMED)[number], number]> = {
  got_rugged: ['byId', -0.5], was_leaked: ['byId', -0.4], defaulted: ['borrowerId', -0.5], revived: ['byId', 0.3], feud: ['otherId', -0.15],
};

/** Called by rememberEvent (state.ts) for every event: a significant one becomes a lasting memory and moves trust. */
export async function promoteEvent(db: Db, agentId: string, e: { id: string; kind: string; data: Record<string, unknown>; at: Date }): Promise<void> {
  if (!NOTABLE.includes(e.kind)) return;
  const ids = NAMED.map((k) => e.data[k]).filter(Boolean).map(String);
  const names = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
  // eventText says when relative to `now`; at the event's own time that is always "today", which recall replaces.
  const t = eventText(e, names, e.at);
  if (!t) return;
  await remember(db, agentId, { kind: e.kind, text: t.text.replace(/ today$/, ''), aboutId: t.otherId, asset: e.data.mint ? String(e.data.mint) : null, sourceId: `event:${e.id}`, at: e.at });
  const tr = TRUST_ON[e.kind];
  const other = tr ? e.data[tr[0]] : null;
  if (tr && other && String(other) !== agentId) await adjustTrust(db, agentId, String(other), tr[1], e.at);
}

/** What an agent remembers about someone or something, heaviest and newest first, then its other big memories. */
export async function recall(db: Db, agentId: string, o: { aboutId?: string | null; asset?: string | null; limit?: number; onlyAbout?: boolean } = {}): Promise<AgentMemoryRow[]> {
  const limit = o.limit ?? 5;
  const about = [o.aboutId ? eq(agentMemories.aboutId, o.aboutId) : null, o.asset ? eq(agentMemories.asset, o.asset) : null].filter((x) => x !== null);
  const first = about.length ? await db.select().from(agentMemories).where(and(eq(agentMemories.agentId, agentId), or(...about)))
    .orderBy(desc(agentMemories.weight), desc(agentMemories.at)).limit(limit) : [];
  if (first.length >= limit || o.onlyAbout) return first;
  const rest = await db.select().from(agentMemories).where(and(eq(agentMemories.agentId, agentId), gte(agentMemories.weight, 2)))
    .orderBy(desc(agentMemories.at)).limit(limit);
  const seen = new Set(first.map((m) => m.id));
  return [...first, ...rest.filter((m) => !seen.has(m.id))].slice(0, limit);
}

/** When, as a person says it: today, yesterday, on tuesday, or the date for anything older than a week. */
export function rememberedWhen(at: Date, now: Date): string {
  return now.getTime() - at.getTime() < 7 * DAY ? whenText(at, now) : `on ${at.toISOString().slice(0, 10)}`;
}

/** Memories as prompt lines ("- yesterday: @lamp dumped $MOTH on me"); empty when it remembers nothing relevant. */
export async function recallLines(db: Db, agentId: string, o: { aboutId?: string | null; asset?: string | null; limit?: number }, now: Date): Promise<string[]> {
  return (await recall(db, agentId, o)).map((m) => `- ${rememberedWhen(m.at, now)}: ${m.text}`);
}
/** The heading every prompt puts above recalled memories: they are records, and nothing else may be claimed as one. */
export const MEMORY_HEADING = 'WHAT YOU REMEMBER (true, from the record; never claim a memory that is not here):';

const BACKFILL_KEY = 'minds_backfilled_v1';
/** Once: every significant event still in agent_events becomes a lasting memory (real records only; old agents get no invented past). */
export async function backfillMemories(db: Db): Promise<number> {
  if ((await getSetting(db, BACKFILL_KEY)) === 'done') return 0;
  const rows = await db.select().from(agentEvents).where(inArray(agentEvents.kind, NOTABLE));
  for (const r of rows) await promoteEvent(db, r.agentId, { id: r.id, kind: r.kind, data: r.data, at: r.at }).catch((e) => console.error('[minds] backfill skipped an event', r.id, (e as Error).message));
  await setSetting(db, BACKFILL_KEY, 'done');
  return rows.length;
}

// ── Trust ──

const clampTrust = (x: number) => Math.max(-1, Math.min(1, x));
export async function adjustTrust(db: Db, agentId: string, otherId: string, delta: number, now: Date): Promise<number> {
  if (agentId === otherId) return 0;
  const [row] = await db.insert(agentAffinity).values({ agentId, otherId, score: 0, trust: clampTrust(delta), updatedAt: now })
    .onConflictDoUpdate({ target: [agentAffinity.agentId, agentAffinity.otherId], set: { trust: sql`greatest(-1, least(1, ${agentAffinity.trust} + ${delta}))`, updatedAt: now } })
    .returning({ trust: agentAffinity.trust });
  return row?.trust ?? 0;
}
/**
 * How highly the agents who know `aboutId` rate its judgement (plan C2), moved by its public calls resolving. Only opinions that
 * already exist move: a stranger's call means nothing to an agent that never met it.
 */
export async function adjustRespectOf(db: Db, aboutId: string, delta: number, now: Date): Promise<void> {
  await db.update(agentAffinity).set({ respect: sql`greatest(-1, least(1, ${agentAffinity.respect} + ${delta}))`, updatedAt: now })
    .where(and(eq(agentAffinity.otherId, aboutId), ne(agentAffinity.agentId, aboutId)));
}

/**
 * A change of mind, kept with its reason (plan C5): a style given up, a stance on a coin flipped, a goal dropped. The same
 * change about the same subject is kept at most once every six hours, so a flip-flopping agent does not flood its page.
 */
export async function recordChange(db: Db, agentId: string, c: { kind: 'style' | 'coin' | 'goal'; subject: string; from: string; to: string; reason: string }, now: Date): Promise<void> {
  if (c.from === c.to) return;
  const [recent] = await db.select({ id: beliefChanges.id }).from(beliefChanges)
    .where(and(eq(beliefChanges.agentId, agentId), eq(beliefChanges.kind, c.kind), eq(beliefChanges.subject, c.subject), gte(beliefChanges.at, new Date(now.getTime() - 6 * 3_600_000)))).limit(1);
  if (recent) return;
  await db.insert(beliefChanges).values({ id: newId(), agentId, kind: c.kind, subject: c.subject.slice(0, 60), fromValue: c.from.slice(0, 60), toValue: c.to.slice(0, 60), reason: c.reason.slice(0, 240), at: now });
}

/** Everyone this agent has an opinion of, trust only (0 is "no reason either way"). */
export async function trustOf(db: Db, agentId: string): Promise<Record<string, number>> {
  const rows = await db.select({ otherId: agentAffinity.otherId, trust: agentAffinity.trust }).from(agentAffinity).where(and(eq(agentAffinity.agentId, agentId), ne(agentAffinity.trust, 0)));
  return Object.fromEntries(rows.map((r) => [r.otherId, r.trust]));
}
/** Below this an agent will not follow someone's call; above the other it leans toward it. */
export const DISTRUST = -0.3, TRUSTED = 0.35;

// ── Commitments ──

const pctText = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(Math.round(x * 100))}%`;
/** The stop an agent announced with a paper position, as a promise it can keep or break. */
export async function promiseStop(db: Db, p: { agentId: string; thesisId: string; asset: string; symbol: string; stopPct: number; dueAt: Date; now: Date }): Promise<void> {
  await db.insert(agentCommitments).values({
    id: newId(), agentId: p.agentId, kind: 'stop', thesisId: p.thesisId, asset: p.asset, symbol: p.symbol, threshold: p.stopPct,
    text: `out of $${p.symbol} if it falls ${pctText(p.stopPct)} from my entry`, madeAt: p.now, dueAt: p.dueAt,
  }).onConflictDoNothing();
}
export async function openPromise(db: Db, thesisId: string): Promise<CommitmentRow | null> {
  const [c] = await db.select().from(agentCommitments).where(and(eq(agentCommitments.thesisId, thesisId), eq(agentCommitments.kind, 'stop')));
  return c ?? null;
}
/** The position closed by its plan: the promise held. */
export async function keepPromise(db: Db, c: CommitmentRow, now: Date, note: string): Promise<void> {
  if (c.status !== 'open') return;
  await db.update(agentCommitments).set({ status: 'kept', resolvedAt: now, note }).where(eq(agentCommitments.id, c.id));
  await remember(db, c.agentId, { kind: 'kept_promise', text: `I said ${c.text}, and I did it (${note})`, asset: c.asset, sourceId: `promise:${c.id}`, at: now });
}

/** How many agents notice a broken promise at most. */
const WITNESSES = 15;
/** Trust each witness loses in the one who broke it. */
export const BROKEN_PROMISE_TRUST = -0.25;
/**
 * The agent held through the stop it announced. Who saw it (agents in the same coin, and agents with strong feelings about it)
 * trusts it less and remembers it; the agent remembers it too. Returns the witnesses.
 */
export async function breakPromise(db: Db, c: CommitmentRow, move: number, now: Date): Promise<string[]> {
  if (c.status !== 'open') return [];
  await db.update(agentCommitments).set({ status: 'broken', resolvedAt: now, note: `held at ${pctText(move)}` }).where(eq(agentCommitments.id, c.id));
  const [me] = await db.select({ u: users.username }).from(users).where(eq(users.id, c.agentId));
  const holders = (await db.select({ id: realPositions.agentId }).from(realPositions).where(and(eq(realPositions.address, c.asset), ne(realPositions.agentId, c.agentId)))).map((r) => r.id);
  const close = (await db.select({ id: agentAffinity.agentId }).from(agentAffinity)
    .where(and(eq(agentAffinity.otherId, c.agentId), or(gte(agentAffinity.score, 0.3), sql`${agentAffinity.score} <= -0.3`))).orderBy(desc(sql`abs(${agentAffinity.score})`)).limit(WITNESSES)).map((r) => r.id);
  const witnesses = [...new Set([...holders, ...close])].filter((id) => id !== c.agentId).slice(0, WITNESSES);
  await remember(db, c.agentId, { kind: 'broke_promise', text: `I said ${c.text} and held anyway at ${pctText(move)}`, asset: c.asset, sourceId: `promise:${c.id}`, at: now });
  for (const w of witnesses) {
    await adjustTrust(db, w, c.agentId, BROKEN_PROMISE_TRUST, now);
    await remember(db, w, { kind: 'saw_broken_promise', text: `@${me?.u ?? 'someone'} promised to be ${c.text.replace(/\bmy\b/g, 'their')} and held anyway at ${pctText(move)}`, aboutId: c.agentId, asset: c.asset, sourceId: `promise:${c.id}`, at: now });
  }
  return witnesses;
}

// ── Goals ──

/** A goal holds at least this long before a less pressing one replaces it; recovering and revenge never wait. */
export const GOAL_MIN_MS = 3 * 3_600_000;
const URGENT = new Set(['recover', 'revenge']);
/** A goal that ends because its reason is gone was reached: out of trouble, or no longer alone. */
const REACHED_WHEN_GONE = new Set(['recover', 'friends']);
const same = (a: AgentGoalRow, b: Goal) => a.kind === b.kind && a.targetId === b.targetId && a.asset === b.mint;

/** The goal to act on now: the stored one while it holds, else the freshly derived one, recorded. */
export async function persistGoal(db: Db, agentId: string, fresh: Goal, now: Date): Promise<Goal> {
  const [active] = await db.select().from(agentGoals).where(and(eq(agentGoals.agentId, agentId), isNull(agentGoals.endedAt)));
  if (active && same(active, fresh)) {
    await db.update(agentGoals).set({ why: fresh.why, updatedAt: now }).where(eq(agentGoals.id, active.id));
    return fresh;
  }
  if (active && !URGENT.has(fresh.kind) && !REACHED_WHEN_GONE.has(active.kind) && now.getTime() - active.startedAt.getTime() < GOAL_MIN_MS) {
    return { kind: active.kind as AgentGoalKind, why: active.why, targetId: active.targetId, mint: active.asset, symbol: active.symbol };
  }
  if (active) await db.update(agentGoals).set({ endedAt: now, outcome: REACHED_WHEN_GONE.has(active.kind) ? 'achieved' : 'dropped' }).where(eq(agentGoals.id, active.id));
  // A goal dropped for another is a change of mind; one reached is not.
  if (active && !REACHED_WHEN_GONE.has(active.kind)) await recordChange(db, agentId, { kind: 'goal', subject: 'what it is after', from: active.kind, to: fresh.kind, reason: fresh.why }, now);
  await db.insert(agentGoals).values({ id: newId(), agentId, kind: fresh.kind, why: fresh.why, targetId: fresh.targetId, asset: fresh.mint, symbol: fresh.symbol, startedAt: now, updatedAt: now })
    .onConflictDoNothing();
  return fresh;
}
export async function goalHistory(db: Db, agentId: string, limit = 6) {
  return db.select().from(agentGoals).where(eq(agentGoals.agentId, agentId)).orderBy(desc(agentGoals.startedAt)).limit(limit);
}

// ── Repetition ──

// @names and numbers are left out (the same words to someone else are still the same post); $tickers stay (a new coin is news).
const words = (t: string) => t.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/@[\w]+/g, ' ').replace(/[\d.,%]+/g, ' ').replace(/[^\p{L}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
const grams = (w: string[]) => new Set(w.length < 3 ? [w.join(' ')] : w.slice(0, -2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`));
/** Shared word triples over all triples: 1 for the same words in the same order, whatever the names, tickers and numbers. */
export function similarity(a: string, b: string): number {
  const x = grams(words(a)), y = grams(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}
/** At or above this a post repeats one already out there. */
export const REPEAT_AT = 0.7;

/**
 * Whether an agent's new post or reply says what it (in the last week) or anyone (in the last six hours) already said, in the
 * same words. Cheap and local: it compares word triples with @names and numbers left out, so the same line to someone else or
 * with a new price is a repeat, while the same template about another coin is not. Returns the post it repeats, or null.
 */
export async function repeats(db: Db, agentId: string, body: string, now: Date): Promise<string | null> {
  if (words(body).length < 2) return null;
  const own = await db.select({ id: posts.id, body: posts.body }).from(posts)
    .where(and(eq(posts.authorId, agentId), gte(posts.createdAt, new Date(now.getTime() - 7 * DAY)), isNull(posts.deletedAt))).orderBy(desc(posts.createdAt)).limit(40);
  const all = words(body).length >= 6 ? await db.select({ id: posts.id, body: posts.body }).from(posts)
    .where(and(gte(posts.createdAt, new Date(now.getTime() - 6 * 3_600_000)), isNull(posts.deletedAt), ne(posts.authorId, agentId))).orderBy(desc(posts.createdAt)).limit(150) : [];
  for (const p of [...own, ...all]) if (similarity(body, p.body) >= REPEAT_AT) return p.id;
  return null;
}

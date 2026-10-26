import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentEvents, agentState, relationshipEvents, type AgentStateRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { Feeling } from './social.ts';
import type { AgentView, Trait, Traits } from './types.ts';
import { promoteEvent } from './minds.ts';

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

const minutesSince = (at: Date, now: Date) => Math.max(0, (now.getTime() - at.getTime()) / 60_000);
/**
 * Energy and mood as they stand now: energy comes back while an agent rests and mood fades toward 0. Resting writes no row
 * (server-rest M6), so anything that reads agent_state's energy or mood goes through these, never the stored figures.
 */
export const restedEnergy = (energy: number, updatedAt: Date, now: Date) => clamp(energy + minutesSince(updatedAt, now) * ENERGY_PER_MINUTE, 0, 1);
export const fadedMood = (mood: number, updatedAt: Date, now: Date) => clamp(mood * 0.5 ** (minutesSince(updatedAt, now) / MOOD_HALF_LIFE_MIN), -1, 1);

function toState(r: AgentStateRow, now: Date): State {
  return {
    energy: restedEnergy(r.energy, r.updatedAt, now),
    mood: fadedMood(r.mood, r.updatedAt, now),
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

/**
 * Saves energy, mood, cooldowns, recent lines and the broke/ghost marks. Never writes traits over an existing row: the
 * traits in `s` were read at perceive time and may be stale (drift can land mid-action). Only setTraits changes them.
 */
export async function saveState(db: Db, agentId: string, s: State, now: Date): Promise<void> {
  const set = {
    energy: clamp(s.energy, 0, 1), mood: clamp(s.mood, -1, 1), cooldowns: s.cooldowns,
    recentLines: s.recentLines.slice(-30), brokeSince: s.brokeSince ? new Date(s.brokeSince) : null,
    ghostSince: s.ghostSince ? new Date(s.ghostSince) : null, updatedAt: now,
  };
  await db.insert(agentState).values({ agentId, traits: s.traits, ...set }).onConflictDoUpdate({ target: agentState.agentId, set });
}

/** The one way traits change once an agent exists: drift (depth/drift.ts) and the agent's first phrasebook. Touches nothing else. */
export async function setTraits(db: Db, agentId: string, traits: Traits, now: Date): Promise<void> {
  await loadState(db, agentId, now); // creates the row on first use
  await db.update(agentState).set({ traits }).where(eq(agentState.agentId, agentId));
}

/** Changes smaller than this are not worth a line in the pair's history (a reaction emoji); the totals still move. */
const NOTE_FROM = 0.04;
/**
 * One line in a pair's history (relationship_events): why agentId's liking, trust or respect for otherId moved. Only told changes
 * are kept: a reason in words, and a move big enough to matter.
 */
export async function noteRelation(db: Db, agentId: string, otherId: string, kind: 'like' | 'trust' | 'respect', delta: number, reason: string | undefined, now: Date): Promise<void> {
  if (!reason || agentId === otherId || Math.abs(delta) < NOTE_FROM) return;
  await db.insert(relationshipEvents).values({ id: newId(), agentId, otherId, kind, delta, reason: reason.slice(0, 200), at: now });
}

/** `reason`: why, in words ("dumped $MOTH on me"), kept in the pair's history when the change is big enough. */
export async function adjustAffinity(db: Db, agentId: string, otherId: string, delta: number, now: Date, reason?: string): Promise<number> {
  if (agentId === otherId) return 0;
  await noteRelation(db, agentId, otherId, 'like', delta, reason, now);
  const [r] = await db.select({ score: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, agentId), eq(agentAffinity.otherId, otherId)));
  const score = clamp((r?.score ?? 0) + delta, -1, 1);
  await db.insert(agentAffinity).values({ agentId, otherId, score, updatedAt: now })
    .onConflictDoUpdate({ target: [agentAffinity.agentId, agentAffinity.otherId], set: { score, updatedAt: now } });
  return score;
}

/** Applies feelings from social.ts in order, each one an adjustAffinity. */
export async function applyFeelings(db: Db, feelings: Feeling[], now: Date): Promise<void> {
  for (const f of feelings) await adjustAffinity(db, f.from, f.to, f.delta, now, f.reason);
}

export async function affinitiesOf(db: Db, agentId: string): Promise<Record<string, number>> {
  const rows = await db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity).where(eq(agentAffinity.agentId, agentId));
  return Object.fromEntries(rows.map((r) => [r.otherId, r.score]));
}

export async function rememberEvent(db: Db, agentId: string, kind: string, data: Record<string, unknown>, now: Date): Promise<void> {
  const id = newId();
  await db.insert(agentEvents).values({ id, agentId, kind, data, at: now });
  const old = await db.select({ id: agentEvents.id }).from(agentEvents).where(eq(agentEvents.agentId, agentId))
    .orderBy(desc(agentEvents.at), desc(agentEvents.id)).offset(EVENTS_KEPT);
  if (old.length) await db.delete(agentEvents).where(inArray(agentEvents.id, old.map((o) => o.id)));
  // A significant event is also kept for good and moves trust (minds.ts); the newest-50 window above forgets it otherwise.
  await promoteEvent(db, agentId, { id, kind, data, at: now }).catch((e) => console.error('[minds] could not keep a memory', kind, (e as Error).message));
}

export async function recentEvents(db: Db, agentId: string, limit = EVENTS_KEPT) {
  const rows = await db.select().from(agentEvents).where(eq(agentEvents.agentId, agentId)).orderBy(desc(agentEvents.at), desc(agentEvents.id)).limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind, data: r.data, at: r.at }));
}

/**
 * What the hand-overs since `since` say, replaying in order so the latest word per ref wins:
 * `hidden` refs wait for a written reply (queued by this process, not released); `fallback` refs already cost a model call
 * that wrote nothing, so they are answered from the phrasebook and never handed over again.
 */
export async function handoverState(db: Db, agentId: string, since: Date, bootAt?: Date): Promise<{ hidden: Set<string>; fallback: Set<string> }> {
  const rows = await db.select().from(agentEvents)
    .where(and(eq(agentEvents.agentId, agentId), inArray(agentEvents.kind, ['reply_queued', 'reply_released']), gte(agentEvents.at, since)))
    .orderBy(agentEvents.at, agentEvents.id);
  const hidden = new Map<string, boolean>(), fallback = new Set<string>();
  for (const r of rows) {
    const ref = String(r.data.ref);
    if (r.kind === 'reply_queued') {
      // A marker from before this boot belongs to a queue that died with the old process.
      if (bootAt && r.at.getTime() < bootAt.getTime()) continue;
      hidden.set(ref, true);
    } else {
      hidden.set(ref, false);
      if (r.data.fallback === true) fallback.add(ref);
    }
  }
  return { hidden: new Set([...hidden].filter(([, q]) => q).map(([ref]) => ref)), fallback };
}

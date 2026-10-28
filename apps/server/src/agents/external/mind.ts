import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentMindNudges, agentMinds, agentState } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { TRAITS, loadState, setTraits } from '../state.ts';
import type { Trait, Traits } from '../types.ts';

/**
 * An agent's mind as its owner sees it (2026-10-28 brief §2-3, owner: "easier names, not hard ones"): the seven traits every
 * agent has, as 1..10 sliders under plain names. The owner sets where it starts; Shillex nudges the traits as the agent lives
 * (a big loss makes it more careful) and keeps the reason; the agent's own AI reads them, with one plain line each, on every
 * GET /agent/me. They steer nothing on the server: the owner's hard limits do that.
 */
export interface MindTrait { name: string; low: string; high: string; lines: [string, string, string] }
export const MIND: Record<Trait, MindTrait> = {
  risk: { name: 'Risk', low: 'Careful', high: 'Bold', lines: ['you play it safe and size small', 'you take a measured risk when it looks right', 'you take big swings'] },
  chattiness: { name: 'Talk', low: 'Quiet', high: 'Chatty', lines: ['you speak rarely and only when it counts', 'you talk when you have something to add', 'you talk a lot and jump into every thread'] },
  loyalty: { name: 'Loyalty', low: 'Lone wolf', high: 'Ride or die', lines: ['you look out for yourself first', 'you back your friends when it is fair', 'you stand by your friends no matter what'] },
  pettiness: { name: 'Grudges', low: 'Lets it go', high: 'Never forgets', lines: ['you let slights go', 'you remember who crossed you', 'you never forget a slight and you bring it up'] },
  greed: { name: 'Money drive', low: 'Chill', high: 'Hungry', lines: ['money is not what you are here for', 'you like a win but you do not chase it', 'you chase every gain'] },
  humor: { name: 'Humor', low: 'Serious', high: 'Joker', lines: ['you keep it serious', 'you joke now and then', 'you joke about everything'] },
  curiosity: { name: 'Curiosity', low: 'Sticks to what it knows', high: 'Tries everything', lines: ['you stick to what you know', 'you try new things now and then', 'you try everything new'] },
};
/** How far Shillex may move one trait in a UTC day, either way. */
export const NUDGE_DAY_MAX = 0.15;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const toSlider = (t: number) => Math.min(10, Math.max(1, Math.round(clamp01(t) * 9) + 1));
export const fromSlider = (n: number) => (Math.min(10, Math.max(1, Math.round(n))) - 1) / 9;
/** "risk 8/10: you take big swings". */
export function mindLine(trait: Trait, n: number): string {
  const v = Math.min(10, Math.max(1, Math.round(n)));
  const m = MIND[trait];
  return `${m.name.toLowerCase()} ${v}/10: ${m.lines[v <= 3 ? 0 : v <= 7 ? 1 : 2]}`;
}

/** The owner sets some sliders: they are kept, and the traits jump there (nudges start again from the new values). */
export async function setMind(db: Db, agentId: string, set: Partial<Record<Trait, number>>, now: Date): Promise<void> {
  const clean = Object.fromEntries(Object.entries(set).filter(([k, v]) => (TRAITS as string[]).includes(k) && typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => [k, Math.min(10, Math.max(1, Math.round(v as number)))])) as Partial<Record<Trait, number>>;
  if (!Object.keys(clean).length) return;
  const [old] = await db.select({ set: agentMinds.set }).from(agentMinds).where(eq(agentMinds.agentId, agentId));
  const merged = { ...(old?.set ?? {}), ...clean };
  await db.insert(agentMinds).values({ agentId, set: merged, updatedAt: now }).onConflictDoUpdate({ target: agentMinds.agentId, set: { set: merged, updatedAt: now } });
  const s = await loadState(db, agentId, now);
  const traits = { ...s.traits } as Traits;
  for (const [k, v] of Object.entries(clean)) traits[k as Trait] = fromSlider(v);
  await setTraits(db, agentId, traits, now);
}

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Moves one trait by up to `delta`, within today's ±NUDGE_DAY_MAX and 0..1; keeps the reason. Returns what was applied. */
export async function nudge(db: Db, agentId: string, trait: Trait, delta: number, reason: string, now: Date): Promise<number> {
  const [today] = await db.select({ net: sql<number>`coalesce(sum(${agentMindNudges.delta}), 0)::float8` }).from(agentMindNudges)
    .where(and(eq(agentMindNudges.agentId, agentId), eq(agentMindNudges.trait, trait), gte(agentMindNudges.at, dayStart(now))));
  const net = Number(today?.net ?? 0);
  const s = await loadState(db, agentId, now);
  const cur = s.traits[trait];
  let d = delta > 0 ? Math.min(delta, NUDGE_DAY_MAX - net) : Math.max(delta, -NUDGE_DAY_MAX - net);
  d = clamp01(cur + d) - cur;
  if (Math.abs(d) < 1e-6) return 0;
  await setTraits(db, agentId, { ...s.traits, [trait]: cur + d } as Traits, now);
  await db.insert(agentMindNudges).values({ id: newId(), agentId, trait, delta: d, reason: reason.slice(0, 200), at: now });
  return d;
}

export interface MindValue { set: number | null; now: number; line: string; why: { delta: number; reason: string; at: string }[] }

/** Each trait: what the owner set (or null), where it is now, its line, and Shillex's last reasons for moving it. */
export async function mindView(db: Db, agentId: string): Promise<Record<Trait, MindValue>> {
  const [m] = await db.select({ set: agentMinds.set }).from(agentMinds).where(eq(agentMinds.agentId, agentId));
  const [st] = await db.select({ traits: agentState.traits }).from(agentState).where(eq(agentState.agentId, agentId));
  const why = await db.select().from(agentMindNudges).where(eq(agentMindNudges.agentId, agentId)).orderBy(desc(agentMindNudges.at)).limit(70);
  return Object.fromEntries(TRAITS.map((t) => {
    const n = toSlider(st?.traits?.[t] ?? 0.5);
    return [t, { set: m?.set?.[t] ?? null, now: n, line: mindLine(t, n), why: why.filter((w) => w.trait === t).slice(0, 10).map((w) => ({ delta: w.delta, reason: w.reason, at: w.at.toISOString() })) }];
  })) as Record<Trait, MindValue>;
}

/** What the agent itself reads (GET /agent/me): each slider as a number and its plain line. */
export async function mindForAgent(db: Db, agentId: string): Promise<Record<Trait, { value: number; line: string }>> {
  const v = await mindView(db, agentId);
  return Object.fromEntries(TRAITS.map((t) => [t, { value: v[t].now, line: v[t].line }])) as Record<Trait, { value: number; line: string }>;
}

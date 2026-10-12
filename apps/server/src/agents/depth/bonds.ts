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

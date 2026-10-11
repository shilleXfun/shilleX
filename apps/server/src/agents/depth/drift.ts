import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents, traitHistory } from '../../db/schema.ts';
import { holdersOf } from '../../world/market.ts';
import { loadState, setTraits } from '../state.ts';
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

/** The ids among `ids` that are agents: only agents have traits. */
async function agentsAmong(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await db.select({ id: agents.userId }).from(agents).where(inArray(agents.userId, ids))).map((r) => r.id));
}

/**
 * Nudges an agent's traits; each trait moves at most DRIFT_CAP_PER_DAY in total per UTC day and stays in 0..1.
 * Writes only the traits column, so an agent's energy, mood, cooldowns and recent lines are never overwritten from here.
 */
export async function applyDrift(db: Db, agentId: string, deltas: Partial<Record<Trait, number>>, now: Date): Promise<Traits> {
  if (!(await agentsAmong(db, [agentId])).has(agentId)) throw new Error(`${agentId} is not an agent`);
  const day = utcDay(now);
  const state = await loadState(db, agentId, now); // creates the row on first use
  const [row] = await db.select().from(traitHistory).where(and(eq(traitHistory.agentId, agentId), eq(traitHistory.day, day)));
  const used: Record<string, number> = { ...(row?.drift ?? {}) };
  const traits = { ...state.traits };
  for (const [t, want] of Object.entries(deltas) as [Trait, number][]) {
    if (!Number.isFinite(want) || want === 0 || !(t in traits)) continue;
    const u = used[t] ?? 0;
    const allowed = want > 0 ? Math.min(want, DRIFT_CAP_PER_DAY - u) : Math.max(want, -DRIFT_CAP_PER_DAY - u);
    if ((want > 0 && allowed <= 0) || (want < 0 && allowed >= 0)) continue;
    const next = clamp01(traits[t] + allowed);
    used[t] = u + (next - traits[t]);
    traits[t] = next;
  }
  await setTraits(db, agentId, traits, now);
  await db.insert(traitHistory).values({ agentId, day, traits, drift: used })
    .onConflictDoUpdate({ target: [traitHistory.agentId, traitHistory.day], set: { traits, drift: used } });
  return traits;
}

/** Experiences reshape personalities: losses make agents careful, rugs make them petty, wins make them greedy. */
export const driftModule: DepthModule = {
  name: 'drift',
  async afterAct(d, v, c, r) {
    if (!r.ok) return;
    const now = d.now();
    if (c.kind === 'sell' && c.target?.mint) {
      const pos = v.wallet.positions.find((p) => p.mint === c.target!.mint);
      if (pos && pos.costLamports > 0) {
        // Same thresholds as the big_win / big_loss events act() records; this module only moves traits.
        const pnl = (pos.valueLamports - pos.costLamports) / pos.costLamports;
        if (pnl < -0.5) await applyDrift(d.db, v.agent.id, driftForEvent('big_loss'), now);
        if (pnl > 1) await applyDrift(d.db, v.agent.id, driftForEvent('big_win'), now);
      }
    }
    if (c.kind === 'rug' && c.target?.mint) {
      // act() already recorded `rugged` for the rugger and `got_rugged` for each holder.
      const holders = [...(await holdersOf(d.db, c.target.mint)).keys()].filter((h) => h !== v.agent.id);
      const isAgent = await agentsAmong(d.db, holders);
      for (const holder of holders) if (isAgent.has(holder)) await applyDrift(d.db, holder, driftForEvent('got_rugged'), now);
    }
    // Humans have no traits: only an agent on the receiving end drifts.
    const target = c.target?.userId;
    if (!target || target === v.agent.id) return;
    const welcomed = (c.kind === 'reply' || c.kind === 'react') && c.situation !== 'roast' && (v.affinity[target] ?? 0) > 0.3;
    const roasted = c.situation === 'roast';
    if (!welcomed && !roasted) return;
    if (!(await agentsAmong(d.db, [target])).has(target)) return;
    if (welcomed) await applyDrift(d.db, target, driftForEvent('welcomed'), now);
    if (roasted) await applyDrift(d.db, target, driftForEvent('roasted'), now);
  },
};

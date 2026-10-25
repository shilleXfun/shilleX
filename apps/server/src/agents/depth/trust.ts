import type { Candidate } from '../types.ts';
import { DISTRUST, TRUSTED, trustOf } from '../minds.ts';
import type { DepthModule } from './registry.ts';

/**
 * Trust in action (2026-10-25, Phase C). Liking (affinity) decides who an agent talks to; trust decides whose word and whose coin it
 * takes. It never lends to, sends SOL to or follows an agent it does not trust, calls it out more, and stays out of that agent's
 * coin; it backs the ones it trusts. Trust only moves on evidence (agents/minds.ts), so this is the consequence of what happened.
 */
export function trustWeight(c: Candidate, trust: Record<string, number>, creatorOf: (mint: string) => string | undefined): number {
  const of = (id: string | undefined) => (id ? trust[id] ?? 0 : 0);
  const them = of(c.target?.userId), creator = of(c.target?.mint ? creatorOf(c.target.mint) : undefined);
  if (them <= DISTRUST) {
    if (c.kind === 'lend' || c.kind === 'send_sol' || c.kind === 'follow') return 0.15;
    if (c.kind === 'reply') return 1.3;
  }
  if (them >= TRUSTED && (c.kind === 'lend' || c.kind === 'send_sol')) return 1.4;
  if (c.kind === 'buy' && creator <= DISTRUST) return 0.3;
  if (c.kind === 'buy' && creator >= TRUSTED) return 1.3;
  return 1;
}

export const trustModule: DepthModule = {
  name: 'trust',
  async perceive(d, v) { v.depth.trust = await trustOf(d.db, v.agent.id); },
  modify(v, cs) {
    const trust = v.depth.trust;
    if (!trust || !Object.keys(trust).length) return cs;
    const creators = new Map(v.coins.map((c) => [c.mint, c.creatorId]));
    return cs.map((c) => {
      const w = trustWeight(c, trust, (m) => creators.get(m));
      return w === 1 ? c : { ...c, score: c.score * w, reason: `trust: ${w < 1 ? 'does not believe them' : w > 1.35 ? 'believes them' : 'has been burned by them'}; ${c.reason}` };
    });
  },
};

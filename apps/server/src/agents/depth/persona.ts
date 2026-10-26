import type { AgentJob } from '@shillex/shared';
import type { ActionKind, Candidate } from '../types.ts';
import { personaOf } from '../personas.ts';
import type { DepthModule } from './registry.ts';

/**
 * Not everyone does everything (2026-10-26): an agent's job (agents/personas.ts) scales what it is inclined to do, and its voice's
 * post rate scales how much it talks. Lurkers mostly watch and react, reply guys answer far more than they post, analysts take the
 * market, whales trade and say little, and only devs launch coins. Before a persona exists the candidates pass unchanged.
 */
const TALK: ReadonlySet<ActionKind> = new Set(['post', 'reply', 'chat', 'dm']);
const JOB_WEIGHT: Record<AgentJob, Partial<Record<ActionKind, number>>> = {
  social: {},
  replyguy: { post: 0.35, reply: 2.2, react: 1.2 },
  analyst: { post: 1.1, reply: 0.7, buy: 1.2, sell: 1.2 },
  whale: { post: 0.4, reply: 0.5, buy: 1.6, sell: 1.6, chat: 0.4 },
  lurker: { post: 0.15, reply: 0.35, chat: 0.25, dm: 0.4, react: 1.3, follow: 1.2 },
  builder: { post: 0.6, reply: 0.8 },
  dev: { post: 0.9 },
};

/** The weight a job and a post rate put on one candidate; only devs launch coins. */
export function personaWeight(job: AgentJob, postRate: number, c: Candidate): number {
  if (c.kind === 'launch' && job !== 'dev') return 0;
  const base = c.kind === 'launch' ? 1.5 : JOB_WEIGHT[job][c.kind] ?? 1;
  // Market takes are what an analyst is for.
  const take = job === 'analyst' && c.kind === 'post' && c.situation === 'market_take' ? 1.8 : 1;
  return base * take * (TALK.has(c.kind) ? postRate : 1);
}

export const personaModule: DepthModule = {
  name: 'persona',
  async perceive(d, v) {
    const p = await personaOf(d.db, v.agent.id);
    if (p) v.depth.persona = { job: p.job, background: p.background, worldview: p.worldview, humor: p.humor, voice: p.voice };
  },
  modify(v, cs) {
    const p = v.depth.persona;
    return p ? cs.map((c) => ({ ...c, score: c.score * personaWeight(p.job, p.voice.postRate, c) })) : cs;
  },
};

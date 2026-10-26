import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentAffinity, agentMemories, agentPersonas, agentReactions, agentTheses, chainTxs, realMarket, realPositions, worldCoins } from '../src/db/schema.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';
import type { Chain } from '../src/world/chain.ts';
import { chainGate } from '../src/world/hybrid.ts';
import { txLeft } from '../src/world/tx-budget.ts';
import { leaderSold } from '../src/world/real-desk.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

const deps = (chain: Chain = w.chain): EngineDeps => ({ app: w.t.app, db: w.t.db, chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: () => 0.5 });
const devnet = { network: 'devnet' } as Chain;
const cands: Candidate[] = [{ kind: 'post', score: 1, reason: 'r' }, { kind: 'buy', score: 1, reason: 'r' }, { kind: 'launch', score: 1, reason: 'r' }];
const viewOf = (id: string, job: string | null): AgentView => ({ agent: { id }, hybrid: true, depth: { persona: job ? { job } : undefined } } as unknown as AgentView);
const tx = (i: number, minsAgo: number) => ({ id: `tx${i}`, signature: `sig${i}`, agentId: null, turnId: null, kind: 'buy' as const, mint: null, counterparty: null, lamportsDelta: 0, tokenDelta: 0, feeLamports: 0,
  createdAt: new Date(w.t.clock.now().getTime() - minsAgo * 60_000) });

describe('hybrid trading', () => {
  it('spends a paced hourly chain budget: a sixth per ten minutes, the cap per hour', async () => {
    expect(await txLeft(w.t.db, 60, w.t.clock.now())).toBe(10);
    await w.t.db.insert(chainTxs).values(Array.from({ length: 10 }, (_, i) => tx(i, 2)));
    w.t.clock.advance(20_000); // past the count's ten-second memo
    expect(await txLeft(w.t.db, 60, w.t.clock.now())).toBe(0);
    await w.t.db.insert(chainTxs).values(Array.from({ length: 45 }, (_, i) => tx(100 + i, 30)));
    w.t.clock.advance(11 * 60_000); // the first ten are now outside the ten-minute slice, but still inside the hour
    expect(await txLeft(w.t.db, 60, w.t.clock.now())).toBe(5);
  });

  it('lets only a dev with a launch due launch, and holds every money move when the budget is spent', async () => {
    const [dev, social] = w.agents;
    expect((await chainGate(deps(), viewOf(social!.id, 'social'), cands)).map((c) => c.kind)).toEqual(['post', 'buy']);
    expect((await chainGate(deps(), viewOf(dev!.id, 'dev'), cands)).map((c) => c.kind)).toEqual(['post', 'buy', 'launch']);
    // Its own coin from an hour ago: not again for a day.
    await w.t.db.insert(worldCoins).values({ mint: 'M1', pool: 'P1', creatorId: dev!.id, name: 'One', symbol: 'ONE', launchSignature: 's', launchedAt: new Date(w.t.clock.now().getTime() - 3_600_000) });
    expect((await chainGate(deps(), viewOf(dev!.id, 'dev'), cands)).map((c) => c.kind)).toEqual(['post', 'buy']);
    await w.t.db.insert(chainTxs).values(Array.from({ length: 10 }, (_, i) => tx(i, 1)));
    w.t.clock.advance(20_000);
    expect((await chainGate(deps(devnet), viewOf(social!.id, 'social'), cands)).map((c) => c.kind)).toEqual(['post']);
  });

  it('a copy-trader left holding the bag by the agent it copied likes and trusts it less, keeps a grudge and calls it out', async () => {
    const [leader, copier] = w.agents;
    const now = w.t.clock.now();
    await w.t.db.insert(agentPersonas).values({ agentId: copier!.id, job: 'social', background: 'b', worldview: 'w', humor: 'h', voice: { casing: 'lower', length: 'short', emoji: null, slang: [], signatures: [], neverWords: [], postRate: 1, replyBias: 0.4, humor: 'h', temper: 't', images: 'i', habit: 'h' } as never, source: 'seed', createdAt: now, updatedAt: now });
    await w.t.db.insert(realMarket).values({ address: 'ADDR', symbol: 'SABLE', name: 'Sable', pairAddress: 'P', dexId: 'raydium', url: 'u', priceUsd: 0.8, liquidityUsd: 1e6, fdvUsd: null, volumeH1: 1e5, volumeH24: 1e6,
      changeM5: 0, changeH1: -0.1, changeH24: -0.2, buysH1: 10, sellsH1: 30, pairCreatedAt: null, source: 'trending', imageUrl: null, refreshedAt: now });
    await w.t.db.insert(realPositions).values({ agentId: copier!.id, address: 'ADDR', symbol: 'SABLE', qty: 100, costUsd: 100, openedAt: now, updatedAt: now });
    await w.t.db.insert(agentTheses).values({ id: 'th1', agentId: copier!.id, market: 'real', asset: 'ADDR', symbol: 'SABLE', entryPrice: 1, targetPct: 0.3, stopPct: -0.3, horizonAt: new Date(now.getTime() + 6 * 3_600_000),
      conviction: 0.5, reason: 'following', openedAt: new Date(now.getTime() - 2 * 3_600_000), evidence: { style: 'copy', copied: leader!.id } });
    expect(await leaderSold(deps(), leader!.id, 'ADDR', 'SABLE', now)).toBe(1);
    const [tie] = await w.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, copier!.id), eq(agentAffinity.otherId, leader!.id)));
    expect(tie!.score).toBeLessThan(0);
    expect(tie!.trust).toBeLessThan(0);
    const [grudge] = await w.t.db.select().from(agentMemories).where(and(eq(agentMemories.agentId, copier!.id), eq(agentMemories.kind, 'grudge')));
    expect(grudge!.text).toMatch(/sold \$SABLE 2 h after I copied them in, leaving me at -20%/);
    const [r] = await w.t.db.select().from(agentReactions).where(eq(agentReactions.agentId, copier!.id));
    expect(r).toMatchObject({ format: 'callout', aboutId: leader!.id });
  });
});

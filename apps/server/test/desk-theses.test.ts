import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentCommitments, agentTheses, realMarket, realPositions, type RealMarketRow } from '../src/db/schema.ts';
import { invalidated, invalidationFor, workBook } from '../src/world/real-desk.ts';
import { calibration, nextStyle } from '../src/agents/depth/desk.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

const ADDR = 'So11111111111111111111111111111111111111112';
const coin = (over: Partial<RealMarketRow> = {}): RealMarketRow => ({
  address: ADDR, symbol: 'SABLE', name: 'Sable', pairAddress: 'PAIR', dexId: 'raydium', url: 'https://dexscreener.com/solana/pair', priceUsd: 1,
  liquidityUsd: 1_000_000, fdvUsd: null, volumeH1: 200_000, volumeH24: 2_000_000, changeM5: 0.01, changeH1: 0.12, changeH24: 0.2,
  buysH1: 80, sellsH1: 20, pairCreatedAt: null, source: 'trending', imageUrl: null, refreshedAt: w.t.clock.now(), ...over,
});
const traits = { risk: 0.9, chattiness: 0.5, loyalty: 0.5, pettiness: 0.1, greed: 0.2, humor: 0.5, curiosity: 0.5 };

describe('thesis-driven paper trading', () => {
  it('opens a thesis with its evidence, what would prove it wrong and why that size, then exits when it is proven wrong', async () => {
    const a = w.agents[0]!;
    const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: () => 0.01 };
    await w.t.db.insert(realMarket).values(coin());
    await workBook(d, a.id, traits, [coin()]);
    const [th] = await w.t.db.select().from(agentTheses).where(eq(agentTheses.agentId, a.id));
    expect(th).toMatchObject({ status: 'open', invalidateIf: expect.stringContaining('liquidity falls under'), sizing: expect.stringContaining('book') });
    expect(th!.evidence).toMatchObject({ liquidityUsd: 1_000_000, buysH1: 80, style: 'momentum' });
    // Announced with its stop, so the stop is a promise.
    expect((await w.t.db.select().from(agentCommitments).where(eq(agentCommitments.thesisId, th!.id)))[0]?.status).toBe('open');

    // Half the pool leaves: the thesis is broken before any stop is hit, and it gets out, keeping its word.
    w.t.clock.advance(15 * 60_000);
    await w.t.db.update(realMarket).set({ liquidityUsd: 300_000, priceUsd: 0.97 }).where(eq(realMarket.address, ADDR));
    await workBook(d, a.id, traits, []);
    const [done] = await w.t.db.select().from(agentTheses).where(eq(agentTheses.id, th!.id));
    expect(done).toMatchObject({ status: 'lost', closeReason: 'invalidated', process: 'plan' });
    expect(await w.t.db.select().from(realPositions).where(eq(realPositions.agentId, a.id))).toEqual([]);
    expect((await w.t.db.select().from(agentCommitments).where(eq(agentCommitments.thesisId, th!.id)))[0]?.status).toBe('kept');
  });

  it('checks liquidity for every style and hourly volume for momentum', () => {
    expect(invalidationFor(coin(), 'value').check).toEqual({ liquidityBelowUsd: 600_000 });
    const m = invalidationFor(coin(), 'momentum');
    expect(m.check).toEqual({ liquidityBelowUsd: 600_000, volumeH1BelowUsd: 70_000 });
    expect(invalidated({ invalidate: m.check }, coin({ volumeH1: 50_000 }))).toMatch(/hourly volume/);
    expect(invalidated({ invalidate: m.check }, coin())).toBeNull();
  });

  it('gives a style up after losing 4 of its last 6 trades in it, and not before', () => {
    const lose = { pnlPct: -0.1, evidence: { style: 'momentum' } }, win = { pnlPct: 0.2, evidence: { style: 'momentum' } };
    expect(nextStyle(traits, 'momentum', [lose, lose, lose, win, win, win]).switched).toBeNull();
    const r = nextStyle(traits, 'momentum', [lose, lose, lose, lose, win, win]);
    expect(r.switched).toEqual({ from: 'momentum', lost: 4, of: 6 });
    expect(r.style).not.toBe('momentum');
  });

  it('sizes an overconfident agent down, and does not count a lucky win', async () => {
    const a = w.agents[1]!;
    const now = w.t.clock.now();
    const row = (i: number, pnl: number, process: 'plan' | 'broke_plan' = 'plan') => ({ id: `t${i}`, agentId: a.id, market: 'real' as const, asset: `A${i}`, symbol: 'X', entryPrice: 1, targetPct: 0.4, stopPct: -0.12,
      horizonAt: now, conviction: 0.9, reason: 'r', status: pnl > 0 ? 'won' as const : 'lost' as const, openedAt: now, closedAt: now, pnlPct: pnl, exitPrice: 1 + pnl, process });
    await w.t.db.insert(agentTheses).values([row(1, -0.1), row(2, -0.1), row(3, 0.3, 'broke_plan'), row(4, -0.1)]);
    const c = await calibration(w.t.db, a.id);
    expect(c.winRate).toBe(0);
    expect(c.factor).toBeLessThan(0.5 + 1e-9);
  });
});

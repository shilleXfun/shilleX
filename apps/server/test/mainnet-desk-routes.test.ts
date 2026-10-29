import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { Indexer } from '../src/world/indexer.ts';
import { realMarket, realPositions, realTrades, solPositions, solTrades } from '../src/db/schema.ts';

/**
 * Mainnet (owner, 2026-10-28: "fake pnls"): the tape, the real coin pages and the desks show the agents' real-SOL trades and
 * holdings; the paper desk's trades, holders and plans are never served.
 */
let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

const MINT = 'So11111111111111111111111111111111111111112';

describe('desk routes on mainnet', () => {
  it('serve real-SOL trades and holders, never the paper ones', async () => {
    ctx = await depthTestCtx();
    (ctx.t.app.deps.config as { solanaNetwork: string }).solanaNetwork = 'mainnet';
    await registerDepthRoutes(ctx.t.app, { indexer: new Indexer(ctx.t.db, ctx.chain, ctx.t.clock.now, { balanceTtlMs: 0, mainnet: true }) });
    const get = async (url: string) => (await ctx.t.app.inject({ method: 'GET', url })).json();
    const now = ctx.t.clock.now();
    const [a, b] = ctx.agents;
    await ctx.t.db.insert(realMarket).values({ address: MINT, symbol: 'MEME', name: 'Meme', pairAddress: 'pair', dexId: 'raydium', url: 'https://dexscreener.com/x', priceUsd: 2, liquidityUsd: 90_000, volumeH1: 1, volumeH24: 1, changeM5: 0, changeH1: 0, changeH24: 0, buysH1: 1, sellsH1: 1, source: 'trending', refreshedAt: now });
    // Paper: a $500 buy and a held position. Real: a 0.2 SOL buy (one agent still holds), a sell 0.1 SOL up on 0.3 in, a failed one.
    await ctx.t.db.insert(realTrades).values({ id: 'p1', agentId: a!.id, address: MINT, symbol: 'MEME', side: 'buy', qty: 250, priceUsd: 2, usd: 500, feeUsd: 1, at: now });
    await ctx.t.db.insert(realPositions).values({ agentId: a!.id, address: MINT, symbol: 'MEME', qty: 250, costUsd: 500, openedAt: now, updatedAt: now });
    await ctx.t.db.insert(solPositions).values({ agentId: b!.id, mint: MINT, symbol: 'MEME', solIn: 0.2, tokens: 100, entryPriceUsd: 1, openedAt: now });
    await ctx.t.db.insert(solTrades).values([
      { id: 's1', agentId: b!.id, kind: 'buy', mint: MINT, symbol: 'MEME', sol: -0.2, by: 'agent', sig: 'sigbuy', ok: true, at: new Date(now.getTime() - 60_000) },
      { id: 's2', agentId: a!.id, kind: 'sell', mint: MINT, symbol: 'MEME', sol: 0.4, pnlSol: 0.1, by: 'agent', sig: 'sigsell', ok: true, at: now },
      { id: 's3', agentId: a!.id, kind: 'buy', mint: MINT, symbol: 'MEME', sol: 0, by: 'agent', ok: false, error: 'slippage', at: now },
    ]);

    const tape = (await get('/api/real/trades')).trades;
    expect(tape.map((t: { id: string }) => t.id)).toEqual(['s2', 's1']);
    expect(tape[0]).toMatchObject({ side: 'sell', sol: 0.4, sig: 'sigsell', usd: 0 });
    expect(tape[0].pnlPct).toBeCloseTo(0.1 / 0.3);
    expect(tape[1]).toMatchObject({ side: 'buy', sol: 0.2, pnlPct: null });

    expect((await get('/api/real/market')).coins[0]).toMatchObject({ address: MINT, holders: 1 });
    const page = await get(`/api/real/coins/${MINT}`);
    expect(page.coin.holders).toBe(1);
    expect(page.holders).toHaveLength(1);
    expect(page.holders[0]).toMatchObject({ agent: { id: b!.id }, qty: 100, costUsd: 100, valueUsd: 200, pnlPct: 1 });
    expect(page.trades.map((t: { id: string }) => t.id)).toEqual(['s2', 's1']);
    expect(page.theses).toEqual([]);

    expect((await get('/api/theses/latest')).items).toEqual([]);
    expect(await get(`/api/agents/${a!.username}/desk`)).toMatchObject({ theses: [], realBook: null });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { wallets } from '../src/db/schema.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let idx: Indexer; let mint = '';
beforeAll(async () => {
  w = await worldTestCtx();
  // the helper airdropped 0.1 SOL into the MemoryChain directly; mark wallets funded so P&L has its baseline
  await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() });
  const A = w.agents[0]!, B = w.agents[1]!;
  mint = ((await runTool(await w.ctxFor(A), 'launch_coin', { name: 'Rug', symbol: 'RUG', description: '', emoji: '🧶', initial_buy_sol: 0.03 })).result as { mint: string }).mint;
  await runTool(await w.ctxFor(B), 'buy', { mint, sol: 0.02, slippage_pct: null });
  await runTool(await w.ctxFor(A), 'sell', { mint, tokens: null, all: true, slippage_pct: 50 });
  idx = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
});
afterAll(() => w.t.close());

describe('Indexer', () => {
  it('builds coin views with dev-sold percent, holders and volume', async () => {
    const c = (await idx.coin(mint))!;
    expect(c).toMatchObject({ symbol: 'RUG', holders: 1, graduated: false });
    expect(c.devSoldPct).toBeCloseTo(100);
    expect(c.volume24hSol).toBeGreaterThan(0.05);
    expect(c.marketCapSol).toBeGreaterThan(0);
    expect((await idx.coins()).map((x) => x.mint)).toEqual([mint]);
  });
  it('lists trades newest first with agents attached', async () => {
    const t = await idx.trades({ mint });
    expect(t.map((x) => x.kind)).toEqual(['sell', 'buy', 'launch']);
    expect(t[0]!.agent?.id).toBe(w.agents[0]!.id);
  });
  it('ranks the leaderboard by total SOL and counts the rug', async () => {
    const board = await idx.leaderboard();
    expect(board).toHaveLength(50);
    expect(board[0]!.totalSol).toBeGreaterThanOrEqual(board[49]!.totalSol);
    const creator = board.find((a) => a.user.id === w.agents[0]!.id)!;
    expect(creator).toMatchObject({ coinsLaunched: 1, rugs: 1 });
    const buyer = board.find((a) => a.user.id === w.agents[1]!.id)!;
    expect(buyer.tokenValueSol).toBeGreaterThan(0);
    expect(buyer.pnlSol).toBeCloseTo(buyer.totalSol - 0.1, 6);
  });
  it('builds an agent detail with positions and chain head', async () => {
    const d = (await idx.agent(w.agents[1]!.id))!;
    expect(d.positions).toMatchObject([{ mint, symbol: 'RUG' }]);
    expect(d.chainHead.count).toBeGreaterThan(0);
  });
});

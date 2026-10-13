import { describe, it, expect, afterEach } from 'vitest';
import { inArray } from 'drizzle-orm';
import { ledgerCtx } from './ledger-helpers.ts';
import { testDb } from './helpers.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { loadConfig } from '../src/config.ts';
import { makeChain } from '../src/world/devnet-chain.ts';
import { LedgerChain } from '../src/ledger/ledger-chain.ts';
import { DEVNET_RUG_RULE, LEDGER_RUG_RULE, RUG_RULE, setRugRule } from '../src/ledger/rug-rule.ts';
import { RAW_PER_TOKEN } from '../src/world/chain.ts';
import { candidates } from '../src/agents/decide.ts';
import { engineTurn } from '../src/agents/engine.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { rugSales } from '../src/agents/overview.ts';
import { runTool } from '../src/world/tools.ts';
import { recordTx } from '../src/world/ledger.ts';
import { Indexer } from '../src/world/indexer.ts';
import { ledgerJournal } from '../src/db/schema.ts';
import type { AgentView } from '../src/agents/types.ts';

const SOL = 1e9, NOW = '2026-10-12T12:00:00.000Z';
const limits = { launchCostLamports: 10_000_000, rugMinShare: 0.25, maxCreatorSaleShare: 0.3, maxTradeLamports: 50_000_000, maxSendLamports: 10_000_000, frozen: false };
function view(over: Partial<AgentView> = {}): AgentView {
  return {
    agent: { id: 'me', username: 'me', displayName: 'Me' },
    state: { energy: 1, mood: 0, traits: { risk: 1, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.9, humor: 0.5, curiosity: 0.5 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null },
    phrasebook: fallbackPhrasebook('me'), wallet: { lamports: 1 * SOL, positions: [] },
    coins: [], mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: NOW, depth: emptyDepth(), limits, ...over,
  };
}
const hot = { mint: 'HOT', symbol: 'HOT', creatorId: 'maker', priceLamports: 2, change10m: 0.4, change1h: 0.6, holders: 6, graduated: false, launchedAt: NOW };
let close: (() => Promise<void>) | null = null;
afterEach(async () => { setRugRule(DEVNET_RUG_RULE); await close?.(); close = null; });

describe('makeChain', () => {
  it('builds a LedgerChain with the config’s rules for WORLD_CHAIN=ledger', async () => {
    const h = await testDb(); close = () => h.close();
    const chain = await makeChain(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'ledger', MAINNET_HOUSE_FEE_BPS: '0' }), h.db);
    expect(chain).toBeInstanceOf(LedgerChain);
    expect((chain as LedgerChain).rules.houseFeeBps).toBe(0);
    expect(chain.limits?.frozen).toBe(false);
  });
});

describe('decide within the chain’s limits', () => {
  it('never sizes a buy above the trade cap', () => {
    for (let s = 0; s < 40; s++) for (const c of candidates(view({ coins: [hot] }), mulberry32(s)).filter((x) => x.kind === 'buy')) expect(c.lamports!).toBeLessThanOrEqual(limits.maxTradeLamports);
  });
  it('rugs 25–30% of the bag, never the locked part', () => {
    const mine = { ...hot, mint: 'MINE', creatorId: 'me' };
    const pos = { mint: 'MINE', symbol: 'MINE', raw: 1_000_000_000, costLamports: 10_000_000, valueLamports: 30_000_000, createdByMe: true, creatorId: 'me' };
    const [r] = candidates(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [pos] } }), mulberry32(1)).filter((c) => c.kind === 'rug');
    expect(r!.raw!).toBeGreaterThanOrEqual(0.25 * pos.raw);
    expect(r!.raw!).toBeLessThanOrEqual(0.3 * pos.raw);
    const locked = { ...pos, lockedRaw: pos.raw - RAW_PER_TOKEN / 2 };
    expect(candidates(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [locked] } }), mulberry32(1)).filter((c) => c.kind === 'rug')).toEqual([]);
  });
  it('plans a launch around the ledger’s launch fee and caps its first buy', () => {
    const [l] = candidates(view({ wallet: { lamports: 400_000_000, positions: [] } }), mulberry32(3)).filter((c) => c.kind === 'launch');
    expect(l!.lamports!).toBeLessThanOrEqual(limits.maxTradeLamports);
  });
});

describe('a ledger world', () => {
  it('runs talk-only while the books are frozen', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    for (let i = 0; i < 50; i++) await c.fund(i, 0.1);
    await c.chain.freeze('test');
    for (let i = 0; i < 120; i++) { await engineTurn(c.d); c.t.clock.advance(4000); }
    expect(await c.t.db.select().from(ledgerJournal).where(inArray(ledgerJournal.kind, ['buy', 'sell', 'launch_fee', 'send']))).toEqual([]);
  });
  it('counts a 25% creator sale as a rug on the ledger, not on devnet', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await c.fund(0, 0.2);
    const ctx = { ...(await c.ctxFor(c.agents[0]!)), chain: c.chain };
    const l = await runTool(ctx, 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', initial_buy_sol: 0.04 });
    const mint = (l.result as { mint: string }).mint;
    c.t.clock.advance(25 * 3_600_000);
    const held = (await c.chain.balances(await c.pk(0))).tokens[0]!.raw;
    expect((await runTool({ ...(await c.ctxFor(c.agents[0]!)), chain: c.chain }, 'sell', { mint, tokens: (held * 0.26) / RAW_PER_TOKEN, all: false, slippage_pct: null })).ok).toBe(true);
    const since = new Date(c.t.clock.now().getTime() - 3_600_000);
    expect(await rugSales(c.t.db, since)).toEqual([]);
    setRugRule(LEDGER_RUG_RULE);
    expect((await rugSales(c.t.db, since)).length).toBe(1);
    expect(RUG_RULE.saleShare).toBe(0.25);
  });
  it('measures P&L against deposits and openings, not a flat 0.1 SOL', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await c.fund(0, 0.3);
    await recordTx(c.t.db, { signature: 'dep1', agentId: c.agents[0]!.id, turnId: null, kind: 'deposit', lamportsDelta: 0.3 * SOL, createdAt: c.t.clock.now() });
    const card = (await new Indexer(c.t.db, c.chain, c.t.clock.now, { balanceTtlMs: 0, viewTtlMs: 0 }).leaderboard()).find((x) => x.user.id === c.agents[0]!.id)!;
    expect(card.pnlSol).toBeCloseTo(0, 9);
  });
});

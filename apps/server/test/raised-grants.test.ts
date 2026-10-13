import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { SOL, raisedTestCtx } from './raised-helpers.ts';
import { agentGrants, chainTxs, wallets } from '../src/db/schema.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { Indexer } from '../src/world/indexer.ts';
import { GrantRefused, START_GRANT, TOP_UP, canGrant, grantsOf, sendGrant, topUpStatus, type GrantDeps } from '../src/agents/raised/grants.ts';

let w: Awaited<ReturnType<typeof raisedTestCtx>>;
afterEach(() => w.t.close());
const deps = (dailyLimitSol = 3): GrantDeps => ({ db: w.t.db, chain: w.chain, key: w.key, now: w.t.clock.now, dailyLimitSol });
const balance = async (ownerId: string) => (await w.chain.balances((await walletOf(w.t.db, ownerId))!.publicKey)).lamports;
const refusedWith = async (p: Promise<unknown>, code: string) => { const e = await p.catch((x) => x); expect(e).toBeInstanceOf(GrantRefused); expect((e as GrantRefused).code).toBe(code); };

describe('grants', () => {
  it('a start grant sends 0.1 SOL, records a fund row and a grant row, and marks the wallet funded (once)', async () => {
    w = await raisedTestCtx();
    const a = w.agents[0]!;
    const before = await balance(a.id);
    const g = await sendGrant(deps(), a.id, 'start');
    expect(g.lamports).toBe(START_GRANT);
    expect(await balance(a.id)).toBe(before + START_GRANT);
    expect(await w.t.db.select().from(chainTxs).where(and(eq(chainTxs.agentId, a.id), eq(chainTxs.kind, 'fund')))).toHaveLength(1);
    expect((await w.t.db.select().from(wallets).where(eq(wallets.ownerId, a.id)))[0]!.fundedAt).not.toBeNull();
    const again = await sendGrant(deps(), a.id, 'start');
    expect(again.signature).toBe(g.signature);
    expect(await grantsOf(w.t.db, a.id)).toEqual([{ kind: 'start', sol: 0.1, signature: g.signature, createdAt: w.t.clock.now().toISOString() }]);
  });

  it('a top-up is 0.05 SOL once per UTC day, up to 0.3 SOL in all', async () => {
    w = await raisedTestCtx();
    const a = w.agents[0]!;
    await sendGrant(deps(), a.id, 'top_up');
    await refusedWith(sendGrant(deps(), a.id, 'top_up'), 'TOP_UP_TODAY');
    expect(await topUpStatus(deps(), a.id)).toMatchObject({ availableToday: false, remainingSol: 0.25 });
    for (let i = 0; i < 5; i++) { w.t.clock.advance(24 * 3600_000); await sendGrant(deps(), a.id, 'top_up'); }
    w.t.clock.advance(24 * 3600_000);
    await refusedWith(sendGrant(deps(), a.id, 'top_up'), 'TOP_UPS_MAX');
    expect(await topUpStatus(deps(), a.id)).toMatchObject({ availableToday: false, remainingSol: 0 });
    expect((await w.t.db.select().from(agentGrants).where(eq(agentGrants.agentId, a.id))).length).toBe(6);
  });

  it('stops at the daily limit across all raised agents', async () => {
    w = await raisedTestCtx();
    await sendGrant(deps(0.15), w.agents[0]!.id, 'start');
    await sendGrant(deps(0.15), w.agents[1]!.id, 'top_up');
    await refusedWith(sendGrant(deps(0.15), w.agents[2]!.id, 'top_up'), 'GRANTS_DAILY');
  });

  it('pauses while the treasury would drop below 1 SOL', async () => {
    w = await raisedTestCtx({ treasurySol: 1.05 });
    expect(await canGrant(deps(), '', 'start')).toBe(false);
    await refusedWith(sendGrant(deps(), w.agents[0]!.id, 'start'), 'TREASURY_LOW');
    w.chain.airdrop((await walletOf(w.t.db, TREASURY))!.publicKey, SOL);
    expect(await canGrant(deps(), '', 'start')).toBe(true);
  });

  it('P&L leaves top-ups out: free SOL is not a trading gain', async () => {
    w = await raisedTestCtx();
    const a = w.agents[0]!;
    // The seeded wallets already hold 0.1 (the memory chain's airdrop); mark them funded as a real start would.
    await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() });
    await sendGrant(deps(), a.id, 'top_up');
    const card = (await new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0, viewTtlMs: 0 }).leaderboard()).find((c) => c.user.id === a.id)!;
    expect(card.totalSol).toBeCloseTo(0.15);
    expect(card.pnlSol).toBeCloseTo(0);
    expect(TOP_UP).toBe(50_000_000);
  });

  it('the owner panel’s top-up status reads the treasury at most every 30 s, and a failed read is a soft "unavailable"', async () => {
    w = await raisedTestCtx();
    const a = w.agents[0]!;
    const treasury = (await walletOf(w.t.db, TREASURY))!.publicKey;
    const real = w.chain.balances.bind(w.chain);
    let reads = 0, down = false;
    w.chain.balances = (async (pk: string) => { if (pk === treasury) { reads++; if (down) throw new Error('rpc down'); } return real(pk); }) as typeof w.chain.balances;
    await topUpStatus(deps(), a.id);
    await topUpStatus(deps(), a.id);
    expect(reads).toBe(1);
    w.t.clock.advance(31_000);
    down = true;
    expect(await topUpStatus(deps(), a.id)).toMatchObject({ availableToday: false, remainingSol: 0.3, reason: expect.stringMatching(/try again/) });
    // A grant itself always reads the treasury fresh.
    await refusedWith(sendGrant(deps(), a.id, 'top_up'), 'TREASURY_UNREADABLE');
  });
});

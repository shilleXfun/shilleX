import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { lifeStep, lendAmount, lifeModule, BROKE_LAMPORTS, GHOST_AFTER_MS, DEFAULT_AFTER_MS } from '../src/agents/depth/life.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { loadState, recentEvents, saveState } from '../src/agents/state.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity, agentState, debts } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const base = { energy: 1, mood: 0, traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.8, pettiness: 0.2, greed: 0.5, humor: 0.5, curiosity: 0.5 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null };
const phrasebook = { voice: '', traits: {}, lines: {}, openers: [], closers: [], memeCaptions: [], interests: [] };

describe('life', () => {
  it('goes broke below 0.01 SOL, becomes a ghost after 24 h broke, and is revived at ≥ 0.02 SOL', () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const broke = lifeStep(base, BROKE_LAMPORTS - 1, t0);
    expect(broke.event).toBe('broke');
    expect(lifeStep(broke.state, 5_000_000, new Date(t0.getTime() + GHOST_AFTER_MS - 1)).event).toBeNull();
    const ghost = lifeStep(broke.state, 5_000_000, new Date(t0.getTime() + GHOST_AFTER_MS));
    expect(ghost).toMatchObject({ event: 'ghost', state: { ghostSince: expect.any(String) } });
    expect(lifeStep(ghost.state, 15_000_000, t0).event).toBeNull();
    expect(lifeStep(ghost.state, 20_000_000, t0)).toMatchObject({ event: 'revived', state: { brokeSince: null, ghostSince: null } });
  });
  it('lends at most 0.02 SOL and never below the lender’s reserve', () => {
    expect(lendAmount(1_000_000_000)).toBe(20_000_000);
    expect(lendAmount(50_000_000)).toBe(8_000_000);
  });
  it('lets a ghost only haunt', () => {
    const v = { state: { ...base, ghostSince: '2026-10-09T00:00:00.000Z' }, depth: emptyDepth() } as unknown as AgentView;
    const cs: Candidate[] = [
      { kind: 'buy', score: 1, reason: 'r' }, { kind: 'post', score: 1, reason: 'r', situation: 'gm' },
      { kind: 'post', score: 1, reason: 'r', situation: 'ghost' }, { kind: 'idle', score: 1, reason: 'r' },
    ];
    expect(lifeModule.modify!(v, cs).map((c) => c.score)).toEqual([0, 0, 1, 1]);
  });
  it('lends to a broke friend through the chain and records the debt; repayment clears it', async () => {
    ctx = await depthTestCtx();
    const lender = ctx.agents[0]!, borrower = ctx.agents[1]!;
    const v = { agent: { id: lender.id, username: lender.username }, state: base, wallet: { lamports: 100_000_000, positions: [] }, affinity: { [borrower.id]: 0.8 },
      phrasebook: { voice: '', traits: {}, lines: {}, openers: [], closers: [], memeCaptions: [], interests: [] },
      depth: { ...emptyDepth(), begging: [{ userId: borrower.id, ghost: false }] }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const lend = lifeModule.candidates!(v, () => 0.5).find((c) => c.kind === 'lend')!;
    expect(lend).toMatchObject({ target: { userId: borrower.id }, lamports: 18_000_000 });
    const tctx = await ctx.ctxFor(lender);
    expect(await lifeModule.execute!(ctx.d, v, lend, (n, i) => runTool(tctx, n, i))).toMatchObject({ ok: true });
    const [debt] = await ctx.t.db.select().from(debts).where(eq(debts.borrowerId, borrower.id));
    expect(debt).toMatchObject({ lenderId: lender.id, lamports: 18_000_000, repaidAt: null });
    const bv = { agent: { id: borrower.id, username: borrower.username }, state: base, wallet: { lamports: 200_000_000, positions: [] }, affinity: {},
      depth: { ...emptyDepth(), debts: { owedToMe: [], iOwe: [{ id: debt!.id, lenderId: lender.id, lamports: 18_000_000, createdAt: debt!.createdAt.toISOString() }] } }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const repay = lifeModule.candidates!(bv, () => 0.5).find((c) => c.kind === 'repay')!;
    const bctx = await ctx.ctxFor(borrower);
    expect(await lifeModule.execute!(ctx.d, bv, repay, (n, i) => runTool(bctx, n, i))).toMatchObject({ ok: true });
    const [after] = await ctx.t.db.select().from(debts).where(eq(debts.id, debt!.id));
    expect(after!.repaidAt).not.toBeNull();
  });
  it('defaults unpaid debts after 72 h and the lender holds a grudge', async () => {
    ctx = await depthTestCtx();
    const lender = ctx.agents[0]!, borrower = ctx.agents[1]!;
    await ctx.t.db.insert(debts).values({ id: newId(), lenderId: lender.id, borrowerId: borrower.id, lamports: 10_000_000, signature: 's', createdAt: ctx.t.clock.now() });
    ctx.t.clock.advance(DEFAULT_AFTER_MS + 1);
    await lifeModule.sweep!(ctx.d);
    const [d] = await ctx.t.db.select().from(debts).where(eq(debts.borrowerId, borrower.id));
    expect(d!.defaultedAt).not.toBeNull();
    const [a] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, lender.id), eq(agentAffinity.otherId, borrower.id)));
    expect(a!.score).toBeCloseTo(-0.5);
  });

  it('does not lend again to a friend who still owes, and adds no ghost post of its own', () => {
    const v = { agent: { id: 'me', username: 'me' }, state: base, wallet: { lamports: 100_000_000, positions: [] }, affinity: { a: 0.8, b: 0.8 },
      depth: { ...emptyDepth(), begging: [{ userId: 'a', ghost: false }, { userId: 'b', ghost: false }],
        debts: { owedToMe: [{ id: 'd1', borrowerId: 'a', lamports: 5_000_000, createdAt: '2026-10-09T00:00:00.000Z' }], iOwe: [] } } } as unknown as AgentView;
    expect(lifeModule.candidates!(v, () => 0.5).filter((c) => c.kind === 'lend').map((c) => c.target?.userId)).toEqual(['b']);
    const ghost = { ...v, state: { ...base, brokeSince: '2026-10-08T00:00:00.000Z', ghostSince: '2026-10-09T00:00:00.000Z' } } as AgentView;
    expect(lifeModule.candidates!(ghost, () => 0.5)).toEqual([]);
  });
  it('perceive records going broke and becoming a ghost, and wakes a funded ghost without recording a revival', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[2]!;
    const now = ctx.t.clock.now();
    const view = (state: AgentView['state'], lamports: number) => ({ agent: { id: me.id, username: me.username }, state, wallet: { lamports, positions: [] }, affinity: {}, phrasebook, depth: emptyDepth(), now: ctx!.t.clock.now().toISOString() }) as unknown as AgentView;
    const v = view(await loadState(ctx.t.db, me.id, now), 5_000_000);
    await lifeModule.perceive!(ctx.d, v);
    expect(v.state.brokeSince).toBe(now.toISOString());
    expect((await loadState(ctx.t.db, me.id, ctx.t.clock.now())).brokeSince).toBe(now.toISOString());
    ctx.t.clock.advance(GHOST_AFTER_MS);
    const g = view(await loadState(ctx.t.db, me.id, ctx.t.clock.now()), 5_000_000);
    await lifeModule.perceive!(ctx.d, g);
    expect(g.state.ghostSince).not.toBeNull();
    const w = view(await loadState(ctx.t.db, me.id, ctx.t.clock.now()), 25_000_000);
    await lifeModule.perceive!(ctx.d, w);
    expect(w.state).toMatchObject({ brokeSince: null, ghostSince: null });
    const [row] = await ctx.t.db.select().from(agentState).where(eq(agentState.agentId, me.id));
    expect(row).toMatchObject({ brokeSince: null, ghostSince: null });
    expect((await recentEvents(ctx.t.db, me.id)).map((e) => e.kind).reverse()).toEqual(['broke', 'ghost']);
  });
  it('a broke agent who recovers is cleared too', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[3]!;
    const v = { agent: { id: me.id, username: me.username }, state: { ...base, brokeSince: '2026-10-09T00:00:00.000Z' }, wallet: { lamports: 30_000_000, positions: [] }, affinity: {}, phrasebook, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await lifeModule.perceive!(ctx.d, v);
    expect(v.state.brokeSince).toBeNull();
    expect((await recentEvents(ctx.t.db, me.id)).map((e) => e.kind)).toEqual([]);
  });
  it('reviving a ghost friend sends 0.02 SOL and records the revival once, with who did it', async () => {
    ctx = await depthTestCtx();
    const saviour = ctx.agents[0]!, ghost = ctx.agents[1]!;
    const haunting = new Date(ctx.t.clock.now().getTime() - 60_000).toISOString();
    await saveState(ctx.t.db, ghost.id, { ...(await loadState(ctx.t.db, ghost.id, ctx.t.clock.now())), brokeSince: haunting, ghostSince: haunting }, ctx.t.clock.now());
    const v ={ agent: { id: saviour.id, username: saviour.username }, state: base, wallet: { lamports: 100_000_000, positions: [] }, affinity: { [ghost.id]: 0.9 }, phrasebook,
      depth: { ...emptyDepth(), begging: [{ userId: ghost.id, ghost: true }] }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const revive = lifeModule.candidates!(v, () => 0.5).find((c) => c.kind === 'revive')!;
    expect(revive).toMatchObject({ target: { userId: ghost.id }, lamports: 20_000_000 });
    const sctx = await ctx.ctxFor(saviour);
    const sent: string[] = [];
    expect(await lifeModule.execute!(ctx.d, v, revive, async (n, i) => { sent.push(n); return runTool(sctx, n, i); })).toEqual({ ok: true });
    expect(sent).toEqual(['send_sol']);
    const events = await recentEvents(ctx.t.db, ghost.id);
    expect(events.filter((e) => e.kind === 'revived')).toEqual([expect.objectContaining({ data: { byId: saviour.id } })]);
    const [a] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, ghost.id), eq(agentAffinity.otherId, saviour.id)));
    expect(a!.score).toBeCloseTo(0.5);
    // A ghost already paid for is not paid for again before it wakes.
    expect(await lifeModule.execute!(ctx.d, v, revive, async (n, i) => { sent.push(n); return runTool(sctx, n, i); })).toMatchObject({ ok: false, error: 'Already revived' });
    expect(sent).toEqual(['send_sol']);
  });
  it('never sends SOL the sender cannot spare above the reserve', async () => {
    ctx = await depthTestCtx();
    const lender = ctx.agents[0]!, borrower = ctx.agents[1]!;
    const v = { agent: { id: lender.id, username: lender.username }, state: base, wallet: { lamports: 25_000_000, positions: [] }, affinity: {}, phrasebook, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const calls: string[] = [];
    const r = await lifeModule.execute!(ctx.d, v, { kind: 'lend', score: 1, reason: 'r', target: { userId: borrower.id }, lamports: 20_000_000 }, async (n) => { calls.push(n); return { ok: true, write: true, result: { signature: 'x' } }; });
    expect(r).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(await ctx.t.db.select().from(debts)).toEqual([]);
  });
});

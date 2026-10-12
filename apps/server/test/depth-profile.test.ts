import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { users } from '../src/db/schema.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { runTool } from '../src/world/tools.ts';
import { setTraits } from '../src/agents/state.ts';
import { NAMES_PER_SWEEP, localProfile, nameBlankAgents } from '../src/agents/depth/profile.ts';
import type { Traits } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const traits = (t: Partial<Traits>): Traits => ({ risk: 0.3, chattiness: 0.3, loyalty: 0.3, pettiness: 0.3, greed: 0.3, humor: 0.3, curiosity: 0.3, ...t });

describe('agents name themselves without the model (L7)', () => {
  it('builds a name from the coins it made or trades and its strongest traits, never one already taken', () => {
    const tr = traits({ risk: 0.9, pettiness: 0.7 });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: ['MOTH', 'RUST'] })).toEqual({ display_name: 'lamp degen', bio: 'made $LAMP · trades $MOTH $RUST' });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: [] }, new Set(['lamp degen'])).display_name).toBe('lamp hater');
    expect(localProfile({ traits: tr, made: [], traded: ['MOTH'] }, new Set(['moth degen', 'moth hater'])).display_name).toBe('degen');
  });
  it('stays unique and within 40 characters when every option is taken or the coin is long', () => {
    const tr = traits({ risk: 0.9, pettiness: 0.7 });
    const taken = new Set(['lamp degen', 'lamp hater', 'degen', 'hater']);
    const p = localProfile({ traits: tr, made: ['LAMP'], traded: [] }, taken);
    expect(taken.has(p.display_name)).toBe(false);
    expect(p.display_name.length).toBeLessThanOrEqual(40);
    expect(localProfile({ traits: tr, made: ['ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ'], traded: [] }).display_name.length).toBeLessThanOrEqual(40);
  });
  it('names blank agents that made or bought a coin, five per sweep, each differently, and leaves the rest alone', async () => {
    ctx = await depthTestCtx();
    const c = ctx;
    const sealed = async (i: number) => {
      const t = await c.ctxFor(c.agents[i]!);
      await finishTurn(c.t.db, t.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: c.t.clock.now() });
      return t;
    };
    await setTraits(c.t.db, c.agents[0]!.id, traits({ risk: 0.9 }), c.t.clock.now());
    const l = await runTool(await sealed(0), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (let i = 1; i <= 7; i++) await runTool(await sealed(i), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await c.t.db.update(users).set({ displayName: 'Already Named' }).where(eq(users.id, c.agents[7]!.id));
    expect(await nameBlankAgents(c.d)).toBe(NAMES_PER_SWEEP);
    expect(await nameBlankAgents(c.d)).toBe(2); // seven blank agents with a record: five, then two
    expect(await nameBlankAgents(c.d)).toBe(0);
    const rows = await Promise.all(c.agents.slice(0, 9).map(async (a) => (await c.t.db.select().from(users).where(eq(users.id, a.id)))[0]!));
    expect(rows[0]).toMatchObject({ displayName: 'lamp degen', bio: 'made $LAMP' });
    expect(new Set(rows.slice(0, 7).map((u) => u.displayName)).size).toBe(7);
    expect(rows[7]!.displayName).toBe('Already Named');
    expect(rows[8]!.displayName).toBe(''); // nothing to its name yet
  });
});

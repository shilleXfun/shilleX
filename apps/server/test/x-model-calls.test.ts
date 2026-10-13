import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { worldModelCalls } from '../src/db/schema.ts';
import { billedCall, modelBudget } from '../src/agents/haiku.ts';
import { fakeReply } from '../src/world/brain.ts';
import { newId } from '../src/lib/ids.ts';

async function worldCall(t: Awaited<ReturnType<typeof makeTestApp>>) {
  const id = newId();
  await t.db.insert(worldModelCalls).values({ id, purpose: 'x_digest', status: 'running', startedAt: t.clock.now() });
  return id;
}
const costOf = async (t: Awaited<ReturnType<typeof makeTestApp>>, id: string) => (await t.db.select().from(worldModelCalls).where(eq(worldModelCalls.id, id)))[0]!.costUsd;

describe('world model calls (x-feed §4: the digest belongs to no agent)', () => {
  it('books the worst case on the row before the call and settles it to the real price after', async () => {
    const t = await makeTestApp();
    try {
      const budget = modelBudget(t.db, 1, t.clock.now);
      const id = await worldCall(t);
      const spent = { usd: 0 };
      let during = -1;
      await billedCall({ db: t.db, budget, worldCallId: id, worstUsd: 0.5, spent }, async () => { during = await costOf(t, id); return fakeReply.end('{}'); });
      expect(during).toBe(0.5);
      expect(spent.usd).toBeGreaterThan(0);
      expect(await costOf(t, id)).toBeCloseTo(spent.usd, 10);
      expect(budget.spentToday()).toBeCloseTo(spent.usd, 10);
    } finally { await t.close(); }
  });
  it('an error the API answered costs nothing; a network failure keeps the worst case', async () => {
    const t = await makeTestApp();
    try {
      const budget = modelBudget(t.db, 1, t.clock.now);
      const a = await worldCall(t), b = await worldCall(t);
      const overloaded = Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, new Headers());
      await expect(billedCall({ db: t.db, budget, worldCallId: a, worstUsd: 0.2, spent: { usd: 0 } }, async () => { throw overloaded; })).rejects.toBe(overloaded);
      expect(await costOf(t, a)).toBe(0);
      await expect(billedCall({ db: t.db, budget, worldCallId: b, worstUsd: 0.2, spent: { usd: 0 } }, async () => { throw new Anthropic.APIConnectionError({ message: 'socket hang up' }); })).rejects.toThrow();
      expect(await costOf(t, b)).toBe(0.2);
      expect(budget.spentToday()).toBeCloseTo(0.2, 10);
    } finally { await t.close(); }
  });
  it('Budget.load() counts world calls next to agent turns, so the cap survives a restart', async () => {
    const t = await makeTestApp();
    try {
      await t.db.insert(worldModelCalls).values([
        { id: newId(), purpose: 'x_digest', costUsd: 0.3, status: 'done', startedAt: t.clock.now() },
        { id: newId(), purpose: 'x_digest', costUsd: 0.4, status: 'aborted', startedAt: new Date(t.clock.now().getTime() - 86_400_000) }, // yesterday
      ]);
      const budget = modelBudget(t.db, 1, t.clock.now);
      await budget.load();
      expect(budget.spentToday()).toBeCloseTo(0.3, 10);
    } finally { await t.close(); }
  });
});

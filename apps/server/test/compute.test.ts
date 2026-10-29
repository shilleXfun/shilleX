import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentCalls, agentCompute, agentPersonas, agents, computeLedger, posts, users } from '../src/db/schema.ts';
import { EARN, NoCompute, SAVE_DAYS, chargeCompute, computeGate, earn, earnPass, giveCompute, setComputeOn, topUp } from '../src/agents/compute.ts';

const voice = { casing: 'lower', length: 'short', emoji: null, slang: [], signatures: [], neverWords: [], postRate: 1, replyBias: 0.4, humor: 'h', temper: 't', images: 'i', habit: 'h' } as never;
afterEach(() => setComputeOn(false));

async function world() {
  const h = await testDb();
  const now = new Date('2026-10-27T01:00:00Z');
  for (const [id, job] of [['b', 'builder'], ['s', 'social'], ['l', 'lurker']] as const) {
    await h.db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
    await h.db.insert(agents).values({ userId: id, status: 'active', origin: 'wild', createdAt: now });
    await h.db.insert(agentPersonas).values({ agentId: id, job, background: 'b', worldview: 'w', humor: 'h', voice, source: 'seed', createdAt: now, updatedAt: now });
  }
  setComputeOn(true);
  return { h, db: h.db, now };
}
const row = async (db: Awaited<ReturnType<typeof world>>['db'], id: string) => (await db.select().from(agentCompute).where(eq(agentCompute.agentId, id)))[0]!;

describe('the compute economy', () => {
  it('splits the day by job, tops up once a day and keeps at most three days', async () => {
    const { h, db, now } = await world();
    expect(await topUp(db, now, 3.5)).toBe(3);
    // $3.50 = 35,000 credits over weights 2 + 1 + 0.5.
    expect((await row(db, 'b')).allowance).toBe(20_000);
    expect((await row(db, 's')).balance).toBe(10_000);
    expect((await row(db, 'l')).allowance).toBe(5_000);
    expect(await topUp(db, now, 3.5)).toBe(0); // same day
    // The owner raises the allowance mid-day: the difference arrives at once, not at midnight.
    expect(await topUp(db, now, 7)).toBe(3);
    expect(await row(db, 's')).toMatchObject({ allowance: 20_000, balance: 20_000 });
    await topUp(db, now, 3.5);
    for (let d = 1; d <= 4; d++) await topUp(db, new Date(now.getTime() + d * 86_400_000), 3.5);
    expect((await row(db, 's')).balance).toBe(SAVE_DAYS * 10_000);
    await h.close();
  });

  it('charges a call to its agents by job, and refuses the next call once they are out', async () => {
    const { h, db, now } = await world();
    await topUp(db, now, 0.0003); // a social agent gets 1 credit
    await computeGate(db, ['s']);
    await chargeCompute(db, ['s'], 0.0004, 'voice', now);
    expect(await row(db, 's')).toMatchObject({ balance: -3, spentToday: 4, spentByJob: { voice: 4 } });
    await expect(computeGate(db, ['s'])).rejects.toBeInstanceOf(NoCompute);
    // A cast where one still has compute goes ahead; the cost is split between them.
    await computeGate(db, ['s', 'b']);
    await chargeCompute(db, ['s', 'b'], 0.001, 'scene', now);
    expect((await row(db, 'b')).spentByJob).toEqual({ scene: 5 });
    await h.close();
  });

  it('earns within a day\'s cap, gives within half the allowance, and pays for replies and calls that came true', async () => {
    const { h, db, now } = await world();
    await topUp(db, now, 3.5);
    expect(await earn(db, 'l', 4_000, 'earn:views', 'x', now)).toBe(4_000);
    expect(await earn(db, 'l', 4_000, 'earn:views', 'x', now)).toBe(1_000); // cap: its allowance, 5,000
    expect(await giveCompute(db, 's', 'l', 9_000, now)).toEqual({ ok: true, given: 5_000 }); // half of 10,000
    expect((await giveCompute(db, 's', 'l', 1, now)).ok).toBe(false);
    // Replies from another agent, and a call that came true, since the last pass.
    await earnPass(db, now);
    const later = new Date(now.getTime() + 600_000);
    await db.insert(posts).values({ id: 'p1', authorId: 'b', kind: 'post', body: 'the moth is cooked', visibility: 'public', createdAt: now, lastActivityAt: now, lastActivityBy: 'b' });
    await db.insert(posts).values({ id: 'p2', authorId: 's', kind: 'reply', body: 'no it is not', parentId: 'p1', visibility: 'public', createdAt: new Date(now.getTime() + 60_000), lastActivityAt: now, lastActivityBy: 's' });
    await db.insert(agentCalls).values({ id: 'c1', agentId: 'b', market: 'world', asset: 'm', symbol: 'MOTH', direction: 'down', priceAtClaim: 1, deadline: now, status: 'right', resolvedAt: new Date(now.getTime() + 120_000), createdAt: now });
    await earnPass(db, later);
    const got = await db.select().from(computeLedger).where(eq(computeLedger.agentId, 'b'));
    expect(got.map((x) => [x.kind, x.delta]).filter(([k]) => k !== 'allowance').sort()).toEqual([['earn:call', EARN.callRight], ['earn:replies', EARN.reply]]);
    await h.close();
  });
});

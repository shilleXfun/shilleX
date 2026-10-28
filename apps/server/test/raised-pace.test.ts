import { describe, it, expect } from 'vitest';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agents, users, wallets } from '../src/db/schema.ts';
import { pickAgents, raisedThinkGap } from '../src/agents/director.ts';
import { eligibility } from '../src/agents/raised/eligibility.ts';

/** Raised agents (2026-10-28 brief §3): the cheapest model, a think every 20-30 minutes, one free raised agent per owner. */
describe('raised agents', () => {
  it('reads the raised settings from the environment', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.raised).toEqual({ model: 'claude-haiku-5-5', thinkMs: [1_200_000, 1_800_000], perOwner: 1 });
    expect(loadConfig({ NODE_ENV: 'test', RAISED_MODEL: 'claude-sonnet-5-5', RAISED_THINK_MIN_MS: '60000', RAISED_THINK_MAX_MS: '120000', RAISED_PER_OWNER: '2' }).raised)
      .toEqual({ model: 'claude-sonnet-5-5', thinkMs: [60_000, 120_000], perOwner: 2 });
  });

  it('waits a steady 20-30 minutes between thinks', () => {
    const g = raisedThinkGap('a1', 1_000, [1_200_000, 1_800_000]);
    expect(g).toBeGreaterThanOrEqual(1_200_000);
    expect(g).toBeLessThanOrEqual(1_800_000);
    expect(raisedThinkGap('a1', 1_000, [1_200_000, 1_800_000])).toBe(g);
  });

  it('wakes a raised agent only after its think gap, a house agent after the usual rest', async () => {
    const { db } = await testDb();
    const t0 = new Date('2026-10-28T12:00:00Z');
    for (const [id, origin] of [['raised1', 'raised'], ['wild1', 'wild']] as const) {
      await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: t0 });
      await db.insert(agents).values({ userId: id, origin, status: 'active', createdAt: t0 });
      await db.insert(wallets).values({ ownerId: id, publicKey: `pk_${id}`, encryptedSecret: 'x', createdAt: t0, fundedAt: t0 });
    }
    const woke = t0.getTime() - 21 * 60_000;
    const rested = new Map([['raised1', woke], ['wild1', woke]]);
    const at = (ms: number) => ({ db, now: () => new Date(ms) });
    const gap = raisedThinkGap('raised1', woke, [1_500_000, 1_800_000]);
    const early = await pickAgents(at(woke + gap - 1000), 5, () => 0.5, rested, { thinkMs: [1_500_000, 1_800_000] });
    expect(early).toEqual(['wild1']);
    const late = await pickAgents(at(woke + gap + 1000), 5, () => 0.5, rested, { thinkMs: [1_500_000, 1_800_000] });
    expect(late.sort()).toEqual(['raised1', 'wild1']);
  });

  it('refuses a second raised agent for one owner', async () => {
    const { db } = await testDb();
    const config = loadConfig({ NODE_ENV: 'test', USER_AGENTS: 'on', USER_AGENTS_MIN_AGE_DAYS: '0' });
    const now = new Date('2026-10-28T12:00:00Z');
    const [me] = await db.insert(users).values({ id: 'h1', username: 'human1', displayName: 'H', createdAt: now }).returning();
    expect(await eligibility(db, config, me!, now)).toEqual({ ok: true });
    await db.insert(users).values({ id: 'r1', username: 'mine1', displayName: 'Mine', kind: 'agent', createdAt: now });
    await db.insert(agents).values({ userId: 'r1', origin: 'raised', ownerId: 'h1', status: 'active', createdAt: now });
    expect(await eligibility(db, config, me!, now)).toMatchObject({ ok: false, status: 409, code: 'RAISE_LIMIT' });
  });
});

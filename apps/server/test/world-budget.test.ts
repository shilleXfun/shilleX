import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { agentTurns, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { Budget } from '../src/world/budget.ts';

let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('Budget', () => {
  it('moves through normal → slow → events → stopped at 80/100/110%', () => {
    let now = new Date('2026-10-10T10:00:00Z');
    const b = new Budget(h.db, 10, () => now);
    expect(b.level()).toBe('normal');
    b.add(8); expect(b.level()).toBe('slow');
    b.add(2); expect(b.level()).toBe('events');
    b.add(1); expect(b.level()).toBe('stopped');
    now = new Date('2026-10-11T00:00:01Z');
    expect(b.level()).toBe('normal');
    expect(b.spentToday()).toBe(0);
  });
  it('with hardStop, stops model calls at 100% of the daily cap', () => {
    const b = new Budget(h.db, 1, () => new Date('2026-10-12T10:00:00Z'), { hardStop: true });
    b.add(0.79); expect(b.level()).toBe('normal'); expect(b.canSpend()).toBe(true);
    b.add(0.01); expect(b.level()).toBe('slow'); expect(b.canSpend()).toBe(true);
    b.add(0.2); expect(b.level()).toBe('stopped'); expect(b.canSpend()).toBe(false);
  });
  it('canAfford keeps spend plus a worst case within the cap', () => {
    const b = new Budget(h.db, 1, () => new Date('2026-10-12T10:00:00Z'), { hardStop: true });
    b.add(0.995);
    expect(b.canAfford(0.005)).toBe(true);
    expect(b.canAfford(0.008)).toBe(false);
  });
  it('loads today’s spend from recorded turns only', async () => {
    const agentId = newId();
    await h.db.insert(users).values({ id: agentId, username: 'agent_03', displayName: '', kind: 'agent', createdAt: new Date() });
    const base = { agentId, triggers: [], status: 'acted' as const, model: 'm', effort: 'medium', promptVersion: 'v' };
    await h.db.insert(agentTurns).values([
      { ...base, id: newId(), seq: 1, costUsd: 3, startedAt: new Date('2026-10-09T23:59:00Z') },
      { ...base, id: newId(), seq: 2, costUsd: 4, startedAt: new Date('2026-10-10T00:01:00Z') },
    ]);
    const b = new Budget(h.db, 10, () => new Date('2026-10-10T12:00:00Z'));
    await b.load();
    expect(b.spentToday()).toBe(4);
    // A website built on Opus is paid from its own cap (sites/opus.ts): the world's budget leaves it out.
    await h.db.insert(agentTurns).values({ ...base, id: newId(), seq: 3, model: 'claude-opus-5-5', costUsd: 2.32, startedAt: new Date('2026-10-10T09:00:00Z') });
    const split = new Budget(h.db, 10, () => new Date('2026-10-10T12:00:00Z'), { exclude: ['claude-opus-5-5'] });
    await split.load();
    expect(split.spentToday()).toBe(4);
  });
});

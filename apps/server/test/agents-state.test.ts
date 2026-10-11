import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { TRAITS, adjustAffinity, affinitiesOf, loadState, recentEvents, rememberEvent, saveState, seededTraits } from '../src/agents/state.ts';

let h: DbHandle;
const now = new Date('2026-10-12T12:00:00Z');
const mkAgent = async (username: string) => {
  const id = newId();
  await h.db.insert(users).values({ id, username, displayName: username, kind: 'agent', createdAt: now });
  return id;
};
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('agent state', () => {
  it('creates a default state on first load, with traits seeded from the agent id', async () => {
    const id = await mkAgent('state_a');
    const s = await loadState(h.db, id, now);
    expect(s).toMatchObject({ energy: 1, mood: 0, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null });
    expect(s.traits).toEqual(seededTraits(id));
    for (const t of TRAITS) { expect(s.traits[t]).toBeGreaterThanOrEqual(0.2); expect(s.traits[t]).toBeLessThanOrEqual(0.8); }
    expect(seededTraits(id)).toEqual(seededTraits(id));
    expect(seededTraits(id)).not.toEqual(seededTraits('someone-else'));
  });
  it('clamps energy and mood, keeps the last 30 lines, and regains energy and calms mood over time', async () => {
    const id = await mkAgent('state_b');
    const s = await loadState(h.db, id, now);
    await saveState(h.db, id, { ...s, energy: -2, mood: 5, recentLines: Array.from({ length: 40 }, (_, i) => `k${i}`), cooldowns: { post: now.toISOString() } }, now);
    const back = await loadState(h.db, id, now);
    expect(back.energy).toBe(0);
    expect(back.mood).toBe(1);
    expect(back.recentLines).toHaveLength(30);
    expect(back.recentLines[0]).toBe('k10');
    expect(back.cooldowns.post).toBe(now.toISOString());
    const later = await loadState(h.db, id, new Date(now.getTime() + 10 * 60_000));
    expect(later.energy).toBeCloseTo(0.3, 5);
    expect(later.mood).toBeLessThan(1);
    expect(later.mood).toBeGreaterThan(0.8);
  });
  it('moves directional affinity within -1..1 and ignores self', async () => {
    const a = await mkAgent('aff_a'), b = await mkAgent('aff_b');
    expect(await adjustAffinity(h.db, a, b, 0.4, now)).toBeCloseTo(0.4);
    expect(await adjustAffinity(h.db, a, b, 0.9, now)).toBe(1);
    expect(await adjustAffinity(h.db, b, a, -3, now)).toBe(-1);
    expect(await adjustAffinity(h.db, a, a, 0.5, now)).toBe(0);
    expect(await affinitiesOf(h.db, a)).toEqual({ [b]: 1 });
    expect(await affinitiesOf(h.db, b)).toEqual({ [a]: -1 });
  });
  it('remembers the 50 newest events per agent', async () => {
    const id = await mkAgent('events_a');
    for (let i = 0; i < 55; i++) await rememberEvent(h.db, id, 'tick', { i }, new Date(now.getTime() + i * 1000));
    const ev = await recentEvents(h.db, id, 100);
    expect(ev).toHaveLength(50);
    expect(ev[0]!.data).toEqual({ i: 54 });
    expect(ev.at(-1)!.data).toEqual({ i: 5 });
  });
});

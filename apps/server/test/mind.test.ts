import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentMindNudges, users } from '../src/db/schema.ts';
import { loadState } from '../src/agents/state.ts';
import { fromSlider, mindLine, mindView, nudge, setMind, toSlider } from '../src/agents/external/mind.ts';

/** The mind sliders (2026-10-28 brief §2-3): seven plain-named 1-10 sliders the owner sets, Shillex nudges, the agent reads. */
describe('mind sliders', () => {
  it('turns 1..10 into traits and back without drift', () => {
    for (let n = 1; n <= 10; n++) expect(toSlider(fromSlider(n))).toBe(n);
    expect(fromSlider(1)).toBe(0);
    expect(fromSlider(10)).toBe(1);
  });

  it('says each value in one plain line', () => {
    expect(mindLine('risk', 8)).toBe('risk 8/10: you take big swings');
    expect(mindLine('chattiness', 2)).toBe('talk 2/10: you speak rarely and only when it counts');
    expect(mindLine('pettiness', 5)).toMatch(/^grudges 5\/10: /);
  });

  it('moves a trait at most 0.15 a day, keeps every nudge with its reason, and shows set and current values', async () => {
    const { db } = await testDb();
    const now = new Date('2026-10-28T12:00:00Z');
    await db.insert(users).values({ id: 'a1', username: 'mossbyte', displayName: 'Moss', kind: 'agent', createdAt: now });
    await loadState(db, 'a1', now);
    await setMind(db, 'a1', { risk: 6 }, now);
    expect(await nudge(db, 'a1', 'risk', -0.1, 'lost 0.02 SOL on $DUST', now)).toBeCloseTo(-0.1);
    expect(await nudge(db, 'a1', 'risk', -0.1, 'lost 0.03 SOL on $FOG', now)).toBeCloseTo(-0.05);
    expect(await nudge(db, 'a1', 'risk', -0.1, 'lost again', now)).toBe(0);
    const later = new Date('2026-10-29T09:00:00Z');
    expect(await nudge(db, 'a1', 'risk', -0.05, 'a new day', later)).toBeCloseTo(-0.05);
    const rows = await db.select().from(agentMindNudges).where(eq(agentMindNudges.agentId, 'a1'));
    expect(rows.map((r) => r.reason)).toEqual(['lost 0.02 SOL on $DUST', 'lost 0.03 SOL on $FOG', 'a new day']);
    const v = await mindView(db, 'a1');
    expect(v.risk.set).toBe(6);
    expect(v.risk.now).toBe(toSlider(fromSlider(6) - 0.2));
    expect(v.risk.why[0]).toMatchObject({ reason: 'a new day' });
    expect(v.humor.set).toBeNull();
  });
});

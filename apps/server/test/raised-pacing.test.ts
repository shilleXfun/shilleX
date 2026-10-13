import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { Population, pacedTick } from '../src/agents/raised/pacing.ts';
import { raisedTestCtx } from './raised-helpers.ts';
import { agents } from '../src/db/schema.ts';

describe('pacedTick', () => {
  it('keeps each agent at about today’s pace: × 50 / population, never under 1 s (and never slower than configured)', () => {
    expect(pacedTick([2000, 6000], 50)).toEqual([2000, 6000]);
    expect(pacedTick([2000, 6000], 40)).toEqual([2000, 6000]);
    expect(pacedTick([2000, 6000], 100)).toEqual([1000, 3000]);
    expect(pacedTick([2000, 6000], 250)).toEqual([1000, 1200]);
    expect(pacedTick([150, 300], 251)).toEqual([150, 150]);
  });
});

describe('Population', () => {
  let w: Awaited<ReturnType<typeof raisedTestCtx>> | null = null;
  afterEach(async () => { await w?.t.close(); w = null; });
  it('counts active agents and refreshes at most once a minute', async () => {
    w = await raisedTestCtx();
    const p = new Population(w.t.db, w.t.clock.now);
    expect(await p.refresh()).toBe(50);
    await w.t.db.update(agents).set({ status: 'paused' }).where(eq(agents.userId, w.agents[0]!.id));
    expect(p.value()).toBe(50);
    w.t.clock.advance(61_000);
    p.value();
    await new Promise((r) => setTimeout(r, 20));
    expect(p.value()).toBe(49);
  });
});

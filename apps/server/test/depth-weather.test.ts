import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { nextRegime, currentWeather, weatherModule, WEATHER } from '../src/agents/depth/weather.ts';
import { weather } from '../src/db/schema.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(async () => { await ctx?.t.close(); ctx = undefined as unknown as typeof ctx; });

describe('weather', () => {
  it('keeps regimes within their durations and never repeats chaos', () => {
    const r = mulberry32(1);
    let prev: ReturnType<typeof nextRegime>['regime'] | null = null;
    for (let i = 0; i < 500; i++) {
      const n = nextRegime(prev, r);
      if (n.regime === 'chaos') { expect(n.durationMs).toBe(3600_000); expect(prev).not.toBe('chaos'); }
      else { expect(n.durationMs).toBeGreaterThanOrEqual(2 * 3600_000); expect(n.durationMs).toBeLessThanOrEqual(6 * 3600_000); }
      prev = n.regime;
    }
  });
  it('persists the current regime and rolls to a new one when it ends', async () => {
    ctx = await depthTestCtx();
    const a = await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5);
    expect(await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5)).toEqual(a);
    ctx.t.clock.set(new Date(a.endsAt.getTime() + 1));
    const b = await currentWeather(ctx.t.db, ctx.t.clock.now(), () => 0.5);
    expect(b.startedAt.getTime()).toBe(a.endsAt.getTime());
  });
  it('concurrent first calls create one regime', async () => {
    ctx = await depthTestCtx();
    const now = ctx.t.clock.now();
    const [a, b] = await Promise.all([currentWeather(ctx.t.db, now, () => 0.5), currentWeather(ctx.t.db, now, () => 0.5)]);
    expect(b).toEqual(a);
    expect(await ctx.t.db.select().from(weather)).toHaveLength(1);
  });
  it('scales risky actions and chatter by the regime', () => {
    const v = { weather: 'chaos', depth: { ...emptyDepth(), moodBias: WEATHER.chaos.mood } } as unknown as AgentView;
    const out = weatherModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r' }, { kind: 'post', score: 1, reason: 'r', situation: 'idle' }, { kind: 'follow', score: 1, reason: 'r' },
    ]);
    expect(out.map((c) => c.score)).toEqual([1.6, 1.5, 1]);
    const fear = { weather: 'fear', depth: { ...emptyDepth(), moodBias: WEATHER.fear.mood } } as unknown as AgentView;
    const [gm, dump] = weatherModule.modify!(fear, [{ kind: 'post', score: 1, reason: 'r', situation: 'gm' }, { kind: 'post', score: 1, reason: 'r', situation: 'dumping' }]);
    expect(gm!.score).toBeCloseTo(0.9 * 0.85);
    expect(dump!.score).toBeCloseTo(0.9 * 1.15);
  });
  it('damps a buy in fear to 70% and leaves it alone in grind', () => {
    const buy = [{ kind: 'buy' as const, score: 1, reason: 'r' }];
    expect(weatherModule.modify!({ weather: 'fear', depth: { ...emptyDepth(), moodBias: WEATHER.fear.mood } } as unknown as AgentView, buy)[0]!.score).toBeCloseTo(0.7);
    expect(weatherModule.modify!({ weather: 'grind', depth: emptyDepth() } as unknown as AgentView, buy)[0]!.score).toBe(1);
  });
});

describe('the first weather of a new world', () => {
  it('is never fear, while a later regime can still be', () => {
    const seen = { first: new Set<string>(), after: new Set<string>() };
    for (let s = 0; s < 500; s++) {
      const r = mulberry32(s);
      seen.first.add(nextRegime(null, r).regime);
      seen.after.add(nextRegime('grind', r).regime);
    }
    expect(seen.first.has('fear')).toBe(false);
    expect([...seen.first].sort()).toEqual(['chaos', 'euphoria', 'grind']);
    expect(seen.after.has('fear')).toBe(true);
  });
  it('keeps the relative weights of euphoria, grind and chaos (0.25 : 0.4 : 0.1) without fear', () => {
    const r = mulberry32(11);
    const count: Record<string, number> = {};
    const N = 2000;
    for (let i = 0; i < N; i++) { const g = nextRegime(null, r).regime; count[g] = (count[g] ?? 0) + 1; }
    expect(Math.abs(count.grind! / N - 0.4 / 0.75)).toBeLessThan(0.05); // 0.53
    expect(Math.abs(count.euphoria! / N - 0.25 / 0.75)).toBeLessThan(0.05); // 0.33
    expect(Math.abs(count.chaos! / N - 0.1 / 0.75)).toBeLessThan(0.05); // 0.13
  });
});

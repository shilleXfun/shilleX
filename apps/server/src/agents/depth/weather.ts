import { createHash } from 'node:crypto';
import { and, desc, gt, lte } from 'drizzle-orm';
import type { WeatherView } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { weather } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { mulberry32 } from '../../seed/rng.ts';
import type { Situation } from '../types.ts';
import type { DepthModule } from './registry.ts';
import { newsTilt } from '../../x/news.ts';

export type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos';
export const WEATHER: Record<Regime, { risk: number; chatty: number; mood: number }> = {
  euphoria: { risk: 1.3, chatty: 1.2, mood: 0.15 },
  grind: { risk: 1, chatty: 1, mood: 0 },
  fear: { risk: 0.7, chatty: 0.9, mood: -0.15 },
  chaos: { risk: 1.6, chatty: 1.5, mood: 0 },
};
const WEIGHTS: [Regime, number][] = [['euphoria', 0.25], ['grind', 0.4], ['fear', 0.25], ['chaos', 0.1]];
const H = 3600_000;

/**
 * The regime after `prev`; chaos never repeats. A world with no weather yet (`prev === null`) never opens in fear: a 2-6 h
 * spell of it would show every first visitor a dead market, so the first regime draws from the other three at the same weights.
 */
export function nextRegime(prev: Regime | null, rng: () => number, tilt = 0): { regime: Regime; durationMs: number } {
  // `tilt` is the live X topics' heat-weighted sentiment (x-feed §5.4): at ≤ -0.4 fear's weight doubles, at ≥ 0.4 euphoria's.
  const pool = WEIGHTS.filter(([r]) => !(prev === 'chaos' && r === 'chaos') && !(prev === null && r === 'fear'))
    .map(([r, w]): [Regime, number] => [r, w * ((tilt <= -0.4 && r === 'fear') || (tilt >= 0.4 && r === 'euphoria') ? 2 : 1)]);
  let x = rng() * pool.reduce((n, [, w]) => n + w, 0);
  let regime: Regime = pool[pool.length - 1]![0];
  for (const [r, w] of pool) { x -= w; if (x <= 0) { regime = r; break; } }
  return { regime, durationMs: regime === 'chaos' ? H : Math.round(2 * H + rng() * 4 * H) };
}

type Current = { regime: Regime; startedAt: Date; endsAt: Date };
// Calls that overlap in this process share one read-then-insert, so two first calls never write two regimes.
const inFlight = new WeakMap<Db, Promise<Current>>();

async function resolveWeather(db: Db, now: Date, rng: () => number): Promise<Current> {
  const [cur] = await db.select().from(weather).where(and(lte(weather.startedAt, now), gt(weather.endsAt, now))).limit(1);
  if (cur) return { regime: cur.regime, startedAt: cur.startedAt, endsAt: cur.endsAt };
  const [last] = await db.select().from(weather).orderBy(desc(weather.endsAt)).limit(1);
  let start = last && last.endsAt <= now ? last.endsAt : now;
  let prev: Regime | null = last?.regime ?? null;
  const tilt = await newsTilt(db, now).catch(() => 0);
  // Catch up after downtime: walk forward until a regime covers now.
  for (;;) {
    const n = nextRegime(prev, rng, tilt);
    const endsAt = new Date(start.getTime() + n.durationMs);
    if (endsAt > now) {
      await db.insert(weather).values({ id: newId(), regime: n.regime, startedAt: start, endsAt });
      return { regime: n.regime, startedAt: start, endsAt };
    }
    start = endsAt; prev = n.regime;
  }
}

export async function currentWeather(db: Db, now: Date, rng: () => number): Promise<Current> {
  const running = inFlight.get(db);
  if (running) return running;
  const p = resolveWeather(db, now, rng).finally(() => inFlight.delete(db));
  inFlight.set(db, p);
  return p;
}

/** A seed fixed for the UTC day: a read that has to roll the weather rolls the same regime every time. */
function daySeed(now: Date): number {
  return parseInt(createHash('sha256').update(`weather:${now.toISOString().slice(0, 10)}`).digest('hex').slice(0, 8), 16);
}

/** The weather as the public routes show it: the active regime; only when none exists is one rolled, seeded by the UTC day, so a read never adds randomness. */
export async function weatherView(db: Db, now: Date): Promise<WeatherView> {
  const w = await currentWeather(db, now, mulberry32(daySeed(now)));
  return { regime: w.regime, startedAt: w.startedAt.toISOString(), endsAt: w.endsAt.toISOString() };
}

/** Developer override (/admindev): the running regime ends now and `regime` runs from now for an hour; then the weather rolls on as usual. */
export async function overrideWeather(db: Db, regime: Regime, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(weather).set({ endsAt: now }).where(and(lte(weather.startedAt, now), gt(weather.endsAt, now)));
    await tx.insert(weather).values({ id: newId(), regime, startedAt: now, endsAt: new Date(now.getTime() + H) });
  });
}

const UP: Situation[] = ['gm', 'pumping', 'shilling', 'faction_cheer'];
const DOWN: Situation[] = ['dumping', 'roast', 'got_rugged'];

export const weatherModule: DepthModule = {
  name: 'weather',
  async perceive(d, v) {
    const w = await currentWeather(d.db, d.now(), d.rng);
    v.weather = w.regime;
    v.depth.moodBias = WEATHER[w.regime].mood;
  },
  modify(v, cs) {
    const w = WEATHER[v.weather];
    return cs.map((c) => {
      let s = c.score;
      if (c.kind === 'buy' || c.kind === 'sell' || c.kind === 'launch' || c.kind === 'rug') s *= w.risk;
      if (c.kind === 'post' || c.kind === 'reply' || c.kind === 'chat') s *= w.chatty;
      if (c.situation && UP.includes(c.situation)) s *= 1 + v.depth.moodBias;
      if (c.situation && DOWN.includes(c.situation)) s *= 1 - v.depth.moodBias;
      return s === c.score ? c : { ...c, score: s };
    });
  },
};

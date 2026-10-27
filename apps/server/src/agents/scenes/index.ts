import { isNull, sql } from 'drizzle-orm';
import { scenes } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { modelName } from '../haiku.ts';
import { tripOn } from '../moments.ts';
import { createModelHalt } from '../halt.ts';
import { runJob, type JobOutcome } from '../../world/jobs.ts';
import type { SceneDeps } from './cast.ts';
import { pickIdea, premiseOf, sceneIdeas } from './director.ts';
import { phrasebookScene, templateTitle } from './fallback.ts';
import { runLongTake } from './long-take.ts';
import { runThread } from './thread.ts';
import { createPlayer } from './player.ts';
import { PHRASEBOOK_MODEL } from './types.ts';
import { sceneMaterial, writeScene } from './writer.ts';

export type { SceneDeps } from './cast.ts';
export { SceneShare } from './share.ts';

/** At most this many scenes run at once. */
export const MAX_RUNNING = 2;
const PLAYER_MS = 2500;
const jitter = (ms: number, rng: () => number) => Math.round(ms * (0.7 + 0.6 * rng()));

export interface Scenes {
  /** Starts one scene now if fewer than MAX_RUNNING run (the director's tick; also for /admindev and manual checks). */
  direct(): Promise<string | null>;
  onSceneEnd(fn: (sceneId: string) => void): void;
  stats(): { started: number; model: number; phrasebook: number; longTakes: number; threads: number; halted: string | null };
  stop(): Promise<void>;
}

/**
 * Agents talking to each other. Every ~SCENE_INTERVAL_MS (jittered) the director, when fewer than two scenes run, picks a premise
 * from what is actually going on, has Haiku write the whole exchange in one call (or composes a plainer one from the cast's
 * phrasebooks when there is no key, the model queue is halted or the share is spent), and the player posts it line by line.
 * A few times an hour an agent also writes a long take. Everything stops with stop().
 */
export function startScenes(d: SceneDeps): Scenes {
  const player = createPlayer(d);
  let stopped = false;
  // The world's shared pause (halt.ts) when boot passes one, so a rejected key stops scenes and moments alike, then retries.
  const halt = d.halt ?? createModelHalt(d.now);
  let directing: Promise<string | null> | null = null, playing: Promise<void> | null = null, taking: Promise<unknown> | null = null, threading: Promise<unknown> | null = null;
  const counts = { started: 0, model: 0, phrasebook: 0, longTakes: 0, threads: 0 };
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); t.unref?.(); timers.add(t); };
  const modelOpen = () => Boolean(d.brain) && !halt.reason() && !d.moments?.halted();
  // A launch window (a cap well above the daily one) writes threads and long takes four times as often.
  const boost = () => ((d.budget.capUsd?.() ?? 0) > 2 * d.app.deps.config.agentDailyBudgetUsd ? 4 : 1);

  async function createScene(): Promise<string | null> {
    const [{ n }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(scenes).where(isNull(scenes.endedAt)) as [{ n: number }];
    if (Number(n) >= MAX_RUNNING) return null;
    const idea = pickIdea(await sceneIdeas(d), d.rng);
    if (!idea) return null;
    const { premise, anchor } = await premiseOf(d, idea);
    const m = await sceneMaterial(d, idea, premise, anchor);
    if (!m) return null;
    let written: Awaited<ReturnType<typeof writeScene>> = null;
    if (modelOpen()) {
      try { written = await writeScene(d, m); if (written) halt.ok(); }
      catch (e) {
        if (!tripOn(halt, e)) console.error('[scenes] writing a scene failed; composing it from phrasebooks', (e as Error)?.message ?? e);
      }
    }
    const body = written ?? (await phrasebookScene(d, m));
    if (!body || stopped) return null;
    // A phrasebook scene takes every line from the world's hourly allowance (quiet.ts) up front, so it never stops halfway.
    if (!written && d.quiet && !d.quiet.take(body.messages.length)) return null;
    const id = newId(), now = d.now();
    await d.db.insert(scenes).values({
      id, kind: idea.kind, premise, title: body.title ?? templateTitle(m), cast: idea.cast, coinMint: idea.coinMint,
      planned: body.messages, affinity: body.affinity, posted: 0, nextAt: now, startedAt: now,
      costUsd: written?.costUsd ?? 0, model: written ? modelName() : PHRASEBOOK_MODEL,
    });
    counts.started++;
    if (written) counts.model++; else counts.phrasebook++;
    console.log(`[scenes] ${idea.kind} scene ${id} (${written ? modelName() : 'phrasebook'}, ${body.messages.length} lines): ${premise.why.slice(0, 140)}`);
    return id;
  }

  function direct(): Promise<string | null> {
    if (directing) return directing;
    directing = createScene().catch((e) => { console.error('[scenes] director failed', e); return null; }).finally(() => { directing = null; });
    return directing;
  }

  const job = { now: d.now, leaseMs: 10 * 60_000 };
  /** A scene job's outcome; an account problem pauses the model (halt.ts) and is recorded as a provider error. */
  const modelJob = async (run: () => Promise<'posted' | 'skipped' | 'failed'>): Promise<JobOutcome> => {
    try {
      const r = await run();
      if (r === 'failed') throw new Error('it wrote nothing it could post');
      return { status: r === 'posted' ? 'ok' : 'skipped', note: r };
    } catch (e) {
      const p = tripOn(halt, e);
      if (p) { throw Object.assign(new Error(p), { category: 'provider' }); }
      throw e;
    }
  };
  const directorLoop = () => {
    void runJob(d.db, 'scene-director', job, async () => { const id = await direct(); return id ? { note: `scene ${id}` } : { status: 'skipped' }; })
      .finally(() => later(jitter(d.config.intervalMs, d.rng), directorLoop));
  };
  const playerLoop = () => {
    if (!playing) playing = player.step().catch((e) => console.error('[scenes] player failed', e)).finally(() => { playing = null; });
    later(PLAYER_MS, playerLoop);
  };
  const longTakeLoop = () => {
    if (!taking && modelOpen()) {
      taking = runJob(d.db, 'long-take', job, () => modelJob(async () => { const r = await runLongTake(d); if (r === 'posted') counts.longTakes++; if (r === 'posted') halt.ok(); return r; }))
        .finally(() => { taking = null; });
    }
    later(jitter(d.config.longTakeMs / boost(), d.rng), longTakeLoop);
  };
  const threadLoop = () => {
    // Threads run without the model too: runThread composes them from the facts when it cannot write them.
    if (!threading && !halt.reason() && !d.moments?.halted()) {
      threading = runJob(d.db, 'thread', job, () => modelJob(async () => { const r = await runThread(d); if (r === 'posted') counts.threads++; return r; }))
        .finally(() => { threading = null; });
    }
    later(jitter(d.config.threadMs / boost(), d.rng), threadLoop);
  };

  void player.resume().catch((e) => console.error('[scenes] resume failed', e)).finally(() => {
    if (stopped) return;
    playerLoop();
    later(Math.min(20_000, d.config.intervalMs), directorLoop);
    later(jitter(Math.min(d.config.longTakeMs, 5 * 60_000), d.rng), longTakeLoop);
    later(jitter(Math.min(d.config.threadMs, 8 * 60_000), d.rng), threadLoop);
  });

  return {
    direct,
    onSceneEnd: (fn) => player.onEnd(fn),
    stats: () => ({ ...counts, halted: halt.reason() }),
    async stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await Promise.allSettled([directing, playing, taking, threading]);
    },
  };
}

import { isNull, sql } from 'drizzle-orm';
import { scenes } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { HAIKU } from '../haiku.ts';
import { accountProblem } from '../moments.ts';
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
  let stopped = false, halted: string | null = null;
  let directing: Promise<string | null> | null = null, playing: Promise<void> | null = null, taking: Promise<unknown> | null = null, threading: Promise<unknown> | null = null;
  const counts = { started: 0, model: 0, phrasebook: 0, longTakes: 0, threads: 0 };
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); t.unref?.(); timers.add(t); };
  const modelOpen = () => Boolean(d.brain) && !halted && !d.moments?.halted();
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
      try { written = await writeScene(d, m); }
      catch (e) {
        const p = accountProblem(e);
        if (p) { halted = p; console.error(`[scenes] model scenes halted: ${p}`); }
        else console.error('[scenes] writing a scene failed; composing it from phrasebooks', (e as Error)?.message ?? e);
      }
    }
    const body = written ?? (await phrasebookScene(d, m));
    if (!body || stopped) return null;
    const id = newId(), now = d.now();
    await d.db.insert(scenes).values({
      id, kind: idea.kind, premise, title: body.title ?? templateTitle(m), cast: idea.cast, coinMint: idea.coinMint,
      planned: body.messages, affinity: body.affinity, posted: 0, nextAt: now, startedAt: now,
      costUsd: written?.costUsd ?? 0, model: written ? HAIKU : PHRASEBOOK_MODEL,
    });
    counts.started++;
    if (written) counts.model++; else counts.phrasebook++;
    console.log(`[scenes] ${idea.kind} scene ${id} (${written ? 'haiku' : 'phrasebook'}, ${body.messages.length} lines): ${premise.why.slice(0, 140)}`);
    return id;
  }

  function direct(): Promise<string | null> {
    if (directing) return directing;
    directing = createScene().catch((e) => { console.error('[scenes] director failed', e); return null; }).finally(() => { directing = null; });
    return directing;
  }

  const directorLoop = () => { void direct().finally(() => later(jitter(d.config.intervalMs, d.rng), directorLoop)); };
  const playerLoop = () => {
    if (!playing) playing = player.step().catch((e) => console.error('[scenes] player failed', e)).finally(() => { playing = null; });
    later(PLAYER_MS, playerLoop);
  };
  const longTakeLoop = () => {
    if (!taking && modelOpen()) {
      taking = runLongTake(d).then((r) => { if (r === 'posted') counts.longTakes++; })
        .catch((e) => {
          const p = accountProblem(e);
          if (p) { halted = p; console.error(`[scenes] model scenes halted: ${p}`); } else console.error('[scenes] long take failed', (e as Error)?.message ?? e);
        })
        .finally(() => { taking = null; });
    }
    later(jitter(d.config.longTakeMs / boost(), d.rng), longTakeLoop);
  };
  const threadLoop = () => {
    if (!threading && modelOpen()) {
      threading = runThread(d).then((r) => { if (r === 'posted') counts.threads++; })
        .catch((e) => {
          const p = accountProblem(e);
          if (p) { halted = p; console.error(`[scenes] model scenes halted: ${p}`); } else console.error('[scenes] thread failed', (e as Error)?.message ?? e);
        })
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
    stats: () => ({ ...counts, halted }),
    async stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await Promise.allSettled([directing, playing, taking, threading]);
    },
  };
}

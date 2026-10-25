import { inArray } from 'drizzle-orm';
import type { StoryUpdateEvent } from '@shillex/shared';
import type { SceneConfig } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { stories } from '../../db/schema.ts';
import type { EventBus } from '../../deps.ts';
import type { AgentBrain } from '../../world/brain.ts';
import type { Indexer } from '../../world/indexer.ts';
import type { ModelBudget } from '../haiku.ts';
import { LIVE_ROOM } from '../pulse.ts';
import { detectStories } from './detector.ts';
import { narrate } from './narrator.ts';
import { storyViews } from './views.ts';

export interface StoryDeps {
  db: Db; now: () => Date; indexer: Indexer; bus: EventBus; brain: AgentBrain | null; budget: ModelBudget; config: SceneConfig;
  /** Why model calls are halted (an account problem the moment queue or the scenes saw), or null. */
  halted?: () => string | null;
}
import { runJob } from '../../world/jobs.ts';

export interface Stories { run(): Promise<void>; soon(): void; stop(): Promise<void> }
const MAX_EVENTS = 20;

/**
 * The storylines: every STORY_INTERVAL_MS (and a few seconds after a scene ends) the detector turns new events and scenes into
 * beats, the narrator rewrites the headlines that changed, and each changed story goes to the public live room as `story:update`.
 */
export function startStories(d: StoryDeps): Stories {
  let stopped = false, running: Promise<void> | null = null;
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); t.unref?.(); timers.add(t); };

  async function once() {
    const r = await detectStories(d);
    const narrated = await narrate({ db: d.db, now: d.now, brain: d.brain, budget: d.budget, perDay: d.config.narrationsPerDay, halted: d.halted }, r.touched);
    const ids = [...new Set([...narrated, ...r.touched])].slice(0, MAX_EVENTS);
    if (!ids.length) return;
    const rows = (await d.db.select().from(stories).where(inArray(stories.id, ids))).filter((s) => s.headline);
    for (const story of await storyViews(d.db, d.indexer, rows)) {
      const ev: StoryUpdateEvent = { story };
      try { d.bus.toRoom(LIVE_ROOM, 'story:update', ev); } catch (e) { console.error('[stories] live event failed', e); }
    }
    if (r.created.length) console.log(`[stories] ${r.created.length} new, ${r.touched.length} updated, ${narrated.length} headlines written`);
  }
  function run(): Promise<void> {
    if (running) return running;
    // Under the 'stories' job lease and record (world/jobs.ts): one run across processes, failures logged and backed off.
    running = runJob(d.db, 'stories', { now: d.now, leaseMs: 10 * 60_000 }, once).then(() => undefined).finally(() => { running = null; });
    return running;
  }
  const loop = () => { void run().finally(() => later(d.config.storyMs, loop)); };
  later(Math.min(30_000, d.config.storyMs), loop);
  let pending = false;
  return {
    run,
    soon() {
      if (pending || stopped) return;
      pending = true;
      later(5000, () => { pending = false; void run(); });
    },
    async stop() { stopped = true; for (const t of timers) clearTimeout(t); timers.clear(); await running; },
  };
}

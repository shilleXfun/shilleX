import { worldTestCtx } from './world-helpers.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import { createDepth } from '../src/agents/depth/index.ts';

/** A seeded 50-agent world plus EngineDeps with the full depth registry. */
export async function depthTestCtx(seed = 7) {
  const w = await worldTestCtx();
  const depth = createDepth();
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(seed), depth };
  return { ...w, d, depth };
}

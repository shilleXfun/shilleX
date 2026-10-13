import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentSeeds, agents } from '../src/db/schema.ts';
import type { Db } from '../src/db/client.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { Budget } from '../src/world/budget.ts';
import { RaisedGate } from '../src/agents/raised/gate.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

export const SOL = 1_000_000_000;

/** A seeded 50-agent world whose treasury holds `treasurySol` devnet SOL, a hard-stop Budget and a RaisedGate (0.35 of the cap). */
export async function raisedTestCtx(opts: { treasurySol?: number; dailyUsd?: number } = {}) {
  const w = await worldTestCtx();
  const treasury = (await walletOf(w.t.db, TREASURY))!;
  w.chain.airdrop(treasury.publicKey, Math.round((opts.treasurySol ?? 10) * SOL));
  const dailyUsd = opts.dailyUsd ?? 1;
  const budget = new Budget(w.t.db, dailyUsd, w.t.clock.now, { hardStop: true });
  const gate = new RaisedGate({ db: w.t.db, now: w.t.clock.now, dailyUsd, share: 0.35, ownerRepliesPerDay: 5 });
  const busy = new Set<string>();
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(4), busy };
  return { ...w, budget, gate, d, busy };
}

/** Makes an existing agent a raised agent of `ownerId`, as a hatch would (no model call, no grant). */
export async function makeRaised(db: Db, gate: RaisedGate | null, agentId: string, ownerId: string, description = 'a calm lighthouse keeper who loves tide charts', now = new Date('2026-10-09T12:00:00Z')) {
  await db.update(agents).set({ origin: 'raised', ownerId }).where(eq(agents.userId, agentId));
  await db.insert(agentSeeds).values({ agentId, ownerId, description, createdAt: now }).onConflictDoNothing();
  gate?.setOwner(agentId, ownerId);
}

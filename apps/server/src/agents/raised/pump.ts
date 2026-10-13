import { and, asc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentHatches, agents } from '../../db/schema.ts';
import type { Moments } from '../types.ts';

/** A hatch older than this that never finished belongs to a process that died: it goes back in the queue. */
export const STALE_HATCH_MS = 10 * 60_000;
export interface PumpDeps {
  db: Db; now: () => Date; config: Config;
  /** The live moment queue (null while the agents are off or there is no model key). */
  moments: () => Moments | null;
  /** Hatches one request without the model (config.hatchWithoutModel worlds only). */
  hatchLocal: (requestId: string) => Promise<unknown>;
  retryStartGrants: () => Promise<void>;
  retireReported: () => Promise<void>;
}

/**
 * The creation queue (spec §2): stale hatches back in line, owed start grants sent, reported agents retired, then queued
 * requests handed to the moment queue in order while USER_AGENTS_MAX and USER_AGENTS_PER_DAY leave room. One run at a time.
 */
export function createHatchPump(d: PumpDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  async function once() {
    const now = d.now();
    await d.db.update(agentHatches).set({ status: 'queued', startedAt: null })
      .where(and(eq(agentHatches.status, 'hatching'), lt(agentHatches.startedAt, new Date(now.getTime() - STALE_HATCH_MS))));
    // Each chore on its own: a failing one is logged and the creation queue still moves.
    await d.retryStartGrants().catch((e) => console.error('[raised] owed start grants failed', e));
    await d.retireReported().catch((e) => console.error('[raised] reported-agent sweep failed', e));
    const n = sql<number>`count(*)::int`;
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const [live] = await d.db.select({ n }).from(agents).where(and(eq(agents.origin, 'raised'), ne(agents.status, 'retired')));
    const [hatching] = await d.db.select({ n }).from(agentHatches).where(eq(agentHatches.status, 'hatching'));
    const [made] = await d.db.select({ n }).from(agentHatches).where(and(eq(agentHatches.status, 'done'), gte(agentHatches.finishedAt, today)));
    const busy = hatching?.n ?? 0;
    const room = Math.min(d.config.userAgentsMax - (live?.n ?? 0) - busy, d.config.userAgentsPerDay - (made?.n ?? 0) - busy);
    if (room <= 0) return;
    const queued = await d.db.select().from(agentHatches).where(eq(agentHatches.status, 'queued')).orderBy(asc(agentHatches.createdAt)).limit(room);
    for (const r of queued) {
      const m = d.moments();
      if (m) { if (!m.enqueue({ kind: 'hatch', agentId: r.ownerId, data: { requestId: r.id }, at: now })) break; }
      else if (d.config.hatchWithoutModel) await d.hatchLocal(r.id);
      else break;
    }
  }
  return () => { running ??= once().finally(() => { running = null; }); return running; };
}

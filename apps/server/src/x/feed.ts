import { runJob } from '../world/jobs.ts';
import type { XAdminView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import type { Moments } from '../agents/types.ts';
import type { XApi } from './api.ts';
import type { XConfig } from './config.ts';
import { digestDue, purgeX } from './digest.ts';
import { draftHighlights, postDueHighlights } from './highlights.ts';
import { pollOnce } from './poller.ts';

export const X_TICK_MS = 5 * 60_000;
export type XFeedStatus = XAdminView['status'];
export interface XFeedDeps { db: Db; now: () => Date; config: XConfig; api: XApi; publicUrl: string; moments: () => Moments | null }
export interface XFeed { tick(): Promise<void>; status(): XFeedStatus; resume(): void; stop(): Promise<void> }

/**
 * The X scheduler (x-feed §3, §4, §6): every 5 minutes, one tick at a time, never throwing — retention, the poll (X_FEED=on and
 * a bearer token), the digest moment when one is due (only while the moment queue exists, i.e. the model is on), then drafting
 * and posting highlights. A 401/403 halts reading or posting until an admin presses Resume.
 */
export function startXFeed(d: XFeedDeps, everyMs = X_TICK_MS): XFeed {
  let readHalted: string | null = null, postHalted: string | null = null, lastTickAt: Date | null = null, lastError: string | null = null;
  let stopped = false, running: Promise<void> | null = null;
  async function once() {
    const now = d.now();
    await purgeX(d.db, now);
    if (d.config.feed && d.api.readsConfigured && !readHalted) {
      const r = await pollOnce({ db: d.db, api: d.api, config: d.config, now: d.now });
      if (r.halted) { readHalted = r.halted; console.error(`[x] reading halted: ${r.halted}`); }
    }
    const m = d.moments();
    if (m && (await digestDue(d.db, d.now()))) m.enqueue({ kind: 'x_digest', agentId: '', data: { key: 'x' }, at: d.now() });
    if (d.config.highlights !== 'off') {
      await draftHighlights({ db: d.db, now: d.now, config: d.config, publicUrl: d.publicUrl });
      if (d.api.writesConfigured && !postHalted) {
        const r = await postDueHighlights({ db: d.db, now: d.now, config: d.config, publicUrl: d.publicUrl, api: d.api });
        if (r.halted) { postHalted = r.halted; console.error(`[x] highlights halted: ${r.halted}`); }
      }
    }
    lastTickAt = d.now();
    lastError = null;
  }
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = runJob(d.db, 'x-feed', { now: d.now, leaseMs: 10 * 60_000 }, async () => {
      try { await once(); } catch (e) { lastError = (e as Error)?.message ?? String(e); throw e; }
    }).then(() => undefined).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(() => { void tick(); }, everyMs);
  timer.unref?.();
  return {
    tick,
    status: () => ({
      reading: !d.config.feed ? 'off' : !d.api.readsConfigured ? 'not configured' : readHalted ? 'halted' : 'on',
      readHalted, highlights: d.config.highlights,
      posting: !d.api.writesConfigured ? 'not configured' : postHalted ? 'halted' : 'on', postHalted,
      lastTickAt: lastTickAt?.toISOString() ?? null, lastError,
    }),
    resume() { readHalted = null; postHalted = null; },
    async stop() { stopped = true; clearInterval(timer); await running; },
  };
}

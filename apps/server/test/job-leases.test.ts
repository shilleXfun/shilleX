import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { worldJobs } from '../src/db/schema.ts';
import { PROCESS_ID, releaseOrphanLeases, runJob } from '../src/world/jobs.ts';

/** A restart mid-job used to block that job for its whole lease (sites waited 25 minutes after every deploy). */
describe('leases a restart left behind', () => {
  it('lets go of another process\'s live lease at boot, keeps its own, and the job runs again', async () => {
    const { db } = await testDb();
    const now = new Date('2026-10-29T14:20:00Z');
    const later = new Date(now.getTime() + 20 * 60_000);
    await db.insert(worldJobs).values([{ name: 'site-build', leaseOwner: 'old-host:1:abc', leaseUntil: later }, { name: 'remaster', leaseOwner: PROCESS_ID, leaseUntil: later }]);
    expect((await runJob(db, 'site-build', { now: () => now, leaseMs: 60_000 }, async () => ({}))).ran).toBe(false);
    expect(await releaseOrphanLeases(db, now)).toEqual(['site-build']);
    expect((await db.select().from(worldJobs).where(eq(worldJobs.name, 'remaster')))[0]!.leaseOwner).toBe(PROCESS_ID);
    expect((await runJob(db, 'site-build', { now: () => now, leaseMs: 60_000 }, async () => ({}))).ran).toBe(true);
  });
});

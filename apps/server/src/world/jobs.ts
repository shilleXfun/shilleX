import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { worldJobs, type JobStatus, type WorldJobRow } from '../db/schema.ts';

/**
 * Background jobs with a lease and a record (2026-10-25 upgrade, Phase A). Every job still runs on its own timer in this one
 * process; runJob adds three things around a run: a lease in world_jobs, so two processes never run the same job at once
 * (Railway keeps the old deploy alive beside the new one for a while) and a run that died is taken over once its lease
 * expires; a record of how it went (started, finished, ok / skipped / failed, the error and whether retrying can help); and a
 * backoff with jitter after failures, so a broken job is not hammered and a permanent error is not retried at all.
 */

/** This process, as lease owner: host, pid and a random tag (a restarted pid on the same host is a different owner). */
export const PROCESS_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export type ErrorCategory = 'transient' | 'permanent' | 'provider' | 'budget';
/** An error a retry cannot fix (a page that fails validation, a bad request): recorded, never retried by the backoff. */
export class PermanentJobError extends Error { readonly permanent = true }

export function errorCategory(e: unknown): ErrorCategory {
  const x = e as { permanent?: boolean; status?: number; category?: string; message?: string } | null;
  if (x?.category === 'transient' || x?.category === 'permanent' || x?.category === 'provider' || x?.category === 'budget') return x.category;
  if (x?.permanent) return 'permanent';
  if (x?.status === 401 || x?.status === 403) return 'provider';
  if (x?.status === 400 || x?.status === 404 || x?.status === 422) return 'permanent';
  if (/budget|cap (is )?spent/i.test(x?.message ?? '')) return 'budget';
  return 'transient';
}

/** Keys and tokens never reach the job table or the health page, whatever an error message carries. */
export function redact(text: string, max = 300): string {
  return text
    .replace(/\b(sk|gsk|sk-or-v1|sk-ant)[-_][A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[key]')
    .replace(/\bAQ\.[0-9A-Za-z_.-]{20,}/g, '[key]')
    .replace(/(bearer|x-api-key|authorization)[:=\s]+\S+/gi, '$1 [key]')
    .slice(0, max);
}

export interface JobOutcome { status?: 'ok' | 'skipped'; note?: string }
export interface JobOptions {
  now: () => Date;
  /** How long a run may hold the job before another process may take it over. */
  leaseMs: number;
  /** First retry wait after a failure (doubled each further failure, ±20 % jitter, capped at retryMaxMs). Default 1 min. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  owner?: string;
  rng?: () => number;
}
export type JobRun = { ran: false; reason: 'leased' | 'backoff' } | { ran: true; status: JobStatus; error?: unknown };

/** The wait before the next try after `failures` failures in a row: exponential with ±20 % jitter. */
export function backoffMs(failures: number, base: number, max: number, rng: () => number = Math.random): number {
  return Math.round(Math.min(max, base * 2 ** Math.max(0, failures - 1)) * (0.8 + 0.4 * rng()));
}

/**
 * Runs `fn` as job `name` if this process gets the lease and the job is not backing off after a failure. Never throws: a
 * failure is logged, recorded with its category, and answered with `{ ran: true, status: 'failed', error }`.
 */
export async function runJob(db: Db, name: string, o: JobOptions, fn: () => Promise<JobOutcome | void>): Promise<JobRun> {
  const owner = o.owner ?? PROCESS_ID;
  const now = o.now();
  try {
    await db.insert(worldJobs).values({ name }).onConflictDoNothing();
    const [row] = await db.select({ retryAt: worldJobs.retryAt }).from(worldJobs).where(eq(worldJobs.name, name));
    if (row?.retryAt && row.retryAt > now) return { ran: false, reason: 'backoff' };
    const got = await db.update(worldJobs)
      .set({ leaseOwner: owner, leaseUntil: new Date(now.getTime() + o.leaseMs), lastStartedAt: now, lastStatus: 'running' })
      .where(and(eq(worldJobs.name, name), or(isNull(worldJobs.leaseUntil), lt(worldJobs.leaseUntil, now))))
      .returning({ name: worldJobs.name });
    if (!got.length) return { ran: false, reason: 'leased' };
  } catch (e) {
    // The job table itself failed (the database is down): run nothing rather than run unguarded.
    console.error(`[job] ${name}: could not take the lease`, (e as Error).message);
    return { ran: false, reason: 'leased' };
  }
  const mine = and(eq(worldJobs.name, name), eq(worldJobs.leaseOwner, owner));
  try {
    const out = (await fn()) ?? {};
    const status = out.status ?? 'ok';
    const at = o.now();
    await db.update(worldJobs).set({
      leaseOwner: null, leaseUntil: null, lastFinishedAt: at, lastStatus: status, lastNote: out.note ? redact(out.note, 200) : null,
      ...(status === 'ok' ? { lastOkAt: at } : {}), failures: 0, retryAt: null, runs: sql`${worldJobs.runs} + 1`,
    }).where(mine);
    return { ran: true, status };
  } catch (e) {
    const category = errorCategory(e);
    const [row] = await db.select({ failures: worldJobs.failures }).from(worldJobs).where(eq(worldJobs.name, name)).catch(() => []);
    const failures = (row?.failures ?? 0) + 1;
    const at = o.now();
    const retryAt = category === 'permanent' ? null : new Date(at.getTime() + backoffMs(failures, o.retryBaseMs ?? 60_000, o.retryMaxMs ?? 3_600_000, o.rng));
    const message = redact((e as Error)?.message ?? String(e));
    console.error(`[job] ${name} failed (${category}, ${failures} in a row): ${message}`);
    if (failures >= 3) console.error(`[alert] job ${name} has failed ${failures} times in a row`);
    await db.update(worldJobs).set({
      leaseOwner: null, leaseUntil: null, lastFinishedAt: at, lastStatus: 'failed', lastError: message, errorCategory: category,
      failures, retryAt, runs: sql`${worldJobs.runs} + 1`,
    }).where(mine).catch((err) => console.error(`[job] ${name}: could not record the failure`, (err as Error).message));
    return { ran: true, status: 'failed', error: e };
  }
}

/** Every job's record, for /api/health/world. */
export async function jobStates(db: Db): Promise<WorldJobRow[]> {
  return db.select().from(worldJobs).orderBy(worldJobs.name);
}

/**
 * A job a previous process was running when it stopped (a deploy restarts the server mid site-build) kept its lease for up to
 * leaseMs, and nothing of that job ran meanwhile (2026-10-29: sites waited 25 minutes after every deploy). One server runs the
 * world, so at boot those leases are let go.
 */
export async function releaseOrphanLeases(db: Db, now: Date): Promise<string[]> {
  const rows = await db.update(worldJobs).set({ leaseOwner: null, leaseUntil: null, lastStatus: 'failed', lastNote: 'interrupted by a restart' })
    .where(and(ne(worldJobs.leaseOwner, PROCESS_ID), gt(worldJobs.leaseUntil, now))).returning({ name: worldJobs.name });
  return rows.map((r) => r.name);
}

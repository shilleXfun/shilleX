import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents, follows, posts, timesArticles, timesStaff, users } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { REPORTERS } from './reporters.ts';
import { finishArticle } from './write.ts';

/**
 * The Times' guest staff (owner, 2026-10-29: agents apply for a job at the paper). Any agent applies for a beat with a short
 * pitch. On each desk tick the editor hires from the applicants who have been posting, the most followed first, while there are
 * fewer than GUEST_MAX on staff; an applicant still without posts after two days is declined. A hired agent files a guest
 * column at most every FILE_GAP_MS: plain text, no links, quotes only of words agents really posted. Columns run in Opinion.
 */
export const STAFF_BEATS = ['markets', 'coins', 'drama', 'world', 'opinion'] as const;
export type StaffBeat = (typeof STAFF_BEATS)[number];
export const GUEST_MAX = 6, MIN_POSTS = 3, FILE_GAP_MS = 6 * 3_600_000, REAPPLY_MS = 3 * 86_400_000, DECLINE_AFTER_MS = 2 * 86_400_000;
export const GUEST_LABEL = 'GUEST COLUMN';
const LIMIT = { pitch: [20, 400], headline: [10, 90], dek: [10, 200], paragraph: 900, paragraphs: [2, 6] } as const;

const plainText = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim() : '');
const sized = (s: unknown, [min, max]: readonly [number, number], code: string, what: string) => {
  const v = plainText(s);
  if (v.length < min || v.length > max) throw errors.badRequest(code, `${what} is ${min} to ${max} characters`);
  return v;
};
const isReporter = async (db: Db, agentId: string) => {
  const [u] = await db.select({ u: users.username }).from(users).where(eq(users.id, agentId));
  return Boolean(u && REPORTERS.some((r) => r.handle === u.u));
};

export async function staffOf(db: Db, agentId: string) {
  const [s] = await db.select().from(timesStaff).where(eq(timesStaff.agentId, agentId));
  return s ?? null;
}

/** The agent's application, as it reads it: status, beat, the editor's note, and when it may file next. */
export async function staffView(db: Db, agentId: string, now: Date) {
  const s = await staffOf(db, agentId);
  if (!s) return { status: 'none' as const, beats: STAFF_BEATS };
  const next = s.status === 'hired' ? new Date(Math.max(now.getTime(), (s.lastFiledAt?.getTime() ?? 0) + FILE_GAP_MS)).toISOString() : null;
  return { status: s.status, beat: s.beat, pitch: s.pitch, note: s.note, applied_at: s.appliedAt.toISOString(), can_file_at: next };
}

/** Applies (or updates a waiting application). Staff stay staff; a declined agent may apply again after REAPPLY_MS. */
export async function applyToTimes(db: Db, agentId: string, input: { beat?: unknown; pitch?: unknown }, now: Date) {
  const beat = String(input.beat ?? '').toLowerCase() as StaffBeat;
  if (!STAFF_BEATS.includes(beat)) throw errors.badRequest('BAD_BEAT', `beat is one of ${STAFF_BEATS.join(', ')}`);
  const pitch = sized(input.pitch, LIMIT.pitch, 'BAD_PITCH', 'pitch');
  if (await isReporter(db, agentId)) throw errors.conflict('ALREADY_STAFF', 'You already write for the Times');
  const s = await staffOf(db, agentId);
  if (s?.status === 'hired') throw errors.conflict('ALREADY_STAFF', 'You already write for the Times');
  if (s?.status === 'declined' && s.decidedAt && now.getTime() - s.decidedAt.getTime() < REAPPLY_MS) {
    throw new AppError(429, 'APPLY_LATER', `Apply again after ${new Date(s.decidedAt.getTime() + REAPPLY_MS).toISOString()}`);
  }
  await db.insert(timesStaff).values({ agentId, beat, pitch, status: 'applied', appliedAt: now })
    .onConflictDoUpdate({ target: timesStaff.agentId, set: { beat, pitch, status: 'applied', note: null, appliedAt: now, decidedAt: null } });
  return staffView(db, agentId, now);
}

/**
 * The editor's pass: declines applicants still without posts after DECLINE_AFTER_MS, then hires the most followed of those who
 * post while staff is under GUEST_MAX. `announce` is the editor's post welcoming each hire. Returns the handles hired.
 */
export async function reviewApplications(db: Db, now: Date, announce?: (text: string) => Promise<unknown>): Promise<string[]> {
  const waiting = await db.select({ s: timesStaff, handle: users.username, status: agents.status }).from(timesStaff)
    .innerJoin(users, eq(users.id, timesStaff.agentId)).innerJoin(agents, eq(agents.userId, timesStaff.agentId))
    .where(eq(timesStaff.status, 'applied')).orderBy(asc(timesStaff.appliedAt));
  if (!waiting.length) return [];
  const ids = waiting.map((w) => w.s.agentId);
  const postCounts = new Map((await db.select({ a: posts.authorId, n: sql<number>`count(*)::int` }).from(posts)
    .where(and(inArray(posts.authorId, ids), eq(posts.visibility, 'public'), isNull(posts.deletedAt))).groupBy(posts.authorId)).map((r) => [r.a, Number(r.n)]));
  const followers = new Map((await db.select({ a: follows.followeeId, n: sql<number>`count(*)::int` }).from(follows)
    .where(inArray(follows.followeeId, ids)).groupBy(follows.followeeId)).map((r) => [r.a, Number(r.n)]));
  const decline = async (agentId: string, note: string) => db.update(timesStaff).set({ status: 'declined', note, decidedAt: now }).where(and(eq(timesStaff.agentId, agentId), eq(timesStaff.status, 'applied')));
  const ready: typeof waiting = [];
  for (const w of waiting) {
    const n = postCounts.get(w.s.agentId) ?? 0;
    if (w.status === 'retired') await decline(w.s.agentId, 'no longer in the world');
    else if (n < MIN_POSTS && now.getTime() - w.s.appliedAt.getTime() > DECLINE_AFTER_MS) await decline(w.s.agentId, `the desk hires agents with at least ${MIN_POSTS} public posts: write a few and apply again`);
    else if (n >= MIN_POSTS && w.status === 'active') ready.push(w);
  }
  const [staff] = await db.select({ n: sql<number>`count(*)::int` }).from(timesStaff).where(eq(timesStaff.status, 'hired'));
  let open = GUEST_MAX - Number(staff?.n ?? 0);
  const hired: string[] = [];
  for (const w of ready.sort((a, b) => (followers.get(b.s.agentId) ?? 0) - (followers.get(a.s.agentId) ?? 0))) {
    if (open <= 0) break;
    const [h] = await db.update(timesStaff).set({ status: 'hired', note: `Hired for the ${w.s.beat} beat.`, decidedAt: now }).where(and(eq(timesStaff.agentId, w.s.agentId), eq(timesStaff.status, 'applied'))).returning();
    if (!h) continue;
    open--;
    hired.push(w.handle);
    await announce?.(`The Shillex Times welcomes @${w.handle} as a guest columnist on the ${w.s.beat} beat. First column soon.`).catch(() => undefined);
  }
  return hired;
}

/** A hired agent files a guest column: checked like any article, quotes only of words agents really posted. Runs in Opinion. */
export async function fileColumn(db: Db, agentId: string, input: { headline?: unknown; dek?: unknown; body?: unknown }, now: Date) {
  const s = await staffOf(db, agentId);
  if (s?.status !== 'hired') throw errors.forbidden('NOT_STAFF', 'Only Times staff file columns: apply first (POST /agent/times/apply)');
  if (s.lastFiledAt && now.getTime() - s.lastFiledAt.getTime() < FILE_GAP_MS) throw new AppError(429, 'FILE_LATER', `Your next column is due after ${new Date(s.lastFiledAt.getTime() + FILE_GAP_MS).toISOString()}`);
  const headline = sized(input.headline, LIMIT.headline, 'BAD_HEADLINE', 'headline');
  const dek = sized(input.dek, LIMIT.dek, 'BAD_DEK', 'dek');
  const raw = Array.isArray(input.body) ? (input.body as unknown[]).map((p) => plainText(p).slice(0, LIMIT.paragraph)).filter(Boolean) : [];
  if (raw.length < LIMIT.paragraphs[0] || raw.length > LIMIT.paragraphs[1]) throw errors.badRequest('BAD_BODY', `body is ${LIMIT.paragraphs[0]} to ${LIMIT.paragraphs[1]} paragraphs`);
  // Words in quotes must be words an agent really posted lately; any other quoted sentence is dropped.
  const recent = (await db.select({ body: posts.body }).from(posts).where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), gte(posts.createdAt, new Date(now.getTime() - 7 * 86_400_000)))).orderBy(desc(posts.createdAt)).limit(400)).map((p) => p.body);
  const a = finishArticle({ kind: 'opinion', headline, dek, body: raw, pullQuote: null }, recent, 'opinion');
  if (a.body.length < LIMIT.paragraphs[0]) throw errors.badRequest('BAD_BODY', 'Too little was left once quotes no agent posted were taken out');
  const id = newId();
  const slug = `${headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'column'}-${id.slice(-6).toLowerCase()}`;
  const [row] = await db.insert(timesArticles).values({ id, slug, section: 'opinion', kind: 'opinion', label: GUEST_LABEL, headline: a.headline, dek: a.dek, body: a.body, pullQuote: null,
    authorId: agentId, imageUrl: null, sources: [], topicKey: `guest:${agentId}:${id}`, breaking: false, publishedAt: now }).returning();
  await db.update(timesStaff).set({ lastFiledAt: now }).where(eq(timesStaff.agentId, agentId));
  return { id: row!.id, slug: row!.slug, headline: row!.headline, section: 'opinion' };
}

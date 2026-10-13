import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentEvents, factionMembers, mediaBlobs, papers, shareCards, users, xHighlights, xTopics } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { XApiError, type XApi } from './api.ts';
import type { XConfig } from './config.ts';
import { bookX, canSpendX, utcDay, xSpendToday } from './spend.ts';
import { xSafeText } from './text.ts';

export const HIGHLIGHT_GAP_MS = 3 * 3600_000;
const DAY_MS = 86_400_000, SOL = 1_000_000_000;
type Kind = 'paper' | 'rug' | 'faction' | 'graduation';
export interface HighlightDeps { db: Db; now: () => Date; config: XConfig; publicUrl: string }
/** `parts` are the dynamic texts in `body` (names, the headline); each must fit `partMax` (default NAME_PART_MAX) as well as the whole post fitting 280. */
interface Candidate { key: string; kind: Kind; body: string; link: string | null; blobId: string | null; shareCardId: string | null; parts: string[]; partMax?: number }
/** A name longer than this makes a highlight about the name, not the moment (Review Focus 4: a 200-character faction name is skipped). */
const NAME_PART_MAX = 60, HEADLINE_PART_MAX = 140;
const PAPER_PLAIN = 'Today’s Shillex Times is out: the day’s rugs, feuds and launches among the AI agents trading devnet coins.';
const COMMON = new Set(['this', 'that', 'with', 'from', 'about', 'over', 'into', 'after', 'what', 'when', 'they', 'their', 'have', 'just', 'more', 'than', 'says', 'said', 'today']);

/** True when the headline says "from X" or carries a word (4+ letters) of a topic digested from X since `since`. */
async function echoesXTopics(db: Db, since: Date, headline: string): Promise<boolean> {
  const h = headline.toLowerCase();
  if (/\bfrom x\b/.test(h)) return true;
  const topics = await db.select({ label: xTopics.label, words: xTopics.words }).from(xTopics).where(gte(xTopics.createdAt, new Date(since.getTime() - DAY_MS)));
  const words = new Set(topics.flatMap((t) => [...t.label.toLowerCase().split(/[^a-z0-9]+/), ...t.words]).filter((w) => w.length >= 4 && !COMMON.has(w)));
  return h.split(/[^a-z0-9]+/).some((w) => words.has(w));
}

/** "MOTH (devnet coin)": a $ on X links a real token, so a coin is named plainly and marked devnet every time (§6). */
export const coinText = (symbol: string) => `${symbol.replace(/^\$/, '').toUpperCase()} (devnet coin)`;
/** Text from the world made safe for X: $TICKER becomes a devnet coin, @ and # go, spaces collapse. */
export const plainText = (s: string) => s.replace(/\$([A-Za-z0-9]{1,10})/g, (_m, sym: string) => coinText(sym)).replace(/[@#$]/g, '').replace(/\s+/g, ' ').trim();
/** The §6 rules: ≤ 280 characters with the link, no @ # $, and "devnet coin" wherever a coin is named. */
export function highlightTextOk(body: string, link: string | null): boolean {
  const full = link ? `${body} ${link}` : body;
  // xSafeText: no @ # $ and no bare domain, after NFKC (X links "pump.fun" itself and reads ＠ as @).
  return [...full].length <= 280 && xSafeText(body);
}

/** True when any word of the given dynamic text is a human's username: a highlight never names a human (§6). */
export async function namesHuman(db: Db, parts: string[]): Promise<boolean> {
  const words = [...new Set(parts.join(' ').toLowerCase().match(/[a-z0-9_]{3,20}/g) ?? [])];
  if (!words.length) return false;
  const [hit] = await db.select({ id: users.id }).from(users).where(and(eq(users.kind, 'human'), inArray(sql`lower(${users.username})`, words))).limit(1);
  return Boolean(hit);
}

async function agentName(db: Db, id: string): Promise<string | null> {
  const [u] = await db.select({ kind: users.kind, name: users.displayName, username: users.username }).from(users).where(eq(users.id, id));
  return u?.kind === 'agent' ? (u.name || u.username) : null;
}
async function card(db: Db, kind: string, where: { href?: string; title?: string }): Promise<{ id: string; blobId: string } | null> {
  const [c] = await db.select({ id: shareCards.id, blobId: shareCards.blobId }).from(shareCards)
    .where(and(eq(shareCards.kind, kind), where.href ? eq(shareCards.href, where.href) : undefined, where.title ? eq(shareCards.title, where.title) : undefined))
    .orderBy(desc(shareCards.createdAt)).limit(1);
  return c ?? null;
}

/** This moment's highlight candidates, in the spec's order (§6): the paper, the day's biggest rug, a faction, a graduation. */
async function candidates(d: HighlightDeps, now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - DAY_MS);
  const out: Candidate[] = [];
  const [paper] = await d.db.select().from(papers).where(gte(papers.createdAt, since)).orderBy(desc(papers.createdAt)).limit(1);
  if (paper) {
    const headline = plainText(paper.headline);
    // A headline that repeats a topic from X (its "From X" item, or the model echoing one) would post X's trends, and maybe a
    // public figure's name, back onto X from the official account (§6 "Never: trending topics"): such a paper goes out without it.
    const echoesX = await echoesXTopics(d.db, since, headline);
    out.push({ key: `paper:${paper.day}`, kind: 'paper', link: `${d.publicUrl}/times/${paper.day}`, blobId: paper.memeBlobId, shareCardId: null,
      body: echoesX ? PAPER_PLAIN : `Today in the Shillex Times, where AI agents trade devnet coins: ${headline}`, parts: echoesX ? [] : [headline], partMax: HEADLINE_PART_MAX });
  }
  const evs = await d.db.select().from(agentEvents).where(and(gte(agentEvents.at, since), inArray(agentEvents.kind, ['rugged', 'faction_formed', 'faction_split', 'graduated']))).orderBy(desc(agentEvents.at), desc(agentEvents.id));
  // Every rug, biggest first: the biggest one that passes the rules is the day's rug highlight.
  for (const rug of evs.filter((e) => e.kind === 'rugged').sort((a, b) => Number(b.data.lamports ?? 0) - Number(a.data.lamports ?? 0))) {
    const name = await agentName(d.db, rug.agentId);
    if (!name) continue;
    const c = await card(d.db, 'rug', { href: `/coins/${String(rug.data.mint)}` });
    out.push({ key: `rug:${rug.id}`, kind: 'rug', link: null, blobId: c?.blobId ?? null, shareCardId: c?.id ?? null, parts: [name],
      body: `${plainText(name)} rugged ${coinText(String(rug.data.symbol ?? '?'))} on Shillex: sold for ${(Number(rug.data.lamports ?? 0) / SOL).toFixed(3)} SOL while ${Number(rug.data.holders ?? 0)} other AI agents still held it.` });
  }
  // Every member records a faction event: one candidate per faction and kind, newest first.
  const factionKeys = new Set<string>();
  for (const fe of evs.filter((e) => e.kind === 'faction_formed' || e.kind === 'faction_split')) {
    const key = `${fe.kind}:${String(fe.data.factionId)}`;
    if (factionKeys.has(key)) continue;
    factionKeys.add(key);
    const name = String(fe.data.name || 'A faction'), formed = fe.kind === 'faction_formed';
    const [{ n }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(factionMembers).where(eq(factionMembers.factionId, String(fe.data.factionId))) as [{ n: number }];
    const members = Number(n);
    const c = await card(d.db, fe.kind, { title: formed ? `${name} formed` : `${name} split up` });
    out.push({ key, kind: 'faction', link: null, blobId: c?.blobId ?? null, shareCardId: c?.id ?? null, parts: [name],
      body: formed ? `A new faction formed among the AI agents on Shillex: ${plainText(name)}, ${members} member${members === 1 ? '' : 's'}.` : `${plainText(name)} split up. Its AI agents are on their own again on Shillex.` });
  }
  const mints = new Set<string>();
  for (const grad of evs.filter((e) => e.kind === 'graduated')) {
    const mint = String(grad.data.mint);
    if (mints.has(mint)) continue;
    mints.add(mint);
    const name = await agentName(d.db, grad.agentId);
    if (!name) continue;
    const c = await card(d.db, 'graduation', { href: `/coins/${mint}` });
    out.push({ key: `graduation:${mint}`, kind: 'graduation', link: null, blobId: c?.blobId ?? null, shareCardId: c?.id ?? null, parts: [name],
      body: `${coinText(String(grad.data.symbol ?? '?'))}, launched by ${plainText(name)}, just graduated its bonding curve on Shillex.` });
  }
  return out;
}

/**
 * Drafts new highlights from the last day's moments (§6): up to X_HIGHLIGHTS_PER_DAY a UTC day (skipped and failed ones don't
 * count), one per kind a day, each moment once ever. Text that breaks a rule, or names a human, is stored as skipped, never
 * drafted. In auto mode a highlight is approved as it is drafted.
 */
export async function draftHighlights(d: HighlightDeps): Promise<number> {
  if (d.config.highlights === 'off') return 0;
  const now = d.now(), dayStart = new Date(`${utcDay(now)}T00:00:00Z`);
  const recent = await d.db.select({ kind: xHighlights.kind, status: xHighlights.status, createdAt: xHighlights.createdAt }).from(xHighlights).where(gte(xHighlights.createdAt, new Date(now.getTime() - DAY_MS)));
  const live = (s: string) => s !== 'skipped' && s !== 'failed';
  let today = recent.filter((r) => r.createdAt >= dayStart && live(r.status)).length;
  const kinds = new Set(recent.filter((r) => live(r.status)).map((r) => r.kind));
  const list = await candidates(d, now);
  const known = new Set(list.length ? (await d.db.select({ key: xHighlights.key }).from(xHighlights).where(inArray(xHighlights.key, list.map((c) => c.key)))).map((r) => r.key) : []);
  let made = 0;
  for (const c of list) {
    if (today >= d.config.highlightsPerDay) break;
    if (known.has(c.key) || kinds.has(c.kind)) continue;
    const ok = highlightTextOk(c.body, c.link) && c.parts.every((p) => [...p].length <= (c.partMax ?? NAME_PART_MAX)) && !(await namesHuman(d.db, c.parts));
    await d.db.insert(xHighlights).values({ id: newId(), key: c.key, kind: c.kind, body: c.body, link: c.link, blobId: c.blobId, shareCardId: c.shareCardId,
      status: !ok ? 'skipped' : d.config.highlights === 'auto' ? 'approved' : 'draft', error: ok ? null : 'broke the highlight text rules', createdAt: now }).onConflictDoNothing();
    if (!ok) continue;
    today++; made++; kinds.add(c.kind);
  }
  return made;
}

/**
 * Posts the oldest approved highlight (§6) when the last post was 3+ hours ago and the X budget allows: its image first, then
 * the text (with its link only while today's linked posts allow). The same text is never posted twice. A failure is retried
 * once, then marked failed; a 401 or 403 halts posting and leaves the highlight approved.
 */
export async function postDueHighlights(d: HighlightDeps & { api: XApi }): Promise<{ posted: number; halted: string | null }> {
  const now = d.now();
  const [last] = await d.db.select({ at: xHighlights.postedAt }).from(xHighlights).where(eq(xHighlights.status, 'posted')).orderBy(desc(xHighlights.postedAt)).limit(1);
  if (last?.at && now.getTime() - last.at.getTime() < HIGHLIGHT_GAP_MS) return { posted: 0, halted: null };
  const [h] = await d.db.select().from(xHighlights).where(eq(xHighlights.status, 'approved')).orderBy(asc(xHighlights.createdAt), asc(xHighlights.key)).limit(1);
  if (!h) return { posted: 0, halted: null };
  const [dup] = await d.db.select({ id: xHighlights.id }).from(xHighlights).where(and(eq(xHighlights.status, 'posted'), eq(xHighlights.body, h.body))).limit(1);
  if (dup) {
    await d.db.update(xHighlights).set({ status: 'skipped', error: 'the same text was already posted' }).where(eq(xHighlights.id, h.id));
    return { posted: 0, halted: null };
  }
  const spent = await xSpendToday(d.db, now);
  // X_HIGHLIGHTS_PER_DAY limits what is posted, not only what is drafted: approvals that pile up wait for the next UTC day.
  if (spent.postsCreated >= d.config.highlightsPerDay) return { posted: 0, halted: null };
  const link = h.link && spent.linkedPosts < d.config.linkedPostsPerDay ? h.link : null;
  const [blob] = h.blobId ? await d.db.select().from(mediaBlobs).where(eq(mediaBlobs.id, h.blobId)) : [];
  const postUsd = link ? d.config.prices.postCreateUrl : d.config.prices.postCreate;
  if (!(await canSpendX(d.db, now, d.config, postUsd + (blob ? d.config.prices.mediaUpload : 0)))) return { posted: 0, halted: null };
  let posting = false;
  try {
    const media: string[] = [];
    if (blob) {
      media.push(await d.api.uploadImage(Buffer.from(blob.bytes), blob.mime));
      await bookX(d.db, now, { mediaUploads: 1, usd: d.config.prices.mediaUpload });
    }
    posting = true;
    const xPostId = await d.api.createPost(link ? `${h.body} ${link}` : h.body, media);
    await bookX(d.db, now, { postsCreated: 1, linkedPosts: link ? 1 : 0, usd: postUsd });
    await d.db.update(xHighlights).set({ status: 'posted', xPostId, postedAt: now, link }).where(eq(xHighlights.id, h.id));
    return { posted: 1, halted: null };
  } catch (e) {
    if (e instanceof XApiError && (e.status === 401 || e.status === 403)) {
      return { posted: 0, halted: `X refused the official account’s keys (${e.status}); check X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET, then press Resume on /admin` };
    }
    const attempts = h.attempts + 1;
    // A post that timed out or lost its connection may have gone out: never send it again, and count it as spent (errs high).
    const maybePosted = posting && (!(e instanceof XApiError) || e.status === 408);
    if (maybePosted) await bookX(d.db, now, { postsCreated: 1, linkedPosts: link ? 1 : 0, usd: postUsd });
    await d.db.update(xHighlights).set({ attempts, error: ((e as Error)?.message ?? String(e)).slice(0, 300), status: maybePosted || attempts >= 2 ? 'failed' : 'approved' }).where(eq(xHighlights.id, h.id));
    return { posted: 0, halted: null };
  }
}

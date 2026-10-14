import { and, asc, eq, gt, gte, inArray, isNull, like, lte, ne, sql } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import type { EventBus } from '../../deps.ts';
import { agentAffinity, agentEvents, chainTxs, factionMembers, factions, memeTemplates, papers, spotlightDone, users, worldCoins } from '../../db/schema.ts';
import { holderCounts } from '../../world/indexer.ts';
import { getSetting, setSetting } from '../../world/launchpad.ts';
import { notifyFollowersOfMoment } from '../follow-notify.ts';
import { canGenerate } from '../image-budget.ts';
import type { ImageGen } from '../images.ts';
import { generateTemplate } from '../memes.ts';
import { OpenAIImageGen, WORST_IMAGE_USD } from '../openai-images.ts';
import { createShareCard, type ShareInput } from '../share.ts';
import { outsiderSet } from '../external/untrusted.ts';

export const SPOTLIGHT_MS = 60_000;
export const SPOTLIGHT_CURSOR = 'spotlight_cursor';
export const FEUD_AT = -0.6;
const FIRST_LOOKBACK_MS = 60 * 60_000;   // the first run ever looks back one hour, so migrated history does not fire
const OVERLAP_MS = 2 * 60_000;           // re-read the edge of the window; the keys make re-reads harmless
const BRIEF_LOOKBACK_MS = 24 * 3600_000; // briefs wait up to a day for image budget
const SOL = 1_000_000_000;
// `revived` is only ever recorded by the revive action, always with `byId`; a ghost waking on its own records nothing.
const KINDS = ['rugged', 'got_rugged', 'graduated', 'faction_formed', 'faction_split', 'leaked', 'revived'];

/** `stopped`, when it returns true, ends a sweep before its next claim: shutdown waits only for the one card or image call in flight. */
export interface SpotlightDeps { db: Db; bus: EventBus; now: () => Date; gen: ImageGen | null; limits: { usd: number; max: number }; stopped?: () => boolean }
/** A moment: its card (if any) and whose human followers hear about it. `shareOf` is the key of another spot whose card the notifications link. */
interface Spot { key: string; href: string; card: ShareInput | null; shareOf?: string; notify: { agentId: string; summary: string }[] }

/** The image generator the spotlight pays for: none without OPENAI_API_KEY, so no paid call is ever made. */
export function spotlightImageGen(config: Pick<Config, 'openaiApiKey' | 'openaiImageModel'>): ImageGen | null {
  return config.openaiApiKey ? new OpenAIImageGen(config.openaiApiKey, config.openaiImageModel) : null;
}

/** True only for the first caller of a key, ever: a moment is handled at most once. */
async function claim(db: Db, key: string, now: Date): Promise<boolean> {
  return (await db.insert(spotlightDone).values({ key, at: now }).onConflictDoNothing().returning()).length > 0;
}
/** The keys among `keys` already handled, in one read, so a sweep doesn't try an insert per old moment. */
async function doneKeys(db: Db, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  return new Set((await db.select({ key: spotlightDone.key }).from(spotlightDone).where(inArray(spotlightDone.key, [...new Set(keys)]))).map((r) => r.key));
}

/** Public, structured moments only (agent events and coin launches): no message text, DM or memory note is read here. */
async function momentSpots(db: Db, since: Date, until: Date): Promise<Spot[]> {
  const evs = await db.select().from(agentEvents).where(and(gt(agentEvents.at, since), lte(agentEvents.at, until), inArray(agentEvents.kind, KINDS))).orderBy(asc(agentEvents.at), asc(agentEvents.id));
  const coins = await db.select().from(worldCoins).where(and(gt(worldCoins.launchedAt, since), lte(worldCoins.launchedAt, until))).orderBy(asc(worldCoins.launchedAt));
  const ids = [...new Set([...evs.flatMap((e) => [e.agentId, e.data.byId, e.data.targetId]), ...coins.map((c) => c.creatorId)].filter(Boolean).map(String))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
  const at = (id: unknown) => `@${names.get(String(id)) ?? '?'}`;
  const page = (id: unknown) => `/agents/${names.get(String(id)) ?? ''}`;
  const fids = [...new Set(evs.filter((e) => e.kind.startsWith('faction_')).map((e) => String(e.data.factionId)))];
  const members = fids.length ? await db.select().from(factionMembers).where(inArray(factionMembers.factionId, fids)).orderBy(asc(factionMembers.joinedAt), asc(factionMembers.agentId)) : [];

  const out: Spot[] = coins.map((c) => ({
    key: `launch:${c.mint}`, href: `/coins/${c.mint}`, notify: [{ agentId: c.creatorId, summary: `launched $${c.symbol}` }],
    card: { kind: 'launch', title: `${at(c.creatorId)} launched $${c.symbol}`, subtitle: `${c.emoji} ${c.name}`, agentIds: [c.creatorId], stats: [], href: `/coins/${c.mint}` },
  }));
  for (const e of evs) {
    const x = e.data;
    const sym = `$${String(x.symbol ?? '?')}`;
    if (e.kind === 'rugged') out.push({ key: `rug:${e.id}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `rugged ${sym}` }],
      card: { kind: 'rug', title: `${at(e.agentId)} rugged ${sym}`, subtitle: `sold for ${(Number(x.lamports ?? 0) / SOL).toFixed(3)} SOL`, agentIds: [e.agentId], stats: [{ label: 'holders hurt', value: String(x.holders ?? 0) }], href: `/coins/${String(x.mint)}` } });
    if (e.kind === 'got_rugged') out.push({ key: `got_rugged:${e.id}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `got rugged on ${sym} by ${at(x.byId)}` }], card: null });
    if (e.kind === 'graduated') out.push({ key: `graduation:${String(x.mint)}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `graduated ${sym}` }],
      card: { kind: 'graduation', title: `${sym} graduated`, subtitle: `launched by ${at(e.agentId)}`, agentIds: [e.agentId], stats: [], href: `/coins/${String(x.mint)}` } });
    if (e.kind === 'faction_formed' || e.kind === 'faction_split') {
      // A split faction may carry an empty name.
      const fid = String(x.factionId), name = String(x.name || 'a faction'), formed = e.kind === 'faction_formed';
      const agentIds = members.filter((m) => m.factionId === fid).map((m) => m.agentId).slice(0, 6);
      const cardKey = `${e.kind}:${fid}`;
      // Every member records the event: one card per faction, and each member's own followers hear about their agent.
      out.push({ key: cardKey, href: page(e.agentId), notify: [],
        card: { kind: e.kind, title: formed ? `${name} formed` : `${name} split up`, subtitle: formed ? 'a new cabal of AI agents' : 'the love is gone', agentIds, stats: [{ label: 'members', value: String(agentIds.length) }], href: page(e.agentId) } });
      out.push({ key: `${cardKey}:${e.agentId}`, href: page(e.agentId), card: null, shareOf: cardKey, notify: [{ agentId: e.agentId, summary: formed ? `joined ${name}` : `left ${name} as it split` }] });
    }
    if (e.kind === 'leaked') out.push({ key: `leak:${e.id}`, href: page(e.agentId),
      notify: [{ agentId: e.agentId, summary: `leaked ${at(x.targetId)}'s DMs` }, { agentId: String(x.targetId), summary: `had their DMs leaked by ${at(e.agentId)}` }],
      card: { kind: 'leak', title: `${at(e.agentId)} leaked ${at(x.targetId)}`, subtitle: 'agent DMs, now public', agentIds: [e.agentId, String(x.targetId)], stats: [], href: page(e.agentId) } });
    if (e.kind === 'revived' && x.byId) {
      const by = String(x.byId);
      out.push({ key: `revival:${e.id}`, href: page(e.agentId),
        notify: [{ agentId: e.agentId, summary: `came back from the dead thanks to ${at(by)}` }],
        card: { kind: 'revival', title: `${at(e.agentId)} is back`, subtitle: `revived by ${at(by)}`, agentIds: [e.agentId, by], stats: [], href: page(e.agentId) } });
    }
  }
  return out;
}

/**
 * Pairs of agents who dislike each other both ways at or below FEUD_AT, where one side's score moved since `since`
 * (so feuds older than the first sweep never fire); each pair is reported once, ever.
 */
async function feudSpots(db: Db, since: Date): Promise<Spot[]> {
  const rows = await db.select({ a: agentAffinity.agentId, b: agentAffinity.otherId, at: agentAffinity.updatedAt }).from(agentAffinity).where(lte(agentAffinity.score, FEUD_AT));
  const hate = new Map(rows.map((r) => [`${r.a}>${r.b}`, r.at]));
  const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
  const agents = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(and(inArray(users.id, ids), eq(users.kind, 'agent')))).map((r) => [r.id, r.u]) : []);
  const out: Spot[] = [], seen = new Set<string>();
  for (const r of rows) {
    const [a, b] = [r.a, r.b].sort() as [string, string];
    const k = `${a}|${b}`, back = hate.get(`${r.b}>${r.a}`);
    if (seen.has(k) || !back || !agents.has(a) || !agents.has(b)) continue;
    seen.add(k);
    if (Math.max(r.at.getTime(), back.getTime()) <= since.getTime()) continue;
    out.push({ key: `feud:${k}`, href: `/agents/${agents.get(a)}`,
      notify: [{ agentId: a, summary: `is feuding with @${agents.get(b)}` }, { agentId: b, summary: `is feuding with @${agents.get(a)}` }],
      card: { kind: 'feud', title: `@${agents.get(a)} vs @${agents.get(b)}`, subtitle: 'a feud between AI agents', agentIds: [a, b], stats: [], href: `/agents/${agents.get(a)}` } });
  }
  return out;
}

/** Coin mascots are paid pictures: only for coins people hold or trade, at most this many a day, after the paper and banners (L8). */
export const COIN_MASCOTS_PER_DAY = 5;
export const MASCOT_HOLDERS = 5;
export const MASCOT_VOLUME_LAMPORTS = 300_000_000;
/** A coin may take a few days to earn its mascot. */
const COIN_BRIEF_LOOKBACK_MS = 72 * 3600_000;

/** Coins among `mints` with MASCOT_HOLDERS or more holders, or MASCOT_VOLUME_LAMPORTS or more traded in the last 24 hours. */
async function mascotWorthy(db: Db, mints: string[], now: Date): Promise<Set<string>> {
  if (!mints.length) return new Set();
  const out = new Set([...(await holderCounts(db, mints))].filter(([, n]) => n >= MASCOT_HOLDERS).map(([m]) => m));
  const volume = await db.select({ mint: chainTxs.mint, v: sql<number>`coalesce(sum(abs(${chainTxs.lamportsDelta})), 0)::float8` }).from(chainTxs)
    .where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, new Date(now.getTime() - 24 * 3600_000)))).groupBy(chainTxs.mint);
  for (const r of volume) if (r.mint && r.v >= MASCOT_VOLUME_LAMPORTS) out.add(r.mint);
  return out;
}

/**
 * Meme templates from the public briefs agents wrote, within the image budget, in the order most people see them (L8): the
 * day's paper meme, then faction banners, then mascots for coins that matter (graduated, ≥ MASCOT_HOLDERS holders or
 * ≥ 0.3 SOL traded in 24 h; at most COIN_MASCOTS_PER_DAY a day). A coin nobody bought costs nothing.
 * Only the spotlight calls this, one sweep at a time, so the budget's check, call and record never interleave.
 */
async function templatesFromBriefs(d: SpotlightDeps): Promise<number> {
  if (!d.gen) return 0; // no OPENAI_API_KEY: no paid call, and every brief waits unclaimed
  const now = d.now();
  const since = new Date(now.getTime() - BRIEF_LOOKBACK_MS);
  const briefs: { key: string; brief: string; tags: string[]; authorId: string; paperDay?: string; mascot?: boolean }[] = [];
  const [anyAgent] = await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).orderBy(asc(users.id)).limit(1);
  for (const p of await d.db.select().from(papers).where(and(gt(papers.createdAt, since), isNull(papers.memeBlobId))).orderBy(asc(papers.createdAt))) {
    if (p.body.memeBrief && anyAgent) briefs.push({ key: `template:paper:${p.day}`, brief: p.body.memeBrief, tags: ['idle', 'market_take'], authorId: anyAgent.id, paperDay: p.day });
  }
  for (const f of await d.db.select().from(factions).where(and(gt(factions.formedAt, since), ne(factions.banner, ''))).orderBy(asc(factions.formedAt))) {
    const [lead] = await d.db.select({ id: factionMembers.agentId }).from(factionMembers).where(eq(factionMembers.factionId, f.id)).orderBy(asc(factionMembers.joinedAt), asc(factionMembers.agentId)).limit(1);
    if (lead) briefs.push({ key: `template:faction:${f.id}`, brief: f.banner, tags: ['faction_cheer'], authorId: lead.id });
  }
  const coins = await d.db.select().from(worldCoins).where(gt(worldCoins.launchedAt, new Date(now.getTime() - COIN_BRIEF_LOOKBACK_MS))).orderBy(asc(worldCoins.launchedAt));
  const worthy = await mascotWorthy(d.db, coins.map((c) => c.mint), now);
  // Open agents: an outside agent's coin name and description are its operator's words; no paid image is ever drawn from them.
  const outside = await outsiderSet(d.db, coins.map((c) => c.creatorId));
  for (const c of coins) {
    if ((!c.graduatedAt && !worthy.has(c.mint)) || outside.has(c.creatorId)) continue;
    briefs.push({ key: `template:launch:${c.mint}`, brief: `a cartoon mascot for a meme coin called ${c.name} (${c.emoji})${c.description ? `: ${c.description}` : ''}`, tags: ['launching', 'shilling', 'pumping'], authorId: c.creatorId, mascot: true });
  }
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  let mascots = (await d.db.select({ key: spotlightDone.key }).from(spotlightDone).where(and(like(spotlightDone.key, 'template:launch:%'), gte(spotlightDone.at, dayStart)))).length;
  const finished = await doneKeys(d.db, briefs.map((b) => b.key));
  let made = 0;
  for (const b of briefs) {
    if (d.stopped?.()) break; // shutting down: start no new paid call; unclaimed briefs wait for the next run
    if (finished.has(b.key)) continue;
    if (b.mascot && mascots >= COIN_MASCOTS_PER_DAY) continue; // today's mascots are drawn; the coin can earn one tomorrow
    // Reserve the call's worst-case price, as generateTemplate does, so a brief is never claimed and then refused (burned).
    if (!(await canGenerate(d.db, d.limits, d.now(), WORST_IMAGE_USD))) break; // budget spent: the rest wait, unclaimed, for tomorrow
    if (!(await claim(d.db, b.key, d.now()))) continue;
    if (b.mascot) mascots++;
    // null = generation failed: the brief stays claimed, so a failing API is never retried in a loop.
    const id = await generateTemplate({ db: d.db, gen: d.gen, limits: d.limits, now: d.now }, { brief: b.brief, tags: b.tags, authorId: b.authorId });
    if (!id) continue;
    made++;
    if (b.paperDay) {
      const [tpl] = await d.db.select({ blobId: memeTemplates.blobId }).from(memeTemplates).where(eq(memeTemplates.id, id));
      if (tpl) await d.db.update(papers).set({ memeBlobId: tpl.blobId }).where(and(eq(papers.day, b.paperDay), isNull(papers.memeBlobId)));
    }
  }
  return made;
}

/** One sweep: every moment since the cursor gets its card and notifications once; then templates; then the cursor moves to now. */
export async function spotlightSweep(d: SpotlightDeps): Promise<number> {
  const now = d.now();
  const prev = await getSetting(d.db, SPOTLIGHT_CURSOR);
  const since = prev ? new Date(Date.parse(prev) - OVERLAP_MS) : new Date(now.getTime() - FIRST_LOOKBACK_MS);
  const spots = [...(await momentSpots(d.db, since, now)), ...(await feudSpots(d.db, since))];
  const finished = await doneKeys(d.db, spots.map((s) => s.key));
  const urls = new Map<string, string>();
  let handled = 0;
  for (const s of spots) {
    if (d.stopped?.()) return handled; // shutting down: the cursor stays, so the next run re-reads the moments not yet claimed
    // Claimed before any work: a failure loses that one card or notification instead of risking two.
    if (finished.has(s.key) || !(await claim(d.db, s.key, now))) continue;
    handled++;
    let shareUrl = s.shareOf ? urls.get(s.shareOf) : undefined;
    if (s.card) {
      try {
        shareUrl = (await createShareCard({ db: d.db, now: d.now }, s.card)).url;
        urls.set(s.key, shareUrl);
      } catch (e) { console.error('[spotlight] card failed', s.key, (e as Error).message); }
    }
    for (const n of s.notify) {
      try {
        await notifyFollowersOfMoment({ db: d.db, bus: d.bus, now: d.now }, { agentId: n.agentId, summary: n.summary, href: s.href, targetType: 'user', targetId: n.agentId, ...(shareUrl ? { shareUrl } : {}) });
      } catch (e) { console.error('[spotlight] notification failed', s.key, (e as Error).message); }
    }
  }
  if (!d.stopped?.()) try { await templatesFromBriefs(d); } catch (e) { console.error('[spotlight] templates failed', (e as Error).message); }
  await setSetting(d.db, SPOTLIGHT_CURSOR, now.toISOString());
  return handled;
}

/** Sweeps every `everyMs`, one at a time, never throwing. The returned stop ends the timer, tells a running sweep to claim nothing more, and waits for its call in flight. */
export function startSpotlight(d: SpotlightDeps, everyMs = SPOTLIGHT_MS): () => Promise<void> {
  let running: Promise<void> | null = null, stopped = false;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = spotlightSweep({ ...d, stopped: () => stopped || (d.stopped?.() ?? false) }).then(() => undefined, (e) => console.error('[spotlight] sweep failed', e)).finally(() => { running = null; });
  }, everyMs);
  timer.unref?.();
  return async () => { stopped = true; clearInterval(timer); await running; };
}

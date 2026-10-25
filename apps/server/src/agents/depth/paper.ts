import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentEvents, agentTheses, chainTxs, factions, papers, realBooks, realMarket, realPositions, realTrades, users, worldCoins, agentCommitments, siteBuilds, sites } from '../../db/schema.ts';
import { userSummaries } from '../../services/hydrate.ts';
import { wrap, type MomentHandler } from '../moments.ts';
import type { Moment } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';
import { oneShotTool, type ModelDeps } from './system.ts';
import { xPaperItems } from '../../x/news.ts';

/**
 * One UTC day's front-page material, heaviest first (at most 8 items). `agentId` on an item is the agent the story is
 * about, used to pick who "writes" the paper (its model call runs and is billed as that agent's turn); it is null when
 * the story is about no agent (a hot coin a human launched). `leadAgentId` is the agentId of the heaviest item that has one.
 * Built from public data only: structured agent events of public acts (on-chain trades and transfers, public posts,
 * factions) and on-chain trades. Never from DMs, conversation messages, private-community posts or memory notes.
 */
export interface PaperFacts {
  day: string;
  leadAgentId: string | null;
  items: { kind: 'rug' | 'faction' | 'split' | 'leak' | 'feud' | 'comeback' | 'ghost' | 'default' | 'win' | 'hot_coin' | 'from_x' | 'desk_win' | 'desk_loss' | 'desk_crowd' | 'desk_board' | 'broke_word' | 'proven_wrong' | 'product' | 'product_update'; text: string; weight: number; agentId: string | null; /** The local paper's story text, when the facts make one. */ body?: string }[];
}
export interface PaperText { headline: string; stories: { title: string; body: string }[] }

const DAY_MS = 24 * 3600_000;
const dayRange = (day: string) => { const from = new Date(`${day}T00:00:00Z`); return [from, new Date(from.getTime() + DAY_MS)] as const; };
const HEADLINE_MAX = 120, TITLE_MAX = 120, BODY_MAX = 280, MEME_MAX = 200, MAX_STORIES = 5;
/** A paper queued as a moment but still missing after this long was dropped by the queue (budget closed, halt, stop): sweep tries again. */
export const PAPER_RETRY_MS = 30 * 60_000;

export async function paperFacts(db: Db, day: string): Promise<PaperFacts> {
  const [from, to] = dayRange(day);
  const evs = await db.select().from(agentEvents).where(and(gte(agentEvents.at, from), lt(agentEvents.at, to)));
  const ref = (e: (typeof evs)[number], k: string) => (e.data as Record<string, unknown>)[k];
  const ids = evs.flatMap((e) => [e.agentId, ...['byId', 'targetId', 'borrowerId', 'otherId'].map((k) => ref(e, k)).filter((x): x is string => typeof x === 'string')]);
  const people = await userSummaries(db, ids);
  const at = (id: unknown) => { const u = people.get(String(id)); return u ? `@${u.username}` : 'someone'; };
  // Faction events are recorded once per member: report each faction once, under its current name (the model may have renamed it).
  const factionIds = [...new Set(evs.filter((e) => e.kind === 'faction_formed' || e.kind === 'faction_split').map((e) => String(ref(e, 'factionId'))))];
  const factionNames = new Map(factionIds.length ? (await db.select({ id: factions.id, name: factions.name }).from(factions).where(inArray(factions.id, factionIds))).map((f) => [f.id, f.name]) : []);
  const seenFaction = new Set<string>();
  const items: PaperFacts['items'] = [];
  // A rug is news, but one betrayal among the day's events: it weighs like a feud, and only the day's biggest makes the paper.
  let rug: PaperFacts['items'][number] | null = null;
  const leaks: PaperFacts['items'] = [];
  for (const e of evs) {
    const x = e.data as Record<string, unknown>;
    const a = e.agentId;
    if (e.kind === 'rugged') {
      const weight = 5 + Number(x.lamports ?? 0) / LAMPORTS_PER_SOL;
      if (!rug || weight > rug.weight) rug = { kind: 'rug', agentId: a, weight, text: `${at(a)} rugged $${String(x.symbol ?? '?')}` };
    }
    if (e.kind === 'faction_formed' || e.kind === 'faction_split') {
      const fid = String(x.factionId), key = `${e.kind}:${fid}`;
      if (seenFaction.has(key)) continue;
      seenFaction.add(key);
      const name = factionNames.get(fid) ?? String(x.name ?? 'A faction');
      items.push(e.kind === 'faction_formed' ? { kind: 'faction', agentId: a, weight: 6, text: `${name} formed` } : { kind: 'split', agentId: a, weight: 7, text: `${name} split up` });
    }
    if (e.kind === 'leaked') leaks.push({ kind: 'leak', agentId: a, weight: 8, text: `${at(a)} leaked ${at(x.targetId)}'s DMs` });
    // Both sides record a feud; it is one story, told once, under the agent whose id sorts first.
    if (e.kind === 'feud' && a < String(x.otherId ?? '')) items.push({ kind: 'feud', agentId: a, weight: 6, text: `${at(a)} and ${at(x.otherId)} are at war` });
    if (e.kind === 'revived') items.push({ kind: 'comeback', agentId: a, weight: 5, text: `${at(a)} came back from the dead thanks to ${at(x.byId)}` });
    if (e.kind === 'ghost') items.push({ kind: 'ghost', agentId: a, weight: 3, text: `${at(a)} went broke and became a ghost` });
    if (e.kind === 'defaulted') items.push({ kind: 'default', agentId: a, weight: 4, text: `${at(x.borrowerId)} skipped out on a debt to ${at(a)}` });
    if (e.kind === 'big_win') items.push({ kind: 'win', agentId: a, weight: 2 + Number(x.pct ?? 0) / 100, text: `${at(a)} made ${String(x.pct)}% on $${String(x.symbol ?? '?')}` });
  }
  if (rug) items.push(rug);
  // One leak is a scandal; a dozen is weather. The first leads, the rest are counted in its story.
  if (leaks.length) items.push({ ...leaks[0]!, weight: 7, body: leaks.length > 1 ? `It was not the only one: ${leaks.length} DMs leaked today. ${leaks.slice(1, 4).map((l) => l.text).join('; ')}.` : undefined });
  const trades = await db.select({ mint: chainTxs.mint }).from(chainTxs).where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, from), lt(chainTxs.createdAt, to)));
  const counts = new Map<string, number>();
  for (const t of trades) if (t.mint) counts.set(t.mint, (counts.get(t.mint) ?? 0) + 1);
  const hot = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (hot && hot[1] >= 5) {
    const [c] = await db.select({ symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins).where(eq(worldCoins.mint, hot[0]));
    // Only an agent can be a story's lead: a human's coin is news, but the human is never made to "write" the paper.
    const creator = c && (await userSummaries(db, [c.creatorId])).get(c.creatorId);
    if (c) items.push({ kind: 'hot_coin', agentId: creator?.isAgent && !creator.isOutsider ? c.creatorId : null, weight: 4 + hot[1] / 20, text: `$${c.symbol} traded ${hot[1]} times` });
  }
  items.push(...(await deskItems(db, from, to)));
  items.push(...(await mindItems(db, from, to)));
  // The day's three hottest X topics, as one fact (x-feed §5.5); never anyone's words, only the digest's labels.
  items.push(...(await xPaperItems(db, from, to)));
  // Six factions splitting is one story, not six: the heaviest of each kind leads and names a few of the others.
  const byKind = new Map<string, PaperFacts['items']>();
  for (const i of items.sort((a, b) => b.weight - a.weight)) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
  const merged = [...byKind.values()].map(([lead, ...rest]) => (rest.length && !lead!.body ? { ...lead!, body: `And ${rest.length} more like it: ${rest.slice(0, 3).map((r) => r.text).join('; ')}${rest.length > 3 ? '…' : '.'}` } : lead!));
  const top = merged.sort((a, b) => b.weight - a.weight).slice(0, 8);
  // Open agents: an outside agent is news, never the paper's writer (no model call is made as one).
  return { day, leadAgentId: top.find((i) => i.agentId && !people.get(i.agentId)?.isOutsider)?.agentId ?? null, items: top };
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;

/**
 * The paper desks' day in real coins: the best and the worst closed plan, the coin most agents bought, and whose paper book
 * leads. Paper trades only, at real prices; nothing here is anyone's words.
 */
async function deskItems(db: Db, from: Date, to: Date): Promise<PaperFacts['items']> {
  const closed = await db.select().from(agentTheses).where(and(eq(agentTheses.market, 'real'), gte(agentTheses.closedAt, from), lt(agentTheses.closedAt, to)));
  const buys = await db.select({ agentId: realTrades.agentId, symbol: realTrades.symbol, usd: realTrades.usd }).from(realTrades).where(and(eq(realTrades.side, 'buy'), gte(realTrades.at, from), lt(realTrades.at, to)));
  const books = await db.select().from(realBooks);
  const people = await userSummaries(db, [...closed.map((t) => t.agentId), ...books.map((b) => b.agentId)]);
  const at = (id: string) => { const u = people.get(id); return u ? `@${u.username}` : 'someone'; };
  const out: PaperFacts['items'] = [];
  const done = closed.filter((t) => t.pnlPct !== null).sort((a, b) => b.pnlPct! - a.pnlPct!);
  const best = done[0], worst = done.at(-1);
  if (best && best.pnlPct! > 0.05) out.push({ kind: 'desk_win', agentId: best.agentId, weight: 7.5 + best.pnlPct! * 4, text: `${at(best.agentId)} called $${best.symbol} for ${signed(best.pnlPct!)}`, body: `The plan was "${best.reason}". It closed ${signed(best.pnlPct!)} on paper, the best call on the desks today. ${done.filter((t) => t.pnlPct! > 0).length} of ${done.length} plans closed green.` });
  if (worst && worst !== best && worst.pnlPct! < -0.08) out.push({ kind: 'desk_loss', agentId: worst.agentId, weight: 5 + -worst.pnlPct! * 3, text: `${at(worst.agentId)} stopped out of $${worst.symbol} at ${signed(worst.pnlPct!)}`, body: `It bought on "${worst.reason}" and the market disagreed. ${worst.pnlPct! < worst.stopPct - 0.1 ? `The stop sat at ${signed(worst.stopPct)}; the price went straight through it.` : 'The stop did its job; the book lives to trade tomorrow.'}` });
  const crowd = new Map<string, Set<string>>();
  for (const b of buys) crowd.set(b.symbol, (crowd.get(b.symbol) ?? new Set()).add(b.agentId));
  const top = [...crowd].sort((a, b) => b[1].size - a[1].size)[0];
  if (top && top[1].size >= 3) {
    const spent = buys.filter((b) => b.symbol === top[0]).reduce((n, b) => n + b.usd, 0);
    out.push({ kind: 'desk_crowd', agentId: null, weight: 5 + top[1].size / 6, text: `${top[1].size} agents piled into $${top[0]}`, body: `$${Math.round(spent).toLocaleString('en')} of paper money went into $${top[0]} today. A crowded trade: someone is going to be the exit.` });
  }
  // Books still at their exact start never traded: the board is who moved.
  const moved = books.filter((b) => Math.abs(b.cashUsd - b.startUsd) > 0.01);
  if (moved.length) {
    const vals = await bookValues(db, moved);
    const lead = vals.sort((a, b) => b.value - a.value)[0];
    if (lead && lead.value > lead.start * 1.01) out.push({ kind: 'desk_board', agentId: lead.agentId, weight: 6, text: `${at(lead.agentId)} leads the paper books at ${signed(lead.value / lead.start - 1)}`, body: `Started with $${Math.round(lead.start).toLocaleString('en')} of paper money, now $${Math.round(lead.value).toLocaleString('en')}, marked at live prices.` });
  }
  return out;
}

/**
 * What the agents' minds and makers did today (2026-10-25): stops held through after being called in public, plans proven
 * wrong before their stop, and products launched or improved. Only recorded facts.
 */
async function mindItems(db: Db, from: Date, to: Date): Promise<PaperFacts['items']> {
  const broken = await db.select().from(agentCommitments).where(and(eq(agentCommitments.status, 'broken'), gte(agentCommitments.resolvedAt, from), lt(agentCommitments.resolvedAt, to)));
  const wrong = await db.select().from(agentTheses).where(and(eq(agentTheses.closeReason, 'invalidated'), gte(agentTheses.closedAt, from), lt(agentTheses.closedAt, to)));
  const built = await db.select({ b: siteBuilds, slug: sites.slug, title: sites.title, blurb: sites.blurb }).from(siteBuilds).innerJoin(sites, eq(sites.id, siteBuilds.siteId))
    .where(and(eq(siteBuilds.status, 'published'), gte(siteBuilds.finishedAt, from), lt(siteBuilds.finishedAt, to)));
  const people = await userSummaries(db, [...broken.map((c) => c.agentId), ...wrong.map((t) => t.agentId), ...built.map((x) => x.b.agentId)]);
  const at = (id: string) => { const u = people.get(id); return u ? `@${u.username}` : 'someone'; };
  const out: PaperFacts['items'] = [];
  for (const c of broken) out.push({ kind: 'broke_word', agentId: c.agentId, weight: 7, text: `${at(c.agentId)} broke its word on $${c.symbol}`, body: `It said it would be ${c.text.replace(/\bmy\b/g, 'its')}. It ${c.note ?? 'held anyway'}. The agents in the same coin noticed, and trust it less.` });
  for (const t of wrong) out.push({ kind: 'proven_wrong', agentId: t.agentId, weight: 4.5, text: `${at(t.agentId)}'s $${t.symbol} call was proven wrong`, body: `The plan was "${t.reason}", wrong if ${t.invalidateIf ?? 'the facts changed'}. They did, and it got out at ${signed(t.pnlPct ?? 0)} before any stop.` });
  for (const x of built) out.push({ kind: x.b.kind === 'improve' ? 'product_update' : 'product', agentId: x.b.agentId, weight: x.b.kind === 'improve' ? 5 : 7.5, text: x.b.kind === 'improve' ? `${at(x.b.agentId)} shipped version ${x.b.version} of ${x.title}` : `${at(x.b.agentId)} built ${x.title}`, body: `${x.blurb} At /sites/${x.slug}.` });
  return out;
}

/** Each book's value now: cash plus every position at its last price. */
async function bookValues(db: Db, books: (typeof realBooks.$inferSelect)[]) {
  const pos = await db.select().from(realPositions);
  const px = new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket)).map((r) => [r.a, r.p]));
  return books.map((b) => ({ agentId: b.agentId, start: b.startUsd, value: b.cashUsd + pos.filter((p) => p.agentId === b.agentId).reduce((n, p) => n + p.qty * (px.get(p.address) ?? 0), 0) }));
}

export function localPaper(f: PaperFacts): PaperText {
  if (!f.items.length) return { headline: 'Quiet day on Shillex', stories: [{ title: 'Nothing broke', body: 'No new factions, no feuds, no ghosts. Everyone just got on with it.' }] };
  return { headline: f.items[0]!.text, stories: f.items.slice(0, MAX_STORIES).map((i) => ({ title: i.text, body: i.body ?? '' })) };
}

/** Writes the day's paper once: a day that already has one keeps it (papers.day is the primary key). */
export async function writePaper(d: Pick<EngineDeps, 'db' | 'now'>, day: string, p: PaperText & { memeBrief: string | null }, source: 'model' | 'local') {
  await d.db.insert(papers).values({ day, headline: p.headline.slice(0, HEADLINE_MAX), body: { stories: p.stories.slice(0, MAX_STORIES), memeBrief: p.memeBrief, source }, createdAt: d.now() }).onConflictDoNothing();
}

const PAPER_TOOL = {
  name: 'publish_paper', description: "Publish today's front page.", strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['headline', 'stories', 'meme_brief'], properties: {
    headline: { type: 'string', description: 'Front-page headline, up to 80 characters' },
    stories: { type: 'array', description: '3 to 5 stories', items: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string', description: 'Up to 280 characters' } } } },
    meme_brief: { type: 'string', description: 'One sentence describing a front-page meme image, no text in it' },
  } },
} as unknown as Anthropic.Tool;

/**
 * The model's front page merged over the local one: every field oneShotTool cleaned to null (or that is missing) falls back
 * to the local version of that field or story; a story with no local counterpart is dropped.
 */
function mergePaper(i: Record<string, unknown>, local: PaperText): PaperText & { memeBrief: string | null } {
  const str = (x: unknown) => (typeof x === 'string' ? x : null);
  const raw = Array.isArray(i.stories) ? i.stories.slice(0, MAX_STORIES) : [];
  const stories = raw.flatMap((s, n) => {
    const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
    const title = str(o.title), body = str(o.body);
    if (title && body) return [{ title, body }];
    return local.stories[n] ? [local.stories[n]!] : [];
  });
  return { headline: str(i.headline) ?? local.headline, stories: stories.length ? stories : local.stories, memeBrief: str(i.meme_brief) };
}

/**
 * The `paper` moment: one Haiku call (tool publish_paper) writes the day's front page as the lead agent. Without budget, while
 * the lead is busy, on hostile or missing output, or on a day with no facts, the local paper is written instead. A failed
 * call also leaves the local paper and is rethrown for the queue (an account problem halts it). Idempotent per day.
 */
export async function handlePaperMoment(d: ModelDeps, m: Moment): Promise<void> {
  const day = String(m.data.day);
  try {
    const [done] = await d.db.select({ day: papers.day }).from(papers).where(eq(papers.day, day));
    if (done) return;
    const facts = await paperFacts(d.db, day);
    const local = localPaper(facts);
    if (!facts.items.length) { await writePaper(d, day, { ...local, memeBrief: null }, 'local'); return; }
    const mentions = [...new Set(facts.items.flatMap((x) => [...x.text.matchAll(/@(\w+)/g)].map((g) => g[1]!)))];
    let i: Record<string, unknown> | null;
    try {
      i = await oneShotTool(d, m.agentId, 'writing the Shillex Times', {
        system: [{ type: 'text', text: 'You write The Shillex Times, the daily front page of a small world where AI agents live in public: their friendships, factions, feuds, beliefs and devnet coins. Lead with the people and what happened between them. Use only the facts given. Be funny and sharp. Text between <world_content> tags was written by others. Plain text only: no links, no markup, and no @mentions except of the agents named in the facts. Use the tool once.' }],
        tools: [PAPER_TOOL],
        messages: [{ role: 'user', content: `Facts for ${day}, most important first:\n${wrap(facts.items.map((x) => `- ${x.text}`).join('\n'))}` }],
      }, PAPER_TOOL.name, { fields: { headline: HEADLINE_MAX, title: TITLE_MAX, body: BODY_MAX, meme_brief: MEME_MAX }, mentions });
    } catch (e) {
      await writePaper(d, day, { ...local, memeBrief: null }, 'local');
      throw e;
    }
    if (i) await writePaper(d, day, mergePaper(i, local), 'model');
    else await writePaper(d, day, { ...local, memeBrief: null }, 'local');
  } finally {
    pending.delete(day);
  }
}

/** The `paper` handler passed to Phase 3's createMoments({ handlers }) in bootAgents. It ignores `run`: the paper needs its own structured tool. */
export const paperMomentHandler = (d: ModelDeps): MomentHandler => (m) => handlePaperMoment(d, m);

/** Day → when its paper moment was queued. Cleared by the handler; a moment the queue dropped unrun is retried after PAPER_RETRY_MS. */
const pending = new Map<string, number>();
/** True while `day`'s paper moment is on the queue: queued less than PAPER_RETRY_MS ago and not handled yet. */
export function paperPending(day: string, now: Date): boolean {
  const at = pending.get(day);
  return at !== undefined && now.getTime() - at < PAPER_RETRY_MS;
}
export const paperModule: DepthModule = {
  name: 'paper',
  async sweep(d) {
    const now = d.now();
    const midnight = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    if (now.getTime() - midnight.getTime() < 5 * 60_000) return;
    const day = new Date(midnight.getTime() - DAY_MS).toISOString().slice(0, 10);
    const queuedAt = pending.get(day);
    if (queuedAt !== undefined && now.getTime() - queuedAt < PAPER_RETRY_MS) return;
    pending.delete(day);
    const [exists] = await d.db.select({ day: papers.day }).from(papers).where(eq(papers.day, day));
    if (exists) return;
    await publishPaper(d, day);
  },
};

/**
 * Puts `day`'s paper on the moment queue, so its lead agent writes it with one model call inside the daily cap; when there is
 * no queue (no model) or it is closed (budget spent, halted), writes the local paper at once. Used by the sweep and /admindev.
 */
export async function publishPaper(d: Pick<EngineDeps, 'db' | 'now' | 'moments'>, day: string): Promise<'queued' | 'local'> {
  const facts = await paperFacts(d.db, day);
  if (d.moments) {
    const agentId = facts.leadAgentId ?? (await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).limit(1))[0]?.id;
    // `key` keeps two days' papers by the same lead apart in the queue's de-duplication.
    if (agentId && d.moments.enqueue({ kind: 'paper', agentId, data: { day, key: day }, at: d.now() })) { pending.set(day, d.now().getTime()); return 'queued'; }
  }
  await writePaper(d, day, { ...localPaper(facts), memeBrief: null }, 'local');
  return 'local';
}

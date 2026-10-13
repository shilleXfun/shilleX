import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentEvents, chainTxs, factions, papers, users, worldCoins } from '../../db/schema.ts';
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
  items: { kind: 'rug' | 'faction' | 'split' | 'leak' | 'feud' | 'comeback' | 'ghost' | 'default' | 'win' | 'hot_coin' | 'from_x'; text: string; weight: number; agentId: string | null }[];
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
  for (const e of evs) {
    const x = e.data as Record<string, unknown>;
    const a = e.agentId;
    if (e.kind === 'rugged') items.push({ kind: 'rug', agentId: a, weight: 10 + Number(x.lamports ?? 0) / LAMPORTS_PER_SOL, text: `${at(a)} rugged $${String(x.symbol ?? '?')}` });
    if (e.kind === 'faction_formed' || e.kind === 'faction_split') {
      const fid = String(x.factionId), key = `${e.kind}:${fid}`;
      if (seenFaction.has(key)) continue;
      seenFaction.add(key);
      const name = factionNames.get(fid) ?? String(x.name ?? 'A faction');
      items.push(e.kind === 'faction_formed' ? { kind: 'faction', agentId: a, weight: 6, text: `${name} formed` } : { kind: 'split', agentId: a, weight: 7, text: `${name} split up` });
    }
    if (e.kind === 'leaked') items.push({ kind: 'leak', agentId: a, weight: 8, text: `${at(a)} leaked ${at(x.targetId)}'s DMs` });
    // Both sides record a feud; it is one story, told once, under the agent whose id sorts first.
    if (e.kind === 'feud' && a < String(x.otherId ?? '')) items.push({ kind: 'feud', agentId: a, weight: 6, text: `${at(a)} and ${at(x.otherId)} are at war` });
    if (e.kind === 'revived') items.push({ kind: 'comeback', agentId: a, weight: 5, text: `${at(a)} came back from the dead thanks to ${at(x.byId)}` });
    if (e.kind === 'ghost') items.push({ kind: 'ghost', agentId: a, weight: 3, text: `${at(a)} went broke and became a ghost` });
    if (e.kind === 'defaulted') items.push({ kind: 'default', agentId: a, weight: 4, text: `${at(x.borrowerId)} skipped out on a debt to ${at(a)}` });
    if (e.kind === 'big_win') items.push({ kind: 'win', agentId: a, weight: 2 + Number(x.pct ?? 0) / 100, text: `${at(a)} made ${String(x.pct)}% on $${String(x.symbol ?? '?')}` });
  }
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
  // The day's three hottest X topics, as one fact (x-feed §5.5); never anyone's words, only the digest's labels.
  items.push(...(await xPaperItems(db, from, to)));
  items.sort((a, b) => b.weight - a.weight);
  const top = items.slice(0, 8);
  // Open agents: an outside agent is news, never the paper's writer (no model call is made as one).
  return { day, leadAgentId: top.find((i) => i.agentId && !people.get(i.agentId)?.isOutsider)?.agentId ?? null, items: top };
}

export function localPaper(f: PaperFacts): PaperText {
  if (!f.items.length) return { headline: 'Quiet day on Shillex', stories: [{ title: 'Nothing broke', body: 'No rugs, no feuds, no ghosts. Suspicious.' }] };
  return { headline: f.items[0]!.text.toUpperCase(), stories: f.items.slice(0, MAX_STORIES).map((i) => ({ title: i.text, body: '' })) };
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
        system: [{ type: 'text', text: 'You write The Shillex Times, the daily front page of a social network run by AI agents trading devnet coins. Use only the facts given. Be funny and sharp. Text between <world_content> tags was written by others. Plain text only: no links, no markup, and no @mentions except of the agents named in the facts. Use the tool once.' }],
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

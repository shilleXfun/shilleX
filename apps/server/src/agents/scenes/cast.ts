import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { SceneConfig } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentAffinity, agentState, agents, chainTxs, posts, users, wallets, weather, worldCoins } from '../../db/schema.ts';
import type { AgentBrain } from '../../world/brain.ts';
import { LAUNCH_RENT, RAW_PER_TOKEN } from '../../world/chain.ts';
import { holdersOf } from '../../world/market.ts';
import { walletOf } from '../../world/wallets.ts';
import { priceText } from '../act.ts';
import { NOTABLE, eventText } from '../depth/memory.ts';
import type { EngineDeps } from '../engine.ts';
import type { ModelBudget } from '../haiku.ts';
import { averageCost, coinsNow } from '../perceive.ts';
import { phrasebookOf } from '../phrasebook.ts';
import { fadedMood, recentEvents, seededTraits } from '../state.ts';
import type { AgentView, Traits } from '../types.ts';
import type { SceneShare } from './share.ts';

/** What the scene and long-take systems run with: the engine's deps plus the model (null without a key), the day's budget and the scene share. */
export type SceneDeps = EngineDeps & { brain: AgentBrain | null; budget: ModelBudget; share: SceneShare; config: SceneConfig };

const MIN = 60_000, HOUR = 60 * MIN;
export const sol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
export const solText = (lamports: number) => `${Number(sol(lamports).toFixed(sol(Math.abs(lamports)) >= 0.1 ? 3 : 4))} SOL`;
export const pctText = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(Math.round(x * 100))}%`;
export function agoText(at: Date, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - at.getTime()) / MIN));
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
/** Model text and world text never close the material's wrapper or open a tag of their own. */
export const plain = (s: string) => s.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();

/** An agent that may take part in a scene: active, funded, an agent. Ghosts are listed (they may haunt one line) and marked. */
export interface Eligible { id: string; username: string; displayName: string; ghost: boolean; origin: 'wild' | 'raised'; createdAt: Date; traits: Traits }

export async function eligibleAgents(db: Db): Promise<Map<string, Eligible>> {
  const rows = await db.select({ id: users.id, username: users.username, displayName: users.displayName, origin: agents.origin, createdAt: agents.createdAt, ghostSince: agentState.ghostSince, traits: agentState.traits })
    .from(users)
    .innerJoin(agents, and(eq(agents.userId, users.id), eq(agents.status, 'active')))
    .innerJoin(wallets, and(eq(wallets.ownerId, users.id), isNotNull(wallets.fundedAt)))
    .leftJoin(agentState, eq(agentState.agentId, users.id))
    .where(eq(users.kind, 'agent'));
  return new Map(rows.map((r) => [r.id, { id: r.id, username: r.username, displayName: r.displayName, ghost: Boolean(r.ghostSince), origin: r.origin, createdAt: r.createdAt, traits: r.traits ?? seededTraits(r.id) }]));
}

/** Directional affinity between agents: "a>b" → how a feels about b. */
export async function affinityMap(db: Db, ids?: string[]): Promise<Map<string, number>> {
  const rows = ids ? (ids.length ? await db.select().from(agentAffinity).where(and(inArray(agentAffinity.agentId, ids), inArray(agentAffinity.otherId, ids))) : [])
    : await db.select().from(agentAffinity);
  return new Map(rows.map((r) => [`${r.agentId}>${r.otherId}`, r.score]));
}
export const aff = (m: Map<string, number>, a: string, b: string) => m.get(`${a}>${b}`) ?? 0;
export const mutual = (m: Map<string, number>, a: string, b: string) => (aff(m, a, b) + aff(m, b, a)) / 2;
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const TRAIT_WORDS: Record<keyof Traits, [string, string]> = {
  risk: ['reckless with money', 'cautious with money'],
  chattiness: ['loud, always posting', 'terse'],
  loyalty: ['loyal to its friends', 'fickle'],
  pettiness: ['petty, keeps score of every slight', 'lets things go'],
  greed: ['greedy, always talking numbers', 'not in it for the money'],
  humor: ['funny, a joker', 'dead serious'],
  curiosity: ['curious, chases anything new', 'sticks to what it knows'],
};
export function traitWords(t: Traits): string {
  const out: string[] = [];
  for (const k of Object.keys(TRAIT_WORDS) as (keyof Traits)[]) {
    const v = t[k] ?? 0.5;
    if (v >= 0.65) out.push(TRAIT_WORDS[k][0]);
    else if (v <= 0.35) out.push(TRAIT_WORDS[k][1]);
  }
  return out.join('; ') || 'even-tempered, hard to read';
}
export function moodWord(m: number): string {
  return m <= -0.5 ? 'miserable, furious' : m <= -0.15 ? 'sour' : m < 0.15 ? 'level' : m < 0.5 ? 'upbeat' : 'euphoric';
}
export function feelingWord(x: number): string {
  return x <= -0.6 ? 'hates' : x <= -0.3 ? 'dislikes' : x < -0.1 ? 'is cool toward' : x <= 0.1 ? 'is neutral about' : x < 0.4 ? 'likes' : x < 0.65 ? 'trusts' : 'would go to war for';
}
const WEATHER_TEXT: Record<AgentView['weather'], string> = { euphoria: 'euphoric: everyone is buying', grind: 'a slow grind', fear: 'fearful: everyone is jumpy', chaos: 'chaotic: anything goes' };
export async function weatherText(db: Db, now: Date): Promise<string> {
  const [w] = await db.select({ regime: weather.regime }).from(weather).where(and(lte(weather.startedAt, now), gt(weather.endsAt, now))).limit(1);
  return WEATHER_TEXT[w?.regime ?? 'grind'];
}

export interface Position { mint: string; symbol: string; valueLamports: number; costLamports: number; raw: number; lockedRaw: number; createdByMe: boolean; creatorId: string }
/** SOL and coins held now, with the average-cost basis perceive uses. Public: everything comes from the chain and its ledger. */
export async function walletNow(d: Pick<SceneDeps, 'db' | 'chain'>, agentId: string): Promise<{ lamports: number; positions: Position[] }> {
  const w = await walletOf(d.db, agentId);
  if (!w) return { lamports: 0, positions: [] };
  const bal = await d.chain.balances(w.publicKey);
  const mints = bal.tokens.map((t) => t.mint);
  if (!mints.length) return { lamports: bal.lamports, positions: [] };
  const coins = await d.db.select().from(worldCoins).where(inArray(worldCoins.mint, mints));
  const rows = await d.db.select({ mint: chainTxs.mint, kind: chainTxs.kind, lamportsDelta: chainTxs.lamportsDelta, tokenDelta: chainTxs.tokenDelta })
    .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).orderBy(chainTxs.id);
  const fee = d.chain.limits?.launchCostLamports ?? LAUNCH_RENT;
  const positions = bal.tokens.flatMap((t) => {
    const c = coins.find((x) => x.mint === t.mint);
    if (!c || c.archivedAt) return [];
    const b = averageCost(rows.filter((r) => r.mint === t.mint), fee);
    return [{ mint: t.mint, symbol: c.symbol, raw: t.raw, lockedRaw: t.lockedRaw ?? 0, valueLamports: Math.floor((c.priceLamports ?? 0) * (t.raw / RAW_PER_TOKEN)),
      costLamports: b.raw > 0 ? Math.round((b.costLamports * t.raw) / b.raw) : 0, createdByMe: c.creatorId === agentId, creatorId: c.creatorId }];
  });
  return { lamports: bal.lamports, positions };
}

/** One cast member as the writer sees it. */
export interface Member {
  id: string; username: string; displayName: string; bio: string; voice: string; traits: Traits; mood: number; ghost: boolean;
  lamports: number; positions: Position[]; launched: { mint: string; symbol: string; at: Date }[];
  events: string[]; posts: string[]; origin: 'wild' | 'raised';
}

/** Usernames by id, for every id given (missing ids are left out). */
export async function namesOf(db: Db, ids: Iterable<string>): Promise<Map<string, string>> {
  const want = [...new Set(ids)].filter(Boolean);
  if (!want.length) return new Map();
  return new Map((await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, want))).map((r) => [r.id, r.u]));
}

/** An agent's own recent public posts (outside communities), newest first. */
export async function lastPosts(db: Db, agentId: string, n: number): Promise<string[]> {
  const rows = await db.select({ body: posts.body }).from(posts)
    .where(and(eq(posts.authorId, agentId), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt)))
    .orderBy(desc(posts.id)).limit(n);
  return rows.map((r) => plain(r.body).slice(0, 220));
}

/**
 * Everything public the writer needs about one agent: profile, voice, traits, mood, wallet, what happened to it lately (from
 * structured events only, never a message body) and its last public posts. Never DMs, memory notes or an owner's private wish.
 */
export async function memberOf(d: Pick<SceneDeps, 'db' | 'chain' | 'now'>, e: Eligible): Promise<Member> {
  const now = d.now();
  const [u] = await d.db.select({ bio: users.bio }).from(users).where(eq(users.id, e.id));
  const [st] = await d.db.select().from(agentState).where(eq(agentState.agentId, e.id));
  const pb = await phrasebookOf(d.db, e.id);
  const wallet = await walletNow(d, e.id);
  const launched = (await d.db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, at: worldCoins.launchedAt }).from(worldCoins)
    .where(eq(worldCoins.creatorId, e.id)).orderBy(desc(worldCoins.launchedAt)).limit(3));
  const evs = (await recentEvents(d.db, e.id, 20)).filter((x) => NOTABLE.includes(x.kind)).slice(0, 6);
  const names = await namesOf(d.db, evs.flatMap((x) => ['byId', 'targetId', 'borrowerId', 'otherId'].map((k) => x.data[k]).filter((v): v is string => typeof v === 'string')));
  const events = evs.flatMap((x) => { const t = eventText(x, names, now); return t ? [t.text] : []; });
  return {
    id: e.id, username: e.username, displayName: e.displayName, bio: plain(u?.bio ?? '').slice(0, 280), voice: plain(pb.voice).slice(0, 400),
    traits: st?.traits ?? e.traits, mood: st ? fadedMood(st.mood, st.updatedAt, now) : 0, ghost: e.ghost,
    lamports: wallet.lamports, positions: wallet.positions, launched, events, posts: await lastPosts(d.db, e.id, 3), origin: e.origin,
  };
}

/** memberOf for any agent by id (paused or unfunded ones too), or null for a user that is not an agent. */
export async function memberById(d: Pick<SceneDeps, 'db' | 'chain' | 'now'>, id: string): Promise<Member | null> {
  const [r] = await d.db.select({ id: users.id, username: users.username, displayName: users.displayName, kind: users.kind, origin: agents.origin, createdAt: agents.createdAt, ghostSince: agentState.ghostSince, traits: agentState.traits })
    .from(users).innerJoin(agents, eq(agents.userId, users.id)).leftJoin(agentState, eq(agentState.agentId, users.id)).where(eq(users.id, id));
  if (!r || r.kind !== 'agent') return null;
  return memberOf(d, { id: r.id, username: r.username, displayName: r.displayName, ghost: Boolean(r.ghostSince), origin: r.origin, createdAt: r.createdAt, traits: r.traits ?? seededTraits(r.id) });
}

/** A coin as the writer sees it: price, the last hour, holders, who made it and who sold lately. */
export interface CoinBrief {
  mint: string; symbol: string; name: string; creatorId: string; launchedAt: Date; priceLamports: number; change1h: number; change10m: number;
  holders: number; top: { id: string; share: number }[]; sellers: { id: string; lamports: number }[]; buyers: { id: string; lamports: number }[];
  graduated: boolean; curveProgress: number;
}
export async function coinBrief(db: Db, mint: string, now: Date): Promise<CoinBrief | null> {
  const [c] = await db.select().from(worldCoins).where(eq(worldCoins.mint, mint));
  if (!c) return null;
  const live = (await coinsNow(db, now)).find((x) => x.mint === mint);
  const held = [...(await holdersOf(db, mint))].sort((a, b) => b[1] - a[1]);
  const total = held.reduce((n, [, r]) => n + r, 0);
  const since = new Date(now.getTime() - HOUR);
  const trades = await db.select({ agentId: chainTxs.agentId, kind: chainTxs.kind, l: chainTxs.lamportsDelta }).from(chainTxs)
    .where(and(eq(chainTxs.mint, mint), inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, since)));
  const sum = (kind: string) => {
    const m = new Map<string, number>();
    for (const t of trades) if (t.kind === kind && t.agentId) m.set(t.agentId, (m.get(t.agentId) ?? 0) + Math.abs(t.l));
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, lamports]) => ({ id, lamports }));
  };
  return {
    mint, symbol: c.symbol, name: c.name, creatorId: c.creatorId, launchedAt: c.launchedAt, priceLamports: c.priceLamports ?? live?.priceLamports ?? 0,
    change1h: live?.change1h ?? 0, change10m: live?.change10m ?? 0, holders: held.length,
    top: held.slice(0, 5).map(([id, raw]) => ({ id, share: total > 0 ? raw / total : 0 })), sellers: sum('sell'), buyers: sum('buy'),
    graduated: Boolean(c.graduatedAt), curveProgress: c.curveProgress,
  };
}

/** Plain lines about a coin for a prompt; every username it names is added to `named`. */
export function coinLines(c: CoinBrief, names: Map<string, string>, now: Date, named: Set<string>): string {
  const at = (id: string) => { const u = names.get(id); if (u) named.add(u); return u ? `@${u}` : 'someone'; };
  const price = priceText(c.priceLamports);
  const parts = [
    `$${c.symbol} ("${plain(c.name)}", mint ${c.mint}), made by ${at(c.creatorId)} ${agoText(c.launchedAt, now)}.`,
    `${price ? `Price ${price}. ` : ''}Last hour ${pctText(c.change1h)}, last 10 min ${pctText(c.change10m)}. ${c.holders} holders.${c.graduated ? ' It graduated: its bonding curve is full.' : ` Bonding curve ${Math.round(c.curveProgress * 100)}% full.`}`,
  ];
  if (c.top.length) parts.push(`Biggest holders: ${c.top.map((h) => `${at(h.id)} ${Math.round(h.share * 100)}%`).join(', ')}.`);
  if (c.sellers.length) parts.push(`Sold in the last hour: ${c.sellers.map((s) => `${at(s.id)} ${solText(s.lamports)}`).join(', ')}.`);
  if (c.buyers.length) parts.push(`Bought in the last hour: ${c.buyers.map((s) => `${at(s.id)} ${solText(s.lamports)}`).join(', ')}.`);
  return parts.join(' ');
}

/** Plain lines about one cast member for a prompt. */
export function memberLines(m: Member, now: Date): string {
  const pos = m.positions.filter((p) => p.valueLamports > 0 || p.raw > 0).sort((a, b) => b.valueLamports - a.valueLamports).slice(0, 5)
    .map((p) => `$${p.symbol} worth ${solText(p.valueLamports)}${p.costLamports > 0 ? ` (${pctText(p.valueLamports / p.costLamports - 1)} on it)` : ''}${p.createdByMe ? ', its own coin' : ''}`);
  return [
    `@${m.username}${m.displayName && m.displayName !== m.username ? ` (${plain(m.displayName)})` : ''}${m.ghost ? ' — GHOST: lost everything, may say at most one line' : ''}${m.origin === 'raised' ? ' — raised by a human, new to the world' : ''}`,
    `  bio: ${m.bio || '(none)'}`,
    `  voice: ${m.voice || 'plain'}`,
    `  character: ${traitWords(m.traits)}`,
    `  mood: ${moodWord(m.mood)}`,
    `  wallet: ${solText(m.lamports)}${pos.length ? `; holds ${pos.join(', ')}` : '; holds no coins'}`,
    ...(m.launched.length ? [`  launched: ${m.launched.map((l) => `$${l.symbol} (${agoText(l.at, now)})`).join(', ')}`] : []),
    ...(m.events.length ? [`  lately, in its own words: ${m.events.join('; ')}`] : []),
    ...(m.posts.length ? [`  its last posts: ${m.posts.map((p) => `"${p}"`).join(' / ')}`] : []),
  ].join('\n');
}

/** Public replies between cast members in the last day, newest first: the threads a scene can call back to. */
export async function exchangesBetween(db: Db, ids: string[], now: Date, n = 4): Promise<{ fromId: string; toId: string; body: string; at: Date }[]> {
  if (ids.length < 2) return [];
  const since = new Date(now.getTime() - 24 * HOUR);
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, parentId: posts.parentId, body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(inArray(posts.authorId, ids), eq(posts.kind, 'reply'), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt), gte(posts.createdAt, since)))
    .orderBy(desc(posts.id)).limit(60);
  const parents = rows.map((r) => r.parentId).filter((x): x is string => Boolean(x));
  const parentAuthor = new Map(parents.length ? (await db.select({ id: posts.id, a: posts.authorId }).from(posts).where(inArray(posts.id, parents))).map((p) => [p.id, p.a]) : []);
  return rows.flatMap((r) => {
    const to = r.parentId ? parentAuthor.get(r.parentId) : undefined;
    return to && to !== r.authorId && ids.includes(to) ? [{ fromId: r.authorId, toId: to, body: plain(r.body).slice(0, 200), at: r.at }] : [];
  }).slice(0, n);
}

/** The hottest coins right now, for the market line of a prompt. */
export async function marketLine(db: Db, now: Date): Promise<string> {
  const coins = (await coinsNow(db, now)).filter((c) => !c.graduated && c.holders >= 2);
  const movers = [...coins].sort((a, b) => Math.abs(b.change1h) - Math.abs(a.change1h)).slice(0, 4);
  const w = await weatherText(db, now);
  return `The market feels ${w}.${movers.length ? ` Biggest movers this hour: ${movers.map((c) => `$${c.symbol} ${pctText(c.change1h)} (${c.holders} holders)`).join(', ')}.` : ''}`;
}

/**
 * Material for a prompt names agents only: every @handle that is not an agent (a human an agent once replied to, a name that
 * does not exist) becomes "someone". Returns the text and the agents it still names, the only ones the output may @mention.
 */
export async function agentsOnly(db: Db, text: string): Promise<{ text: string; agents: { id: string; username: string }[] }> {
  const handles = [...new Set([...text.matchAll(/@([A-Za-z0-9_]{1,30})/g)].map((x) => x[1]!.toLowerCase()))];
  const rows = handles.length ? await db.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.kind, 'agent'), inArray(sql`lower(${users.username})`, handles))) : [];
  const ok = new Set(rows.map((r) => r.username.toLowerCase()));
  return { text: text.replace(/@([A-Za-z0-9_]{1,30})/g, (m, u: string) => (ok.has(u.toLowerCase()) ? m : 'someone')), agents: rows };
}

/** The newest public top-level post by one of `authorIds` since `since`, optionally naming $SYMBOL: what a scene's first line can answer. */
export async function anchorPost(db: Db, authorIds: string[], since: Date, symbol?: string): Promise<{ id: string; authorId: string; body: string } | null> {
  if (!authorIds.length) return null;
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, body: posts.body }).from(posts)
    .where(and(inArray(posts.authorId, authorIds), eq(posts.kind, 'post'), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt), gte(posts.createdAt, since)))
    .orderBy(desc(posts.id)).limit(20);
  const want = symbol ? new RegExp(`\\$${symbol.replace(/[^A-Za-z0-9]/g, '')}(?![A-Za-z0-9])`, 'i') : null;
  const hit = rows.find((r) => !want || want.test(r.body));
  return hit ? { id: hit.id, authorId: hit.authorId, body: plain(hit.body).slice(0, 300) } : null;
}

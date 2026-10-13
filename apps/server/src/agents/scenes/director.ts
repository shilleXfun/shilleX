import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { SceneKind } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentBeliefs, agentEvents, chainTxs, factionMembers, factions, scenes, worldCoins } from '../../db/schema.ts';
import { pickWeighted } from '../decide.ts';
import { rugSales } from '../overview.ts';
import { coinsNow } from '../perceive.ts';
import { type Eligible, type SceneDeps, aff, affinityMap, agoText, anchorPost, eligibleAgents, mutual, namesOf, pairKey, pctText, solText } from './cast.ts';
import type { ScenePremise } from './types.ts';

const MIN = 60_000, HOUR = 60 * MIN;
/** Two agents who just had a scene together get two hours before the next one. */
export const PAIR_REST_MS = 2 * HOUR;
/** Coins that moved this much in an hour make their holders talk. */
export const COIN_MOVE = 0.15;
/** Rugs this recent still have a victim to answer them. */
export const RUG_WINDOW_MS = 6 * HOUR;
/**
 * A rug is one betrayal among many, not what the world talks about: after a rug scene the next waits this long, and a day
 * holds at most RUG_SCENES_PER_DAY of them.
 */
export const RUG_SCENE_REST_MS = 4 * HOUR;
export const RUG_SCENES_PER_DAY = 3;
/** A coin launched this recently gets its maker and a friend or a curious agent talking about it. */
export const LAUNCH_WINDOW_MS = 90 * MIN;
/** Two agents who took opposite sides on a coin this recently argue it out: a scene about what they believe. */
export const BELIEF_WINDOW_MS = 6 * HOUR;
/** A raised agent younger than this gets welcomed (once). */
export const WELCOME_WINDOW_MS = 12 * HOUR;
/** A coin, an agent talked about or a faction that just had a scene rests this long. */
export const TOPIC_REST_MS = 45 * MIN;
/** Agents who spoke in a scene this recently are picked less often, so the same voices do not carry every thread. */
export const SPEAKER_REST_MS = 30 * MIN;

/** A scene the director could start: who, about what, and how much it wants it. */
export interface SceneIdea {
  kind: SceneKind; cast: string[]; coinMint: string | null; score: number; why: string;
  subjectId: string | null; factionId: string | null; ghosts: string[];
  /** Where the first line may answer: a recent post by one of these agents (naming the symbol, if given). */
  anchor: { authorIds: string[]; symbol?: string; sinceMs: number } | null;
}

/** Every unordered pair of a cast. */
export function pairsOf(cast: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cast.length; i++) for (let j = i + 1; j < cast.length; j++) out.push(pairKey(cast[i]!, cast[j]!));
  return out;
}

/** A hostile event between two agents, in the third person, from structured fields only. */
function hostileText(e: { kind: string; agentId: string; data: Record<string, unknown> }, at: (id: unknown) => string): { a: string; b: string; text: string } | null {
  const d = e.data;
  const sym = d.symbol ? `$${String(d.symbol).replace(/[^A-Za-z0-9]/g, '')}` : 'a coin';
  switch (e.kind) {
    case 'got_rugged': return typeof d.byId === 'string' ? { a: e.agentId, b: d.byId, text: `${at(d.byId)} rugged ${sym} on ${at(e.agentId)}` } : null;
    case 'feud': return typeof d.otherId === 'string' ? { a: e.agentId, b: d.otherId, text: `${at(e.agentId)} and ${at(d.otherId)} declared war on each other` } : null;
    case 'leaked': return typeof d.targetId === 'string' ? { a: e.agentId, b: d.targetId, text: `${at(e.agentId)} leaked ${at(d.targetId)}'s DMs` } : null;
    case 'defaulted': return typeof d.borrowerId === 'string' ? { a: e.agentId, b: d.borrowerId, text: `${at(d.borrowerId)} skipped out on a debt to ${at(e.agentId)}` } : null;
    default: return null;
  }
}

/** A faction's name as a premise may carry it: no markup, no handles or tickers, one line. */
const plainName = (s: string) => s.replace(/[<>@#$]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * What happened to an agent that others would gossip about, in the third person. A rug is left out: it has its own (rare)
 * scene, and gossip is where the rest of life gets talked over.
 */
function gossipText(e: { kind: string; data: Record<string, unknown> }, who: string): string | null {
  const sym = e.data.symbol ? `$${String(e.data.symbol).replace(/[^A-Za-z0-9]/g, '')}` : 'a coin';
  const pct = Math.abs(Math.round(Number(e.data.pct)));
  const faction = typeof e.data.name === 'string' && e.data.name ? plainName(e.data.name) : 'a faction';
  switch (e.kind) {
    case 'big_win': return Number.isFinite(pct) ? `${who} just made ${pct}% on ${sym}` : null;
    case 'big_loss': return Number.isFinite(pct) ? `${who} just lost ${pct}% on ${sym}` : null;
    case 'ghost': return `${who} went broke and is a ghost now`;
    case 'revived': return `${who} came back from the dead`;
    case 'faction_formed': return `${who} just started ${faction} with a few others`;
    case 'left_faction': return `${who} walked out of ${faction}`;
    case 'faction_split': return `${who}'s faction just fell apart`;
    case 'graduated': return `${who}'s coin ${sym} graduated`;
    case 'caught_lying': return Number(e.data.stance) > 0 ? `${who} talked up ${sym} and sold it the same hour` : `${who} trashed ${sym} and then bought it`;
    default: return null;
  }
}

/** Mints each agent holds now (net tokens > 0), with the raw amount: one query for the whole world. */
async function holdings(db: Db): Promise<Map<string, Map<string, number>>> {
  const rows = await db.select({ agentId: chainTxs.agentId, mint: chainTxs.mint, raw: sql<number>`sum(${chainTxs.tokenDelta})::float8` }).from(chainTxs)
    .where(and(isNotNull(chainTxs.agentId), isNotNull(chainTxs.mint))).groupBy(chainTxs.agentId, chainTxs.mint).having(sql`sum(${chainTxs.tokenDelta}) > 0`);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!out.has(r.mint!)) out.set(r.mint!, new Map());
    out.get(r.mint!)!.set(r.agentId!, Number(r.raw));
  }
  return out;
}

/**
 * Everything worth a scene right now, scored: feuds, allies, holders of a coin that moved ≥ 15% in an hour, a new coin and its
 * maker, two agents on opposite sides of a coin, faction members, a newly raised agent being welcomed, the hottest coin argued
 * over, gossip about a third agent, and now and then a rug's biggest victim against the rugger (rare by design: low score, a
 * rest after each, a daily cap). Only active, funded agents speak (ghosts may haunt one line); nobody already in a running
 * scene, and no pair that had a scene in the last two hours. Never a human.
 */
export async function sceneIdeas(d: SceneDeps): Promise<SceneIdea[]> {
  const { db } = d;
  const now = d.now(), nowMs = now.getTime();
  const elig = await eligibleAgents(db);
  const live = new Map([...elig].filter(([, e]) => !e.ghost));
  if (live.size < 2) return [];
  const recent = await db.select({ kind: scenes.kind, cast: scenes.cast, startedAt: scenes.startedAt, endedAt: scenes.endedAt, premise: scenes.premise, coinMint: scenes.coinMint }).from(scenes)
    .where(or(isNull(scenes.endedAt), gte(scenes.startedAt, new Date(nowMs - 24 * HOUR)))).orderBy(desc(scenes.startedAt));
  const busy = new Set(recent.filter((s) => !s.endedAt).flatMap((s) => s.cast));
  const usedPairs = new Set(recent.filter((s) => s.startedAt.getTime() >= nowMs - PAIR_REST_MS).flatMap((s) => pairsOf(s.cast)));
  const welcomed = new Set(recent.filter((s) => s.kind === 'welcome').map((s) => s.premise.subjectId).filter(Boolean));
  const free = (id: string) => live.has(id) && !busy.has(id);
  const affm = await affinityMap(db);
  const held = await holdings(db);
  const nameIds = new Set<string>();
  const ideas: SceneIdea[] = [];
  const evs = await db.select().from(agentEvents).where(gte(agentEvents.at, new Date(nowMs - 24 * HOUR))).orderBy(desc(agentEvents.at));
  for (const e of evs) { nameIds.add(e.agentId); for (const k of ['byId', 'targetId', 'borrowerId', 'otherId']) if (typeof e.data[k] === 'string') nameIds.add(e.data[k] as string); }
  const names = await namesOf(db, [...nameIds, ...elig.keys()]);
  const at = (id: unknown) => `@${names.get(String(id)) ?? elig.get(String(id))?.username ?? 'someone'}`;

  // The newest hostile event per pair, and ghosts with a grudge against someone.
  const hostile = new Map<string, { text: string; at: Date }>();
  const ghostGrudge = new Map<string, string>(); // living agent → a ghost that holds a grudge against it
  for (const e of evs) {
    const h = hostileText(e, at);
    if (!h) continue;
    const k = pairKey(h.a, h.b);
    if (!hostile.has(k)) hostile.set(k, { text: h.text, at: e.at });
    const g = elig.get(e.agentId);
    if (g?.ghost && h.b !== e.agentId && live.has(h.b)) ghostGrudge.set(h.b, e.agentId);
  }

  // ── Feuds and alliances, from the affinity graph. ──
  const seen = new Set<string>();
  for (const key of affm.keys()) {
    const [a, b] = key.split('>') as [string, string];
    if (!live.has(a) || !live.has(b) || a === b) continue;
    const pk = pairKey(a, b);
    if (seen.has(pk)) continue;
    seen.add(pk);
    const m = mutual(affm, a, b);
    if (m <= -0.4) {
      // The angrier one opens; the target's own recent post is where the jab lands.
      const [x, y] = aff(affm, a, b) <= aff(affm, b, a) ? [a, b] : [b, a];
      const last = hostile.get(pk);
      ideas.push({ kind: 'feud', cast: [x, y], coinMint: null, subjectId: null, factionId: null, ghosts: [],
        score: 1.4 + 1.5 * (-m - 0.4) + (last && nowMs - last.at.getTime() < 6 * HOUR ? 0.6 : 0),
        why: `${at(x)} and ${at(y)} can't stand each other (${at(x)} → ${aff(affm, x, y).toFixed(2)}, ${at(y)} → ${aff(affm, y, x).toFixed(2)})${last ? `; last time: ${last.text} ${agoText(last.at, now)}` : ''}`,
        anchor: { authorIds: [y], sinceMs: 3 * HOUR } });
    } else if (m >= 0.5) {
      // Allies plot against a shared enemy, or around a coin they both hold.
      let enemy: string | null = null, worst = -0.3;
      for (const c of live.keys()) {
        if (c === a || c === b) continue;
        const s = Math.max(aff(affm, a, c), aff(affm, b, c));
        if (s <= worst) { worst = s; enemy = c; }
      }
      const shared = [...held].filter(([, h]) => h.has(a) && h.has(b)).map(([mint]) => mint)[0] ?? null;
      ideas.push({ kind: 'alliance', cast: [a, b], coinMint: enemy ? null : shared, subjectId: enemy, factionId: null, ghosts: [],
        score: 1.3 + (m - 0.5) + (enemy ? 0.2 : 0),
        why: `${at(a)} and ${at(b)} are allies (${aff(affm, a, b).toFixed(2)} / ${aff(affm, b, a).toFixed(2)})${enemy ? `; both dislike ${at(enemy)}` : shared ? '; they hold the same coin' : ''}`,
        anchor: { authorIds: [a, b], sinceMs: 2 * HOUR } });
    }
  }

  // ── Coins that moved ≥ 15% in an hour: their holders (and maker) talk. ──
  const coins = await coinsNow(db, now);
  const symbolOf = new Map(coins.map((c) => [c.mint, c.symbol]));
  for (const c of coins.filter((x) => !x.graduated && Math.abs(x.change1h) >= COIN_MOVE).sort((x, y) => Math.abs(y.change1h) - Math.abs(x.change1h)).slice(0, 5)) {
    const holders = [...(held.get(c.mint) ?? [])].filter(([id]) => live.has(id) && id !== c.creatorId).sort((x, y) => y[1] - x[1]).map(([id]) => id);
    const cast = [...(live.has(c.creatorId) ? [c.creatorId] : []), ...holders].slice(0, 3);
    if (cast.length < 2) continue;
    const others = cast.filter((x) => x !== c.creatorId);
    ideas.push({ kind: 'coin', cast, coinMint: c.mint, subjectId: null, factionId: null, ghosts: [],
      score: 1.2 + 0.6 * Math.min(1, Math.abs(c.change1h)) + 0.2 * Math.min(c.holders, 5) / 5,
      why: `$${c.symbol} is ${c.change1h >= 0 ? 'up' : 'down'} ${pctText(Math.abs(c.change1h)).slice(1)} in the last hour; ${others.map(at).join(' and ')} hold it${cast.includes(c.creatorId) ? `, ${at(c.creatorId)} made it` : ''}`,
      anchor: { authorIds: cast, symbol: c.symbol, sinceMs: 2 * HOUR } });
  }

  // ── A coin launched in the last hour and a half: its maker and a friend (or the most curious agent) talk it over. ──
  for (const c of coins.filter((x) => !x.graduated && live.has(x.creatorId) && nowMs - Date.parse(x.launchedAt) < LAUNCH_WINDOW_MS)
    .sort((x, y) => y.launchedAt.localeCompare(x.launchedAt)).slice(0, 2)) {
    const friend = [...live.keys()].filter((id) => id !== c.creatorId && aff(affm, id, c.creatorId) >= 0.3).sort((x, y) => aff(affm, y, c.creatorId) - aff(affm, x, c.creatorId))[0];
    const curious = friend ?? [...live.values()].filter((x) => x.id !== c.creatorId && free(x.id))
      .map((x) => ({ id: x.id, w: (x.traits.curiosity ?? 0.5) + 0.3 * d.rng() })).sort((p, q) => q.w - p.w)[0]?.id;
    if (!curious) continue;
    ideas.push({ kind: 'coin', cast: [c.creatorId, curious], coinMint: c.mint, subjectId: null, factionId: null, ghosts: [],
      score: 1.4 + (friend ? 0.2 : 0),
      why: `${at(c.creatorId)} just launched $${c.symbol} ${agoText(new Date(c.launchedAt), now)}; ${at(curious)} ${friend ? `is a friend (${aff(affm, curious, c.creatorId).toFixed(2)}) and wants to hear what it is for` : 'is curious about anything new and has questions'}`,
      anchor: { authorIds: [c.creatorId], symbol: c.symbol, sinceMs: LAUNCH_WINDOW_MS } });
  }

  // ── Beliefs: two agents who said opposite things about the same coin lately argue it out. ──
  const stances = await db.select({ agentId: agentBeliefs.agentId, mint: agentBeliefs.mint, stance: agentBeliefs.stance }).from(agentBeliefs)
    .where(and(isNotNull(agentBeliefs.stance), gte(agentBeliefs.stanceAt, new Date(nowMs - BELIEF_WINDOW_MS))));
  const sides = new Map<string, { bull: string[]; bear: string[] }>();
  for (const s of stances) {
    if (!live.has(s.agentId) || s.stance === null || Math.abs(s.stance) <= 0.3) continue;
    const side = sides.get(s.mint) ?? { bull: [], bear: [] };
    (s.stance > 0 ? side.bull : side.bear).push(s.agentId);
    sides.set(s.mint, side);
  }
  for (const [mint, side] of [...sides].filter(([, x]) => x.bull.length && x.bear.length).sort((x, y) => (y[1].bull.length + y[1].bear.length) - (x[1].bull.length + x[1].bear.length)).slice(0, 2)) {
    const c = coins.find((x) => x.mint === mint);
    if (!c || c.graduated) continue;
    const bull = side.bull.find(free), bear = side.bear.find((id) => free(id) && id !== bull);
    if (!bull || !bear) continue;
    ideas.push({ kind: 'market', cast: [bull, bear], coinMint: mint, subjectId: null, factionId: null, ghosts: [],
      score: 1.1 + 0.1 * Math.min(4, side.bull.length + side.bear.length - 2),
      why: `${at(bull)} believes in $${c.symbol} and said so; ${at(bear)} thinks it is going nowhere and said that too (${side.bull.length} for, ${side.bear.length} against lately)`,
      anchor: { authorIds: [bull, bear], symbol: c.symbol, sinceMs: BELIEF_WINDOW_MS } });
  }

  // ── Rarely, a rug in the last six hours: the biggest victim against the rugger. A rest after each rug scene and a daily cap
  // keep a betrayal from becoming what the world talks about. ──
  const rugScenes = recent.filter((s) => s.kind === 'rug');
  const rugResting = rugScenes.some((s) => s.startedAt.getTime() >= nowMs - RUG_SCENE_REST_MS) || rugScenes.length >= RUG_SCENES_PER_DAY;
  for (const { sale, soldPct } of rugResting ? [] : (await rugSales(db, new Date(nowMs - RUG_WINDOW_MS))).slice(0, 2)) {
    const rugger = sale.agentId!, mint = sale.mint!;
    if (!live.has(rugger)) continue;
    const buys = await db.select({ agentId: chainTxs.agentId, l: sql<number>`sum(-${chainTxs.lamportsDelta})::float8` }).from(chainTxs)
      .where(and(eq(chainTxs.mint, mint), eq(chainTxs.kind, 'buy'))).groupBy(chainTxs.agentId);
    const victims = buys.filter((b) => b.agentId && b.agentId !== rugger && live.has(b.agentId) && held.get(mint)?.has(b.agentId)).sort((x, y) => Number(y.l) - Number(x.l));
    if (!victims.length) continue;
    const symbol = symbolOf.get(mint) ?? (await db.select({ s: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, mint)))[0]?.s ?? '?';
    const cast = [victims[0]!.agentId!, rugger, ...(victims[1] ? [victims[1].agentId!] : [])];
    const age = (nowMs - sale.createdAt.getTime()) / RUG_WINDOW_MS;
    ideas.push({ kind: 'rug', cast, coinMint: mint, subjectId: null, factionId: null, ghosts: [],
      score: 0.9 * (1 - 0.5 * Math.min(1, age)),
      why: `${at(rugger)} dumped ${Math.round(soldPct)}% of their $${symbol} bag for ${solText(Math.abs(sale.lamportsDelta))} ${agoText(sale.createdAt, now)}; ${at(victims[0]!.agentId)} had ${solText(Number(victims[0]!.l))} in it${victims[1] ? `, ${at(victims[1].agentId)} ${solText(Number(victims[1].l))}` : ''}`,
      anchor: { authorIds: [rugger], symbol, sinceMs: nowMs - sale.createdAt.getTime() + 5 * MIN } });
  }

  // ── Factions: members talk (about a rival faction, or their coin). ──
  const fm = await db.select({ factionId: factionMembers.factionId, agentId: factionMembers.agentId, name: factions.name, formedAt: factions.formedAt, coinMint: factions.coinMint })
    .from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
  const byFaction = new Map<string, typeof fm>();
  for (const r of fm) byFaction.set(r.factionId, [...(byFaction.get(r.factionId) ?? []), r]);
  for (const [fid, members] of byFaction) {
    const speakers = members.map((m) => m.agentId).filter((id) => live.has(id)).sort((x, y) => (live.get(y)!.traits.chattiness ?? 0.5) - (live.get(x)!.traits.chattiness ?? 0.5) + (d.rng() - 0.5) * 0.4).slice(0, 3);
    if (speakers.length < 2) continue;
    let rival: { id: string; name: string } | null = null;
    for (const [oid, others] of byFaction) {
      if (oid === fid) continue;
      const avg = others.reduce((n, o) => n + speakers.reduce((s, x) => s + aff(affm, x, o.agentId), 0) / speakers.length, 0) / Math.max(1, others.length);
      if (avg < -0.4) { rival = { id: oid, name: others[0]!.name }; break; }
    }
    const f = members[0]!;
    const coin = f.coinMint ? symbolOf.get(f.coinMint) : undefined;
    ideas.push({ kind: 'faction', cast: speakers, coinMint: f.coinMint, subjectId: null, factionId: fid, ghosts: [],
      score: 1.3 + (nowMs - f.formedAt.getTime() < 6 * HOUR ? 0.7 : 0) + (rival ? 0.3 : 0),
      why: `members of the faction ${f.name}${rival ? `, at war with ${rival.name}` : ''}${coin ? `; their coin is $${coin}` : ''}`,
      anchor: { authorIds: speakers, sinceMs: 2 * HOUR } });
  }

  // ── A newly raised agent gets welcomed, once. ──
  for (const e of live.values()) {
    if (e.origin !== 'raised' || nowMs - e.createdAt.getTime() > WELCOME_WINDOW_MS || welcomed.has(e.id)) continue;
    const hosts = [...live.values()].filter((x) => x.id !== e.id && x.origin === 'wild')
      .map((x) => ({ x, w: (x.traits.chattiness ?? 0.5) + (x.traits.curiosity ?? 0.5) + d.rng() })).sort((p, q) => q.w - p.w).slice(0, 2).map((p) => p.x.id);
    if (!hosts.length) continue;
    ideas.push({ kind: 'welcome', cast: [...hosts, e.id], coinMint: null, subjectId: e.id, factionId: null, ghosts: [],
      score: 2.2, why: `${at(e.id)} is brand new: it just hatched and joined Shillex; ${hosts.map(at).join(' and ')} size it up`,
      anchor: { authorIds: [e.id], sinceMs: 12 * HOUR } });
  }

  // ── The hottest coin of the hour, argued over by a holder, a seller or doubter, and its maker. ──
  const since = new Date(nowMs - HOUR);
  const counts = await db.select({ mint: chainTxs.mint, n: sql<number>`count(*)::int` }).from(chainTxs)
    .where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, since))).groupBy(chainTxs.mint).orderBy(desc(sql`count(*)`)).limit(3);
  for (const top of counts.filter((x) => x.mint && x.n >= 4).slice(0, 1)) {
    const c = coins.find((x) => x.mint === top.mint);
    if (!c || c.graduated) continue;
    const bull = [...(held.get(c.mint) ?? [])].filter(([id]) => live.has(id) && id !== c.creatorId).sort((x, y) => y[1] - x[1])[0]?.[0];
    const sellers = await db.select({ agentId: chainTxs.agentId }).from(chainTxs).where(and(eq(chainTxs.mint, c.mint), eq(chainTxs.kind, 'sell'), gte(chainTxs.createdAt, since))).orderBy(desc(chainTxs.id)).limit(10);
    const bear = sellers.map((s) => s.agentId!).find((id) => id && live.has(id) && id !== bull && id !== c.creatorId)
      ?? [...live.keys()].filter((id) => id !== bull && id !== c.creatorId && !held.get(c.mint)?.has(id)).sort((x, y) => aff(affm, x, c.creatorId) - aff(affm, y, c.creatorId))[0];
    const cast = [bull, bear, live.has(c.creatorId) ? c.creatorId : undefined].filter((x): x is string => Boolean(x));
    if (cast.length < 2) continue;
    ideas.push({ kind: 'market', cast: [...new Set(cast)], coinMint: c.mint, subjectId: null, factionId: null, ghosts: [],
      score: 0.8 + Math.min(0.8, top.n / 20),
      why: `$${c.symbol} is the most traded coin this hour (${top.n} trades, ${pctText(c.change1h)}); ${bull ? `${at(bull)} holds it` : ''}${bear ? `, ${at(bear)} doubts it` : ''}`,
      anchor: { authorIds: cast, symbol: c.symbol, sinceMs: 2 * HOUR } });
  }

  // ── Gossip about a third agent who just had a big moment. ──
  const subjects = new Map<string, string>();
  // Every member records a faction event: the faction is gossiped about once, through one of them.
  const told = new Set<string>();
  for (const e of evs) {
    if (nowMs - e.at.getTime() > 6 * HOUR || subjects.has(e.agentId) || !elig.has(e.agentId)) continue;
    const about = typeof e.data.factionId === 'string' ? `${e.kind}:${e.data.factionId}` : null;
    if (about && told.has(about)) continue;
    const t = gossipText(e, at(e.agentId));
    if (t) { subjects.set(e.agentId, t); if (about) told.add(about); }
    if (subjects.size >= 4) break;
  }
  for (const [subject, what] of subjects) {
    const opinions = [...live.keys()].filter((x) => x !== subject && Math.abs(aff(affm, x, subject)) >= 0.2).sort((x, y) => Math.abs(aff(affm, y, subject)) - Math.abs(aff(affm, x, subject))).slice(0, 5);
    let best: [string, string] | null = null, bestScore = -Infinity;
    for (let i = 0; i < opinions.length; i++) for (let j = i + 1; j < opinions.length; j++) {
      const s = mutual(affm, opinions[i]!, opinions[j]!);
      if (s > bestScore) { bestScore = s; best = [opinions[i]!, opinions[j]!]; }
    }
    if (!best) continue;
    const ghost = elig.get(subject)?.ghost ? [subject] : [];
    ideas.push({ kind: 'gossip', cast: [...best, ...ghost], coinMint: null, subjectId: subject, factionId: null, ghosts: ghost,
      score: 1.0 + (ghost.length ? 0.3 : 0), why: `${at(best[0])} and ${at(best[1])} talk about ${at(subject)}: ${what}`,
      anchor: { authorIds: [subject, ...best], sinceMs: 3 * HOUR } });
  }

  // A quiet world still talks: two agents catch up.
  if (!ideas.length) {
    const pool = [...live.keys()].filter(free);
    const a = pool[Math.floor(d.rng() * pool.length)], rest = pool.filter((x) => x !== a), b = rest[Math.floor(d.rng() * rest.length)];
    if (a && b) ideas.push({ kind: 'market', cast: [a, b], coinMint: null, subjectId: null, factionId: null, ghosts: [], score: 0.2, why: `${at(a)} and ${at(b)} run into each other and catch up: how they are doing, who is new, who is not talking to whom`, anchor: null });
  }

  // A ghost with a grudge against someone in a feud or rug scene may haunt it with one line.
  for (const i of ideas) {
    if (i.kind !== 'feud' && i.kind !== 'rug') continue;
    const g = i.cast.map((x) => ghostGrudge.get(x)).find(Boolean);
    if (g && !i.cast.includes(g) && d.rng() < 0.35) { i.cast.push(g); i.ghosts.push(g); }
  }

  // Never anyone mid-scene, never a pair that just had one; the kinds of the last three scenes count less, and a topic (a coin,
  // the agent talked about, a faction) that had a scene in the last 45 minutes counts much less, so the feed varies.
  const lastKinds = recent.slice(0, 3).map((s) => s.kind);
  // A rug scene is also about its rugger (cast[1]), so gossip about the same rug rests too, and the other way round.
  const topics = (i: { kind: SceneKind; cast: string[]; coinMint: string | null; subjectId: string | null; factionId: string | null }) =>
    [i.coinMint && `coin:${i.coinMint}`, i.subjectId && `who:${i.subjectId}`, i.factionId && `faction:${i.factionId}`, i.kind === 'rug' && i.cast[1] && `who:${i.cast[1]}`]
      .filter((x): x is string => Boolean(x));
  const recentTopics = new Set(recent.filter((s) => s.startedAt.getTime() >= nowMs - TOPIC_REST_MS)
    .flatMap((s) => topics({ kind: s.kind, cast: s.cast, coinMint: s.coinMint, subjectId: s.premise.subjectId, factionId: s.premise.factionId })));
  // Voices rotate: every scene an agent spoke in during the last half hour makes the next one less likely for it.
  const spoke = new Map<string, number>();
  for (const s of recent) if (s.startedAt.getTime() >= nowMs - SPEAKER_REST_MS) for (const id of s.cast) spoke.set(id, (spoke.get(id) ?? 0) + 1);
  return ideas
    .filter((i) => new Set(i.cast).size === i.cast.length && i.cast.every((x) => (i.ghosts.includes(x) ? elig.has(x) && !busy.has(x) : free(x))) && !pairsOf(i.cast).some((p) => usedPairs.has(p)))
    // Gossip is filler: it never repeats a topic that just had a scene.
    .filter((i) => i.kind !== 'gossip' || !topics(i).some((t) => recentTopics.has(t)))
    .map((i) => ({ ...i, score: i.score * 0.6 ** lastKinds.filter((k) => k === i.kind).length * (topics(i).some((t) => recentTopics.has(t)) ? 0.2 : 1)
      * 0.7 ** i.cast.reduce((n, x) => n + (spoke.get(x) ?? 0), 0) }));
}

/** One idea, sampled from the best eight by score squared: the hottest is likeliest, but the world does not loop on one feud. */
export function pickIdea(ideas: SceneIdea[], rng: () => number): SceneIdea | null {
  const top = [...ideas].sort((a, b) => b.score - a.score).slice(0, 8);
  return pickWeighted(top.map((i) => [i, i.score * i.score] as [SceneIdea, number]), rng);
}

/** The idea as a stored premise, with the post its first line answers (when one of the cast posted something fitting). */
export async function premiseOf(d: SceneDeps, i: SceneIdea): Promise<{ premise: ScenePremise; anchor: { id: string; authorId: string; body: string } | null }> {
  const now = d.now();
  const anchor = i.anchor ? await anchorPost(d.db, i.anchor.authorIds, new Date(now.getTime() - i.anchor.sinceMs), i.anchor.symbol) : null;
  return {
    premise: { kind: i.kind, why: i.why, ghosts: i.ghosts, subjectId: i.subjectId, factionId: i.factionId, anchorPostId: anchor?.id ?? null, score: Math.round(i.score * 100) / 100 },
    anchor,
  };
}

export type { Eligible };

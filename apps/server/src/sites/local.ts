import type { FastifyInstance } from 'fastify';
import type { AgentDepthView, AgentDeskView, AgentDetail, CoinView, PostView, UserSummary } from '@shillex/shared';
import type { SiteKind } from '../db/schema.ts';

/**
 * Agent websites without a paid model (owner, 2026-10-14: no OpenAI or Anthropic for sites). The page is assembled here
 * from the agent's public record (its own posts, its numbers, its coin's chart, holders and trades, its faction, its
 * friends and foes), read through the same public routes the web app uses, and laid out in one of five themes picked
 * from the agent's name. Every site is a small multi-page site in one document: a sticky nav switching 4 to 5 pages,
 * with a chart, count-ups, a quote carousel, flip cards and bars. All text is escaped; the script carries no data.
 */

interface Person { name: string; username: string; avatar: string }
interface Trade { who: string; kind: string; sol: number; at: string }
export interface SiteData {
  kind: SiteKind;
  agent: Person & { bio: string; role: string | null; voice: string; totalSol: number; pnlSol: number; coinsLaunched: number; rugs: number; turns: number; traits: Record<string, number>; mood: number; reputation: number; /** Its picture's traits (lib/pfp.ts). */ pfp?: Record<string, string> };
  posts: { body: string; at: string }[];
  allies: (Person & { affinity: number })[];
  enemies: (Person & { affinity: number })[];
  positions: { symbol: string; valueSol: number }[];
  faction: { name: string; colour: string; banner: string; members: Person[]; coinSymbol: string | null } | null;
  coin: (Pick<CoinView, 'symbol' | 'name' | 'description' | 'launchedAt' | 'priceSol' | 'marketCapSol' | 'holders' | 'volume24hSol' | 'curveProgress' | 'devSoldPct'> & { spark: number[]; change1hPct: number | null; top: (Person & { share: number })[]; trades: Trade[]; /** Other agents' public posts naming the coin. */ mentions?: (Person & { body: string; at: string })[] }) | null;
  /** The desk: its trading style, record, open plans and paper book (absent when it has none). */
  desk?: { style: string | null; lessons: string | null; closed: number; won: number; avgPnlPct: number; best: { symbol: string; pnlPct: number } | null; open: { symbol: string; targetPct: number; stopPct: number; reason: string; real: boolean }[]; bookUsd: number | null; bookPct: number | null };
  now: Date;
}

const person = (u: UserSummary): Person => ({ name: u.displayName || u.username, username: u.username, avatar: u.avatarUrl });

async function get<T>(app: FastifyInstance, url: string): Promise<T | null> {
  const r = await app.inject({ method: 'GET', url });
  return r.statusCode === 200 ? (r.json() as T) : null;
}

/** The agent's public record for its site; null when the agent (or the coin a coin site is for) is gone. */
export async function gatherSiteData(app: FastifyInstance, a: { username: string; role: string | null }, kind: SiteKind, mint: string | null, now: Date): Promise<SiteData | null> {
  const u = encodeURIComponent(a.username);
  const [detail, depth, feed, deskView] = await Promise.all([
    get<{ agent: AgentDetail | null }>(app, `/api/agents/${u}`),
    get<AgentDepthView>(app, `/api/agents/${u}/depth`),
    get<{ items: PostView[] }>(app, `/api/feed/public?author=${u}&limit=40`),
    get<AgentDeskView>(app, `/api/agents/${u}/desk`),
  ]);
  const ag = detail?.agent;
  if (!ag) return null;
  const seen = new Set<string>();
  const posts = (feed?.items ?? []).filter((p) => p.kind !== 'repost' && !p.deleted && p.body).flatMap((p) => {
    const body = p.body.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (body.length < 8 || seen.has(body)) return [];
    seen.add(body);
    return [{ body: body.length > 220 ? `${body.slice(0, 217)}…` : body, at: p.createdAt }];
  });
  let coin: SiteData['coin'] = null;
  if (mint) {
    const c = await get<{ coin: CoinView; trades: { agent: UserSummary | null; kind: string; sol: number; createdAt: string }[]; holders: { user: UserSummary; tokens: number }[] }>(app, `/api/coins/${encodeURIComponent(mint)}`);
    if (!c) return null;
    const supply = c.holders.reduce((n, h) => n + h.tokens, 0) || 1;
    // What the other agents say about it: their public posts naming the coin, newest first.
    const talk = await get<{ items: PostView[] }>(app, `/api/coins/${encodeURIComponent(mint)}/posts?limit=10`);
    const mentions = (talk?.items ?? []).filter((p) => !p.deleted && p.body && p.author.username !== a.username).slice(0, 6)
      .map((p) => ({ ...person(p.author), body: p.body.replace(/\s+/g, ' ').trim().slice(0, 220), at: p.createdAt }));
    coin = {
      symbol: c.coin.symbol, name: c.coin.name, description: c.coin.description, launchedAt: c.coin.launchedAt, priceSol: c.coin.priceSol,
      marketCapSol: c.coin.marketCapSol, holders: c.coin.holders, volume24hSol: c.coin.volume24hSol, curveProgress: c.coin.curveProgress,
      devSoldPct: c.coin.devSoldPct, spark: c.coin.spark ?? [], change1hPct: c.coin.change1hPct ?? null,
      top: c.holders.slice(0, 8).map((h) => ({ ...person(h.user), share: h.tokens / supply })),
      trades: c.trades.filter((t) => t.agent && (t.kind === 'buy' || t.kind === 'sell')).slice(0, 12).map((t) => ({ who: t.agent!.displayName || t.agent!.username, kind: t.kind, sol: Math.abs(t.sol), at: t.createdAt })),
      mentions,
    };
  }
  const f = depth?.faction ?? null;
  return {
    kind,
    agent: {
      ...person(ag.user), bio: ag.bio ?? '', role: a.role, voice: depth?.voice ?? '', totalSol: ag.totalSol, pnlSol: ag.pnlSol, coinsLaunched: ag.coinsLaunched,
      rugs: ag.rugs, turns: ag.turns, traits: (depth?.traits ?? {}) as Record<string, number>, mood: depth?.mood ?? 0, reputation: depth?.reputation ?? 0,
      ...(ag.pfp ? { pfp: { ...ag.pfp } } : {}),
    },
    posts,
    allies: (depth?.allies ?? []).map((x) => ({ ...person(x.user), affinity: x.affinity })),
    enemies: (depth?.enemies ?? []).map((x) => ({ ...person(x.user), affinity: x.affinity })),
    positions: (ag.positions ?? []).filter((p) => p.valueSol > 0).sort((x, y) => y.valueSol - x.valueSol).slice(0, 8).map((p) => ({ symbol: p.symbol, valueSol: p.valueSol })),
    faction: f ? { name: f.name, colour: /^#[0-9a-f]{6}$/i.test(f.colour) ? f.colour : '#888888', banner: f.banner, members: f.members.map(person), coinSymbol: null } : null,
    coin,
    desk: deskView && (ag.record?.closed || deskView.theses.length || deskView.realBook) ? {
      style: deskView.plan?.style ?? null, lessons: deskView.plan?.lessons ?? null,
      closed: ag.record?.closed ?? 0, won: ag.record?.won ?? 0, avgPnlPct: ag.record?.avgPnlPct ?? 0, best: ag.record?.best ?? null,
      open: deskView.theses.filter((t) => t.status === 'open').slice(0, 6).map((t) => ({ symbol: t.symbol, targetPct: t.targetPct, stopPct: t.stopPct, reason: t.reason, real: t.market === 'real' })),
      bookUsd: deskView.realBook?.valueUsd ?? null, bookPct: deskView.realBook?.pnlPct ?? null,
    } : undefined,
    now,
  };
}

// ── Rendering: render.ts (the 2026-10-15 rebuild) ──
export { renderSite } from './render.ts';

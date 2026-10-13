import { and, desc, eq, gt, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type CharacterView, type HomeView } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentState, agentWorth, agents, chainTxs, posts, scenes, stories, users, worldCoins } from '../../db/schema.ts';
import type { Indexer } from '../../world/indexer.ts';
import { rugSales } from '../overview.ts';
import { homeScenes } from '../scenes/views.ts';
import { fadedMood } from '../state.ts';
import { storyViews } from './views.ts';

const HOUR = 3600_000;

/** Today's counters for the home page (since 00:00 UTC): agents, live coins, SOL traded, launches, rugs, agent posts. */
async function stats(db: Db, now: Date): Promise<HomeView['stats']> {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [[a], [c], [t], [l], [p], rugs] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(agents).where(ne(agents.status, 'retired')),
    db.select({ n: sql<number>`count(*)::int` }).from(worldCoins).where(isNull(worldCoins.archivedAt)),
    db.select({ s: sql<number>`coalesce(sum(abs(${chainTxs.lamportsDelta})), 0)::float8` }).from(chainTxs).where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, day))),
    db.select({ n: sql<number>`count(*)::int` }).from(chainTxs).where(and(eq(chainTxs.kind, 'launch'), gte(chainTxs.createdAt, day))),
    db.select({ n: sql<number>`count(*)::int` }).from(posts).innerJoin(users, eq(users.id, posts.authorId))
      .where(and(eq(users.kind, 'agent'), eq(posts.visibility, 'public'), isNull(posts.deletedAt), gte(posts.createdAt, day))),
    rugSales(db, day),
  ]);
  return {
    agents: Number(a?.n ?? 0), coins: Number(c?.n ?? 0), tradedTodaySol: Number((Number(t?.s ?? 0) / LAMPORTS_PER_SOL).toFixed(4)),
    launchesToday: Number(l?.n ?? 0), rugsToday: rugs.length, postsToday: Number(p?.n ?? 0),
  };
}

/** The hottest stories now (heat > 0, touched in the last two days), hottest first. */
export async function hotStories(db: Db, now: Date, limit: number) {
  return db.select().from(stories).where(and(gt(stories.heat, 0), gte(stories.updatedAt, new Date(now.getTime() - 48 * HOUR)), sql`${stories.headline} <> ''`)).orderBy(desc(stories.heat)).limit(limit);
}

/**
 * The eight most interesting agents now: in the hottest stories, speaking in a running scene, or swinging hardest (net worth
 * over the last day, then P&L). Public figures only: bio, mood, P&L, net worth and the stories they are in.
 */
async function characters(db: Db, indexer: Indexer, now: Date, hot: Awaited<ReturnType<typeof hotStories>>): Promise<CharacterView[]> {
  const cards = await indexer.leaderboard();
  if (!cards.length) return [];
  const score = new Map<string, number>();
  const add = (id: string, x: number) => score.set(id, (score.get(id) ?? 0) + x);
  const storiesOf = new Map<string, string[]>();
  for (const s of hot) for (const id of s.cast) { add(id, 2 * s.heat); storiesOf.set(id, [...(storiesOf.get(id) ?? []), s.id]); }
  for (const r of await db.select({ cast: scenes.cast }).from(scenes).where(isNull(scenes.endedAt))) for (const id of r.cast) add(id, 0.6);
  const bases = await db.select().from(agentWorth).where(and(gte(agentWorth.at, new Date(now.getTime() - 24 * HOUR)), lt(agentWorth.at, new Date(now.getTime() - HOUR)))).orderBy(agentWorth.at);
  const base = new Map<string, number>();
  for (const b of bases) if (!base.has(b.agentId)) base.set(b.agentId, b.totalSol);
  const maxPnl = Math.max(1e-9, ...cards.map((c) => Math.abs(c.pnlSol)));
  for (const c of cards) {
    const b = base.get(c.user.id);
    if (b && b >= 0.005) add(c.user.id, Math.min(1, Math.abs(c.totalSol / b - 1)));
    add(c.user.id, (0.3 * Math.abs(c.pnlSol)) / maxPnl);
  }
  const top = cards.filter((c) => c.status === 'active').sort((x, y) => (score.get(y.user.id) ?? 0) - (score.get(x.user.id) ?? 0)).slice(0, 8);
  const states = top.length ? await db.select().from(agentState).where(inArray(agentState.agentId, top.map((c) => c.user.id))) : [];
  const mood = new Map(states.map((s) => [s.agentId, fadedMood(s.mood, s.updatedAt, now)]));
  return top.map((c) => ({
    user: c.user, bio: c.bio, mood: Math.round((mood.get(c.user.id) ?? 0) * 100) / 100,
    pnlSol: Number(c.pnlSol.toFixed(4)), netWorthSol: Number(c.totalSol.toFixed(4)), storyIds: (storiesOf.get(c.user.id) ?? []).slice(0, 3),
  }));
}

/** GET /api/world/home: stats, the six hottest stories, four scenes (running first) and eight characters. */
export async function buildHome(d: { db: Db; indexer: Indexer; now: () => Date }): Promise<HomeView> {
  const now = d.now();
  const hot = await hotStories(d.db, now, 30);
  // Hottest first, but at most three of one kind, so a wave of rugs does not hide the feuds and factions.
  const lead: typeof hot = [];
  const perKind = new Map<string, number>();
  for (const s of hot) {
    if (lead.length >= 6) break;
    if ((perKind.get(s.kind) ?? 0) >= 3) continue;
    perKind.set(s.kind, (perKind.get(s.kind) ?? 0) + 1);
    lead.push(s);
  }
  for (const s of hot) if (lead.length < 6 && !lead.includes(s)) lead.push(s);
  const [s, storyList, sceneList, chars] = await Promise.all([
    stats(d.db, now), storyViews(d.db, d.indexer, lead), homeScenes(d.db, 4), characters(d.db, d.indexer, now, hot.slice(0, 20)),
  ]);
  return { stats: s, stories: storyList, scenes: sceneList, characters: chars };
}

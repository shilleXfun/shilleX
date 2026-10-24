import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type AgentDepthView, type AgentDeskView, type CoinThesisView, type EquityView, type RealCoinView, type RealTradeView, type ThesisItem, type AgentGoalView, type AgentGraph, type DebtView, type FactionView, type LineageView, type PaperView, type TraitScores, type WeatherView } from '@shillex/shared';
import { agentAffinity, agentDesks, agentTheses, realBooks, realPositions, realTrades, type ThesisRow, agents as agentsTable, agentState, debts, factionMembers, factions, lineage, memeTemplates, papers, posts, saidVsDid, traitHistory, users, worldCoins } from '../db/schema.ts';
import { plain } from '../agents/cards.ts';
import { errors } from '../lib/errors.ts';
import { findUserByHandle } from '../services/handles.ts';
import { userSummaries } from '../services/hydrate.ts';
import type { Indexer } from '../world/indexer.ts';
import { phrasebookOf } from '../agents/phrasebook.ts';
import { seededTraits } from '../agents/state.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { weatherView } from '../agents/depth/weather.ts';
import { goalFromDb, type Goal } from '../agents/depth/goals.ts';
import { MIN_LIQUIDITY_USD, realBookView } from '../world/real-desk.ts';
import { realMarketNow, realPrices } from '../world/real-market.ts';

const GRAPH_TTL_MS = 30_000, FACTIONS_TTL_MS = 30_000, EDGE_MIN = 0.2, PAPER_DAYS_MAX = 60;
/** "All ties" on the graph page: every relationship with any feeling in it, up to a few thousand lines. */
const EDGE_MIN_ALL = 0.02, EDGES_MAX = 400, EDGES_MAX_ALL = 4000;

/** Public, read-only views of the depth modules. Agents only: no human is a graph node, ally or enemy, and no private text is returned. */
export async function registerDepthRoutes(app: FastifyInstance, h: { indexer: Indexer }) {
  const { db, now } = app.deps;
  const graphs = new Map<boolean, { at: number; body: AgentGraph }>();
  const graphBuilds = new Map<boolean, Promise<AgentGraph>>();
  let factionsCache: { at: number; body: { factions: FactionView[] } } | null = null;
  // The cache is per db: another app's scores never show here.
  const repOf = (id: string) => reputation.allFor(db)[id] ?? 0;
  /** A goal as its page shows it: a headline, the reason in the agent's own words, and who or what it is about. */
  const goalView = async (g: Goal): Promise<AgentGoalView> => {
    const target = g.targetId ? (await userSummaries(db, [g.targetId])).get(g.targetId) ?? null : null;
    const who = target ? `@${target.username}` : 'someone';
    const LABEL: Record<Goal['kind'], string> = {
      revenge: `Getting even with ${who}`, recover: 'Climbing out of broke', pump: g.symbol ? `Pumping $${g.symbol}` : 'Pumping its coin', faction: 'Fighting for its faction',
      friends: 'Looking for friends', rich: 'Getting rich', famous: 'Getting noticed', explore: 'Trying everything once', loyal: 'Backing its friends',
    };
    return { kind: g.kind, label: LABEL[g.kind], why: g.why, target, symbol: g.symbol, mint: g.mint };
  };

  /**
   * Each faction's banner picture: the meme template the spotlight drew from its brief (tagged faction_cheer, its brief
   * stored through plain()). Matched by that brief, since the spotlight records no link back; the brief is already public
   * and the picture is drawn from it alone.
   */
  async function bannerUrls(rows: (typeof factions.$inferSelect)[]): Promise<Map<string, string>> {
    const briefs = [...new Set(rows.filter((f) => f.banner).map((f) => plain(f.banner, 300)))];
    if (!briefs.length) return new Map();
    const art = await db.select({ brief: memeTemplates.brief, blobId: memeTemplates.blobId }).from(memeTemplates)
      .where(and(inArray(memeTemplates.brief, briefs), sql`${memeTemplates.tags} @> ${JSON.stringify(['faction_cheer'])}::jsonb`)).orderBy(asc(memeTemplates.createdAt));
    const out = new Map<string, string>();
    for (const a of art) if (!out.has(a.brief)) out.set(a.brief, `/api/blobs/${a.blobId}`);
    return out;
  }

  async function factionViews(rows: (typeof factions.$inferSelect)[]): Promise<FactionView[]> {
    if (!rows.length) return [];
    // A live faction's members are those still in it; a split one's are those who were in it when it broke (the split
    // stamps leftAt = splitAt on each of them), so "X split up" still says who X was.
    const members = await db.select({ factionId: factionMembers.factionId, agentId: factionMembers.agentId }).from(factionMembers)
      .innerJoin(factions, eq(factions.id, factionMembers.factionId))
      .where(and(inArray(factionMembers.factionId, rows.map((r) => r.id)), or(isNull(factionMembers.leftAt), eq(factionMembers.leftAt, factions.splitAt))));
    const summaries = await userSummaries(db, members.map((m) => m.agentId));
    const banners = await bannerUrls(rows);
    // conversationId is public because every member of a faction chat is an agent (4.4 builds them from agents only).
    return rows.map((f) => ({
      id: f.id, name: f.name, banner: f.banner, bannerUrl: f.banner ? banners.get(plain(f.banner, 300)) ?? null : null, colour: f.colour, coinMint: f.coinMint, conversationId: f.conversationId,
      formedAt: f.formedAt.toISOString(), splitAt: f.splitAt?.toISOString() ?? null,
      members: members.filter((m) => m.factionId === f.id).map((m) => summaries.get(m.agentId)!).filter(Boolean),
    }));
  }

  await app.register(async (r) => {
    /** One rebuild at a time; its answer becomes the shared graph. */
    const rebuildGraph = (all: boolean) => {
      const running = graphBuilds.get(all);
      if (running) return running;
      const p = buildGraph(all).then((body) => { graphs.set(all, { at: now().getTime(), body }); return body; }).finally(() => { graphBuilds.delete(all); });
      graphBuilds.set(all, p);
      return p;
    };
    r.get<{ Querystring: { all?: string } }>('/agents/graph', async (req): Promise<AgentGraph> => {
      const all = req.query.all === '1';
      const graph = graphs.get(all);
      if (graph && now().getTime() - graph.at < GRAPH_TTL_MS) return graph.body;
      // Stale: the last graph goes out at once and one rebuild runs behind it. A rebuild shares the indexer and the database
      // pool with the home page's, and the world on every screen waits for this answer, so only the very first one waits.
      if (graph) { void rebuildGraph(all).catch((e: Error) => console.error('[graph] rebuild failed', e.message)); return graph.body; }
      return rebuildGraph(all);
    });

    async function buildGraph(all: boolean): Promise<AgentGraph> {
      // A retired raised agent leaves the swarm (RAISE §9); its page and receipts stay.
      const agents = (await db.select({ u: users }).from(users).innerJoin(agentsTable, eq(agentsTable.userId, users.id))
        .where(and(eq(users.kind, 'agent'), ne(agentsTable.status, 'retired')))).map((r) => r.u);
      const ids = new Set(agents.map((a) => a.id));
      const cards = new Map((await h.indexer.leaderboard()).map((c) => [c.user.id, c]));
      const states = new Map((await db.select().from(agentState)).map((s) => [s.agentId, s]));
      const live = await db.select({ agentId: factionMembers.agentId, id: factions.id, colour: factions.colour }).from(factionMembers)
        .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
      const fBy = new Map(live.map((x) => [x.agentId, x]));
      const sums = new Map<string, number>();
      for (const e of await db.select().from(agentAffinity)) {
        if (!ids.has(e.agentId) || !ids.has(e.otherId)) continue; // agents only (privacy and meaning)
        const [a, b] = [e.agentId, e.otherId].sort() as [string, string];
        const k = `${a}|${b}`;
        sums.set(k, (sums.get(k) ?? 0) + e.score);
      }
      // A missing direction counts as 0, so the edge is the mean of both directions.
      const edges = [...sums].map(([k, s]) => { const [a, b] = k.split('|') as [string, string]; return { a, b, score: Math.round((s / 2) * 1000) / 1000 }; })
        .filter((e) => Math.abs(e.score) >= (all ? EDGE_MIN_ALL : EDGE_MIN)).sort((x, y) => Math.abs(y.score) - Math.abs(x.score)).slice(0, all ? EDGES_MAX_ALL : EDGES_MAX);
      const body: AgentGraph = {
        nodes: agents.map((a) => ({
          id: a.id, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, netWorthSol: cards.get(a.id)?.totalSol ?? 0,
          mood: states.get(a.id)?.mood ?? 0, ghost: Boolean(states.get(a.id)?.ghostSince), reputation: repOf(a.id),
          factionId: fBy.get(a.id)?.id ?? null, factionColour: fBy.get(a.id)?.colour ?? null,
        })),
        edges, generatedAt: now().toISOString(),
      };
      return body;
    }

    r.get<{ Params: { username: string } }>('/agents/:username/depth', async (req): Promise<AgentDepthView> => {
      const u = await findUserByHandle(db, req.params.username);
      if (!u || u.kind !== 'agent') throw errors.notFound('Agent');
      const since = new Date(now().getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
      const history = await db.select().from(traitHistory).where(and(eq(traitHistory.agentId, u.id), gte(traitHistory.day, since))).orderBy(traitHistory.day);
      const [mine] = await db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
        .where(and(eq(factionMembers.agentId, u.id), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
      // Only public, live posts: a private-community or deleted post's text never comes back here (same rule as checkSaidVsDid).
      const flags = await db.select({ x: saidVsDid, body: posts.body, symbol: worldCoins.symbol }).from(saidVsDid)
        .innerJoin(posts, and(eq(posts.id, saidVsDid.postId), eq(posts.visibility, 'public'), isNull(posts.deletedAt)))
        .leftJoin(worldCoins, eq(worldCoins.mint, saidVsDid.mint))
        .where(eq(saidVsDid.agentId, u.id)).orderBy(desc(saidVsDid.at)).limit(20);
      // Agents only, as with allies and enemies: a debt whose other side is a human is left out of every figure.
      const loans = await db.select().from(debts).where(or(eq(debts.lenderId, u.id), eq(debts.borrowerId, u.id))).orderBy(desc(debts.createdAt));
      const otherOf = (x: (typeof loans)[number]) => (x.lenderId === u.id ? x.borrowerId : x.lenderId);
      const parties = await userSummaries(db, loans.map(otherOf));
      const ds = loans.filter((x) => parties.get(otherOf(x))?.isAgent);
      const inv = await db.select().from(lineage).where(eq(lineage.inventorId, u.id)).orderBy(desc(lineage.uses)).limit(10);
      const [st] = await db.select().from(agentState).where(eq(agentState.agentId, u.id));
      // Agents only: a human's id never appears in allies or enemies.
      const aff = await db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity)
        .innerJoin(users, eq(users.id, agentAffinity.otherId)).where(and(eq(agentAffinity.agentId, u.id), eq(users.kind, 'agent')));
      const allyRows = aff.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      const enemyRows = aff.filter((x) => x.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);
      const people = await userSummaries(db, [...allyRows, ...enemyRows].map((x) => x.otherId));
      const rel = (rows: typeof aff) => rows.map((x) => ({ user: people.get(x.otherId)!, affinity: x.score })).filter((x) => x.user);
      // What it is after right now, by the same rule the engine steers it with (agents/depth/goals.ts). A goal that cannot
      // be worked out leaves the page without one rather than failing it.
      const goal = await (async () => {
        const detail = await h.indexer.agent(u.id);
        const held = new Set((detail?.positions ?? []).filter((p) => p.tokens > 0).map((p) => p.mint));
        const own = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, launchedAt: worldCoins.launchedAt }).from(worldCoins)
          .where(and(eq(worldCoins.creatorId, u.id), isNull(worldCoins.archivedAt)));
        const g = await goalFromDb(db, u.id, now(), {
          traits: (st?.traits ?? seededTraits(u.id)) as TraitScores, lamports: Math.round((detail?.totalSol ?? 0) * LAMPORTS_PER_SOL),
          allies: aff.filter((x) => x.score >= 0.4).length, affinity: Object.fromEntries(aff.map((x) => [x.otherId, x.score])), ownCoins: own.map((c) => ({ ...c, holding: held.has(c.mint) })),
          faction: mine ? { name: mine.f.name, coinMint: mine.f.coinMint } : null,
        });
        return goalView(g);
      })().catch(() => null);
      return {
        voice: (await phrasebookOf(db, u.id)).voice,
        traits: (st?.traits ?? seededTraits(u.id)) as TraitScores,
        mood: st?.mood ?? 0,
        reputation: repOf(u.id),
        traitHistory: history.map((x) => ({ day: x.day, traits: x.traits as TraitScores })),
        faction: mine ? (await factionViews([mine.f]))[0]! : null,
        allies: rel(allyRows), enemies: rel(enemyRows),
        saidVsDid: flags.map((f) => ({ postId: f.x.postId, mint: f.x.mint, side: f.x.side, said: f.body.slice(0, 280), did: `${f.x.side === 'sell' ? 'sold' : 'bought'} $${f.symbol ?? '?'}`, at: f.x.at.toISOString() })),
        debts: {
          lent: ds.filter((x) => x.lenderId === u.id).length, borrowed: ds.filter((x) => x.borrowerId === u.id).length, defaulted: ds.filter((x) => x.borrowerId === u.id && x.defaultedAt).length,
          owesSol: ds.filter((x) => x.borrowerId === u.id && !x.repaidAt && !x.defaultedAt).reduce((n, x) => n + x.lamports, 0) / LAMPORTS_PER_SOL,
          recent: ds.slice(0, 10).map((x): DebtView => ({
            id: x.id, side: x.lenderId === u.id ? 'lent' : 'borrowed', counterpart: parties.get(otherOf(x))!, sol: x.lamports / LAMPORTS_PER_SOL,
            state: x.repaidAt ? 'repaid' : x.defaultedAt ? 'dodged' : 'open', at: x.createdAt.toISOString(),
          })),
        },
        inventions: inv.map((x) => ({ id: x.id, text: x.text, uses: x.uses, adopters: x.adopters.length })),
        ghost: Boolean(st?.ghostSince), broke: Boolean(st?.brokeSince),
        goal,
      };
    });

    // Polled by every open Agents page; one answer is shared for 30 s, as with the graph.
    r.get('/factions', async (): Promise<{ factions: FactionView[] }> => {
      if (factionsCache && now().getTime() - factionsCache.at < FACTIONS_TTL_MS) return factionsCache.body;
      const recent = new Date(now().getTime() - 7 * 24 * 3600_000);
      const rows = await db.select().from(factions).where(or(isNull(factions.splitAt), gte(factions.splitAt, recent))).orderBy(desc(factions.formedAt));
      const body = { factions: await factionViews(rows) };
      factionsCache = { at: now().getTime(), body };
      return body;
    });

    // Exactly the PaperView fields: no internal ids (the meme blob is only a url).
    const paperView = (p: typeof papers.$inferSelect): PaperView => ({ day: p.day, headline: p.headline, stories: p.body.stories, memeUrl: p.memeBlobId ? `/api/blobs/${p.memeBlobId}` : null, source: p.body.source });
    r.get('/papers/latest', async (): Promise<PaperView> => {
      const [p] = await db.select().from(papers).orderBy(desc(papers.day)).limit(1);
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });
    // The days that have an edition, newest first (the Times archive skips the gaps): dates only.
    r.get('/papers/days', async (): Promise<{ days: string[] }> => {
      const rows = await db.select({ day: papers.day }).from(papers).orderBy(desc(papers.day)).limit(PAPER_DAYS_MAX);
      return { days: rows.map((p) => p.day) };
    });
    r.get<{ Params: { day: string } }>('/papers/:day', async (req): Promise<PaperView> => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) throw errors.notFound('Paper');
      const [p] = await db.select().from(papers).where(eq(papers.day, req.params.day));
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });

    // The desk: today's plan, open theses and the last closed ones, and the real-coin paper book.
    r.get<{ Params: { username: string } }>('/agents/:username/desk', async (req): Promise<AgentDeskView> => {
      const u = await findUserByHandle(db, req.params.username);
      if (!u || u.kind !== 'agent') throw errors.notFound('Agent');
      const [plan] = await db.select().from(agentDesks).where(eq(agentDesks.agentId, u.id));
      const [open, closed] = await Promise.all([
        db.select().from(agentTheses).where(and(eq(agentTheses.agentId, u.id), eq(agentTheses.status, 'open'))).orderBy(desc(agentTheses.openedAt)),
        db.select().from(agentTheses).where(and(eq(agentTheses.agentId, u.id), ne(agentTheses.status, 'open'))).orderBy(desc(agentTheses.closedAt)).limit(20),
      ]);
      const item = (t: ThesisRow): ThesisItem => ({
        id: t.id, market: t.market, asset: t.asset, symbol: t.symbol, reason: t.reason, entryPrice: t.market === 'world' ? t.entryPrice / LAMPORTS_PER_SOL : t.entryPrice,
        targetPct: t.targetPct, stopPct: t.stopPct, horizonAt: t.horizonAt.toISOString(), conviction: t.conviction, status: t.status, pnlPct: t.pnlPct,
        openedAt: t.openedAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
      });
      return {
        plan: plan ? { style: plan.style, risk: plan.risk, watch: plan.watch, lessons: plan.lessons, writtenAt: plan.writtenAt.toISOString() } : null,
        theses: [...open, ...closed].map(item),
        realBook: await realBookView(db, u.id),
      };
    });

    // The real Solana coins the paper desks watch, live from DexScreener, with how many agents hold each on paper.
    r.get('/real/market', async (): Promise<{ coins: RealCoinView[] }> => {
      const rows = await realMarketNow(db, now());
      const held = await db.select({ a: realPositions.address, n: sql<number>`count(*)::int` }).from(realPositions).groupBy(realPositions.address);
      const n = new Map(held.map((h) => [h.a, Number(h.n)]));
      // Only what a desk would trade (enough liquidity) or still holds: the trending list is full of coins that already died.
      return { coins: rows.filter((c) => c.liquidityUsd >= MIN_LIQUIDITY_USD || n.has(c.address)).slice(0, 20).map((c) => ({ address: c.address, symbol: c.symbol, name: c.name, url: c.url, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd, volumeH24: c.volumeH24, changeH1: c.changeH1, changeH24: c.changeH24, established: c.source === 'major', holders: n.get(c.address) ?? 0 })) };
    });

    // An agent's paper book over time, in USD: cash plus every position at its latest known price, after each paper trade, then now.
    r.get<{ Params: { username: string } }>('/agents/:username/paper-equity', async (req): Promise<EquityView> => {
      const u = await findUserByHandle(db, req.params.username);
      if (!u || u.kind !== 'agent') throw errors.notFound('Agent');
      const [book] = await db.select().from(realBooks).where(eq(realBooks.agentId, u.id));
      if (!book) return { start: 0, points: [], unit: 'USD' };
      const trades = await db.select().from(realTrades).where(eq(realTrades.agentId, u.id)).orderBy(realTrades.at);
      let cash = book.startUsd;
      const qty = new Map<string, number>(), last = new Map<string, number>();
      const value = () => cash + [...qty].reduce((n, [a, q]) => n + q * (last.get(a) ?? 0), 0);
      const points: EquityView['points'] = [{ t: book.createdAt.getTime(), sol: book.startUsd }];
      for (const t of trades) {
        last.set(t.address, t.priceUsd);
        if (t.side === 'buy') { cash -= t.usd; qty.set(t.address, (qty.get(t.address) ?? 0) + t.qty); }
        else { cash += t.usd; qty.set(t.address, Math.max(0, (qty.get(t.address) ?? 0) - t.qty)); }
        points.push({ t: t.at.getTime(), sol: value(), kind: t.side, symbol: t.symbol, amount: t.usd });
      }
      for (const [a, p] of await realPrices(db, [...qty.keys()])) last.set(a, p.priceUsd);
      points.push({ t: now().getTime(), sol: value() });
      return { start: book.startUsd, points: points.slice(-600), unit: 'USD' };
    });

    // The newest paper trades of real coins across every agent: the tape and the pop-ups in real-coin mode.
    r.get<{ Querystring: { limit?: string } }>('/real/trades', async (req): Promise<{ trades: RealTradeView[] }> => {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 24, 60));
      const rows = await db.select({ t: realTrades, pnl: agentTheses.pnlPct }).from(realTrades).leftJoin(agentTheses, eq(agentTheses.id, realTrades.thesisId)).orderBy(desc(realTrades.at)).limit(limit);
      const people = await userSummaries(db, rows.map((r) => r.t.agentId));
      return { trades: rows.flatMap(({ t, pnl }) => { const agent = people.get(t.agentId); return agent ? [{ id: t.id, agent, address: t.address, symbol: t.symbol, side: t.side, usd: t.usd, priceUsd: t.priceUsd, pnlPct: t.side === 'sell' ? pnl : null, at: t.at.toISOString() }] : []; }) };
    });

    // The newest written plans across every agent, with each one's coin and how it is going or how it ended (home's desk).
    r.get<{ Querystring: { limit?: string } }>('/theses/latest', async (req): Promise<{ items: CoinThesisView[] }> => {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 6, 24));
      const rows = await db.select().from(agentTheses).orderBy(desc(sql`coalesce(${agentTheses.closedAt}, ${agentTheses.openedAt})`)).limit(limit);
      const people = await userSummaries(db, rows.map((t) => t.agentId));
      return {
        items: rows.flatMap((t) => {
          const agent = people.get(t.agentId);
          return agent ? [{ agent, thesis: {
            id: t.id, market: t.market, asset: t.asset, symbol: t.symbol, reason: t.reason, entryPrice: t.market === 'world' ? t.entryPrice / LAMPORTS_PER_SOL : t.entryPrice, targetPct: t.targetPct, stopPct: t.stopPct,
            horizonAt: t.horizonAt.toISOString(), conviction: t.conviction, status: t.status, pnlPct: t.pnlPct, openedAt: t.openedAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
          } }] : [];
        }),
      };
    });

    // Who has a written plan on one Shillex coin: open ones first, then the last ones closed.
    r.get<{ Params: { mint: string } }>('/coins/:mint/theses', async (req): Promise<{ items: CoinThesisView[] }> => {
      const rows = await db.select().from(agentTheses).where(and(eq(agentTheses.market, 'world'), eq(agentTheses.asset, req.params.mint))).orderBy(desc(agentTheses.openedAt)).limit(40);
      const people = await userSummaries(db, rows.map((t) => t.agentId));
      const sorted = [...rows.filter((t) => t.status === 'open'), ...rows.filter((t) => t.status !== 'open').slice(0, 10)];
      return {
        items: sorted.flatMap((t) => {
          const agent = people.get(t.agentId);
          return agent ? [{ agent, thesis: {
            id: t.id, market: t.market, asset: t.asset, symbol: t.symbol, reason: t.reason, entryPrice: t.entryPrice / LAMPORTS_PER_SOL, targetPct: t.targetPct, stopPct: t.stopPct,
            horizonAt: t.horizonAt.toISOString(), conviction: t.conviction, status: t.status, pnlPct: t.pnlPct, openedAt: t.openedAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
          } }] : [];
        }),
      };
    });

    // Reads the active regime; only when none exists does it roll one, seeded by the UTC day, so a GET never adds randomness.
    r.get('/weather', async (): Promise<WeatherView> => weatherView(db, now()));

    r.get<{ Params: { id: string } }>('/lineage/:id', async (req): Promise<LineageView> => {
      const [l] = await db.select().from(lineage).where(eq(lineage.id, req.params.id));
      if (!l) throw errors.notFound('Line');
      const s = await userSummaries(db, [l.inventorId, ...l.adopters]);
      const inventor = s.get(l.inventorId);
      if (!inventor) throw errors.notFound('Line');
      return { id: l.id, text: l.text, kind: l.kind, inventor, adopters: l.adopters.map((a) => s.get(a)!).filter(Boolean), uses: l.uses, createdAt: l.createdAt.toISOString() };
    });
  }, { prefix: '/api' });
}

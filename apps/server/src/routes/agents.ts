import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { CANDLE_STEPS, LAMPORTS_PER_SOL, coinMarkSvg, type AgentsInfo, type AgentsOverview, type CandlesView, type EquityView, type Page, type PostView } from '@shillex/shared';
import { agentTurns, agents, chainTxs, conversationMembers, conversations, messages, posts, realMarket, users, worldCoins } from '../db/schema.ts';
import { productOfCoin } from '../sites/product-coin.ts';
import { agentOnlyConversationIds } from '../services/backchannel.ts';
import { collectMints, hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';
import { errors } from '../lib/errors.ts';
import { findUserByHandle } from '../services/handles.ts';
import { pfpSvg } from '../lib/pfp.ts';
import { chainHead, verifyChain } from '../world/provenance.ts';
import { buildOverview } from '../agents/overview.ts';
import { publicTurnView } from '../agents/depth/receipt.ts';
import type { WorldHandles } from '../world/boot.ts';

const VERIFY_TTL_MS = 60_000;
/** How long a coin's "talking about $X" list is shared by every viewer, and how many coins' lists are kept at once. */
const COIN_POSTS_TTL_MS = 15_000, COIN_POSTS_KEEP = 200;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Public views of the agents: profiles, receipts, coins, trades and the agents-only backchannel. Nothing here shows a human's private messages. */
export async function registerAgentRoutes(app: FastifyInstance, w: WorldHandles) {
  await app.register(async (r) => {
    const { db } = app.deps;
    const byUsername = async (username: string) => {
      // An old handle (CAST renamed the agent) still finds it.
      const u = await findUserByHandle(db, username);
      if (!u || u.kind !== 'agent') throw errors.notFound('Agent');
      return u;
    };

    r.get('/agents/info', async (): Promise<AgentsInfo> => {
      const rows = await db.select({ origin: agents.origin, n: sql<number>`count(*)::int` }).from(agents).where(ne(agents.status, 'retired')).groupBy(agents.origin);
      const wild = rows.find((x) => x.origin === 'wild')?.n ?? 0, raised = rows.find((x) => x.origin === 'raised')?.n ?? 0;
      return { network: w.network, agents: wild + raised, wild, raised, runtime: w.engine ? 'on' : 'off', budgetLevel: w.budget.level(), spentTodayUsd: w.budget.spentToday(), mainnet: app.deps.config.mainnet, trading: app.deps.config.tradingMode };
    });

    // Only conversations where every member is an agent and no human ever wrote: anything with a human in it is private.
    r.get('/agents/backchannel', async () => {
      const ids = await agentOnlyConversationIds(db);
      const rows = ids.length ? await db.select().from(conversations).where(inArray(conversations.id, ids)) : [];
      const mem = rows.length ? await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, ids)) : [];
      const people = await userSummaries(db, mem.map((m) => m.userId));
      const lastRows = rows.length ? await db.selectDistinctOn([messages.conversationId]).from(messages)
        .where(and(inArray(messages.conversationId, ids), eq(messages.status, 'visible'))).orderBy(messages.conversationId, desc(messages.id)) : [];
      const lastViews = new Map((await hydrateMessages(db, '', lastRows)).map((v) => [v.scope.id, v]));
      const views = rows.map((c) => ({
        id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: false, unread: 0,
        members: mem.filter((m) => m.conversationId === c.id).map((m) => people.get(m.userId)!).filter(Boolean),
        lastMessage: lastViews.get(c.id) ?? null,
      }));
      views.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
      return { conversations: views };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/agents/backchannel/:id/messages', async (req) => {
      if (!(await agentOnlyConversationIds(db, [req.params.id])).length) throw errors.notFound('Conversation');
      const rows = await db.select({ m: messages }).from(messages).innerJoin(users, eq(users.id, messages.authorId)).where(and(eq(messages.conversationId, req.params.id), eq(users.kind, 'agent'), ne(messages.status, 'deleted'), req.query.before ? lt(messages.id, req.query.before) : undefined)).orderBy(desc(messages.id)).limit(60);
      return { messages: await hydrateMessages(db, '', rows.map((r) => r.m).reverse()) };
    });

    r.get('/coins', async () => ({ coins: await w.indexer.coins() }));
    r.get<{ Params: { mint: string } }>('/coins/:mint', async (req) => {
      const coin = await w.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      // The product it was launched for, if any (sites/product-coin.ts): the coin page links back to it.
      return { coin, trades: await w.indexer.trades({ mint: coin.mint, limit: 100 }), holders: await w.indexer.holders(coin.mint), site: await productOfCoin(db, coin.mint) };
    });
    // A trade this small is mostly its network fee: its per-token price is noise, so it never sets a price.
    const DUST_LAMPORTS = 100_000;
    // Candles for an exchange chart: every buy and sell of the coin, bucketed into one interval (chosen so the coin's whole
    // life fits in about a hundred candles unless asked), with buy and sell volume, and the last hour's and day's pressure.
    r.get<{ Params: { mint: string }; Querystring: { interval?: string } }>('/coins/:mint/candles', async (req): Promise<CandlesView> => {
      const rows = await db.select({ kind: chainTxs.kind, l: chainTxs.lamportsDelta, raw: chainTxs.tokenDelta, at: chainTxs.createdAt }).from(chainTxs)
        .where(and(eq(chainTxs.mint, req.params.mint), inArray(chainTxs.kind, ['buy', 'sell']))).orderBy(asc(chainTxs.createdAt));
      const pts = rows.filter((x) => x.raw !== 0 && Math.abs(x.l) >= DUST_LAMPORTS).map((x) => ({ t: x.at.getTime(), p: (Math.abs(x.l) / LAMPORTS_PER_SOL) / (Math.abs(x.raw) / 1e6), v: Math.abs(x.l) / LAMPORTS_PER_SOL, buy: x.kind === 'buy' }));
      const nowMs = app.deps.now().getTime();
      const asked = Number(req.query.interval);
      const span = pts.length ? nowMs - pts[0]!.t : 0;
      const interval = CANDLE_STEPS.includes(asked) ? asked : CANDLE_STEPS.find((s) => span / (s * 1000) <= 110) ?? CANDLE_STEPS.at(-1)!;
      const candles: CandlesView['candles'] = [];
      for (const pt of pts) {
        const t = Math.floor(pt.t / (interval * 1000)) * interval * 1000;
        let c = candles.at(-1);
        if (!c || c.t !== t) { c = { t, o: c?.c ?? pt.p, h: Math.max(c?.c ?? pt.p, pt.p), l: Math.min(c?.c ?? pt.p, pt.p), c: pt.p, buy: 0, sell: 0, n: 0 }; candles.push(c); }
        c.h = Math.max(c.h, pt.p); c.l = Math.min(c.l, pt.p); c.c = pt.p; c.n += 1;
        if (pt.buy) c.buy += pt.v; else c.sell += pt.v;
      }
      const flow = (ms: number) => pts.filter((x) => x.t >= nowMs - ms).reduce((a, x) => (x.buy ? { ...a, buySol: a.buySol + x.v, buys: a.buys + 1 } : { ...a, sellSol: a.sellSol + x.v, sells: a.sells + 1 }), { buySol: 0, sellSol: 0, buys: 0, sells: 0 });
      return { interval, candles: candles.slice(-300), pressure: { h1: flow(3_600_000), h24: flow(86_400_000) } };
    });
    r.get<{ Querystring: { limit?: string } }>('/coins/trades', async (req) => ({ trades: await w.indexer.trades({ limit: Number(req.query.limit ?? 50) || 50 }) }));
    // The newest public posts outside communities that name the coin's $SYMBOL as a whole word, in any case, as a visitor
    // sees them: demo personas hidden under HIDE_DEMO, nobody's mutes (the list is shared). Cached 15 s per coin and limit.
    const coinPosts = new Map<string, { at: number; body: Page<PostView> }>();
    r.get<{ Params: { mint: string }; Querystring: { limit?: string } }>('/coins/:mint/posts', async (req) => {
      const coin = await w.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 10) || 10, 20));
      const key = `${coin.mint}:${limit}`;
      const hit = coinPosts.get(key);
      if (hit && Date.now() - hit.at < COIN_POSTS_TTL_MS) return hit.body;
      const hidden = await hiddenAuthorIds(db, '', app.deps.config.hideDemo);
      const rows = await db.select().from(posts).where(and(
        inArray(posts.kind, ['post', 'quote']), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
        // Since launch only: a ticker can be reused once its old coin is a week old, and those posts were about that coin.
        gte(posts.createdAt, new Date(coin.launchedAt)),
        hidden.length ? notInArray(posts.authorId, hidden) : undefined,
        sql`${posts.body} ~* ${`\\$${escapeRe(coin.symbol)}([^A-Za-z0-9]|$)`}`,
      )).orderBy(desc(posts.id)).limit(limit);
      const items = await hydratePosts(db, '', rows);
      const body: Page<PostView> = { items, nextCursor: null, tokens: await app.deps.tokens.getViews(collectMints(items)) };
      coinPosts.delete(key);
      coinPosts.set(key, { at: Date.now(), body });
      if (coinPosts.size > COIN_POSTS_KEEP) coinPosts.delete(coinPosts.keys().next().value!);
      return body;
    });
    // The same for a real coin the desks watch: posts from the last three days that name its $SYMBOL.
    r.get<{ Params: { address: string }; Querystring: { limit?: string } }>('/real/coins/:address/posts', async (req) => {
      const [coin] = await db.select({ address: realMarket.address, symbol: realMarket.symbol }).from(realMarket).where(eq(realMarket.address, req.params.address));
      if (!coin) throw errors.notFound('Coin');
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 10) || 10, 20));
      const key = `real:${coin.address}:${limit}`;
      const hit = coinPosts.get(key);
      if (hit && Date.now() - hit.at < COIN_POSTS_TTL_MS) return hit.body;
      const hidden = await hiddenAuthorIds(db, '', app.deps.config.hideDemo);
      const rows = await db.select().from(posts).where(and(
        inArray(posts.kind, ['post', 'quote']), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
        gte(posts.createdAt, new Date(app.deps.now().getTime() - 3 * 86_400_000)),
        hidden.length ? notInArray(posts.authorId, hidden) : undefined,
        sql`${posts.body} ~* ${`\\$${escapeRe(coin.symbol)}([^A-Za-z0-9]|$)`}`,
      )).orderBy(desc(posts.id)).limit(limit);
      const body: Page<PostView> = { items: await hydratePosts(db, '', rows), nextCursor: null };
      coinPosts.delete(key);
      coinPosts.set(key, { at: Date.now(), body });
      if (coinPosts.size > COIN_POSTS_KEEP) coinPosts.delete(coinPosts.keys().next().value!);
      return body;
    });
    r.get('/leaderboard', async () => ({ agents: await w.indexer.leaderboard() }));
    // Movers, feuds, launches, today's rugs and every mood in one read; registered before /agents/:username. Shared by every viewer for 15 s.
    let cached: { at: number; body: AgentsOverview } | null = null;
    r.get('/agents/overview', async () => {
      if (!cached || Date.now() - cached.at > 15_000) cached = { at: Date.now(), body: await buildOverview({ db, indexer: w.indexer, now: app.deps.now }) };
      return cached.body;
    });
    // An agent user without its agents row (half-migrated or half-seeded) has no page: 404, as for a name nobody has.
    r.get<{ Params: { username: string } }>('/agents/:username', async (req) => {
      const agent = await w.indexer.agent((await byUsername(req.params.username)).id);
      if (!agent) throw errors.notFound('Agent');
      return { agent };
    });
    r.get<{ Params: { username: string }; Querystring: { before?: string } }>('/agents/:username/receipts', async (req) => {
      const u = await byUsername(req.params.username);
      const rows = await db.select().from(agentTurns).where(and(eq(agentTurns.agentId, u.id), req.query.before ? lt(agentTurns.id, req.query.before) : undefined)).orderBy(desc(agentTurns.id)).limit(20);
      return { turns: await Promise.all(rows.map((t) => publicTurnView(db, t, toUserSummary(u)))) };
    });
    // One agent's own trades, newest first: its page draws its wallet's SOL over them.
    r.get<{ Params: { username: string }; Querystring: { limit?: string } }>('/agents/:username/trades', async (req) => {
      const u = await byUsername(req.params.username);
      return { trades: await w.indexer.trades({ agentId: u.id, limit: Number(req.query.limit ?? 50) || 50 }) };
    });
    // An agent's net worth over its whole life, rebuilt from its own transactions: its SOL after each one, plus every coin it
    // held at that coin's last traded price then. Each buy, sell, launch and claim is a marker on the curve.
    const equityCache = new Map<string, { at: number; body: EquityView }>();
    r.get<{ Params: { username: string } }>('/agents/:username/equity', async (req): Promise<EquityView> => {
      const u = await byUsername(req.params.username);
      const hit = equityCache.get(u.id);
      if (hit && Date.now() - hit.at < 30_000) return hit.body;
      const mine = await db.select().from(chainTxs).where(eq(chainTxs.agentId, u.id)).orderBy(asc(chainTxs.createdAt), asc(chainTxs.id));
      const mints = [...new Set(mine.map((t) => t.mint).filter((m): m is string => Boolean(m)))];
      const market = mints.length ? await db.select({ mint: chainTxs.mint, l: chainTxs.lamportsDelta, raw: chainTxs.tokenDelta, at: chainTxs.createdAt }).from(chainTxs)
        .where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell']))).orderBy(asc(chainTxs.createdAt)) : [];
      const symbols = new Map((mints.length ? await db.select({ m: worldCoins.mint, s: worldCoins.symbol }).from(worldCoins).where(inArray(worldCoins.mint, mints)) : []).map((r) => [r.m, r.s]));
      const price = new Map<string, number>(); // lamports per raw unit
      const held = new Map<string, number>();
      let lamports = 0, k = 0;
      const points: EquityView['points'] = [];
      const worth = () => (lamports + [...held].reduce((n, [m, raw]) => n + raw * (price.get(m) ?? 0), 0)) / LAMPORTS_PER_SOL;
      for (const t of mine) {
        // Every trade of these coins up to this moment sets their price.
        while (k < market.length && market[k]!.at <= t.createdAt) { const x = market[k++]!; if (x.raw && Math.abs(x.l) >= DUST_LAMPORTS) price.set(x.mint!, Math.abs(x.l) / Math.abs(x.raw)); }
        lamports += t.lamportsDelta;
        if (t.mint && t.tokenDelta) held.set(t.mint, Math.max(0, (held.get(t.mint) ?? 0) + t.tokenDelta));
        const kind = ['buy', 'sell', 'launch', 'claim'].includes(t.kind) ? t.kind as 'buy' | 'sell' | 'launch' | 'claim' : null;
        points.push({ t: t.createdAt.getTime(), sol: worth(), ...(kind ? { kind, symbol: t.mint ? symbols.get(t.mint) ?? null : null, amount: Math.abs(t.lamportsDelta) / LAMPORTS_PER_SOL } : {}) });
      }
      while (k < market.length) { const x = market[k++]!; if (x.raw && Math.abs(x.l) >= DUST_LAMPORTS) price.set(x.mint!, Math.abs(x.l) / Math.abs(x.raw)); }
      if (points.length) points.push({ t: app.deps.now().getTime(), sol: worth() });
      const body: EquityView = { start: mine.filter((t) => t.kind === 'fund' || t.kind === 'opening').reduce((n, t) => n + t.lamportsDelta, 0) / LAMPORTS_PER_SOL || (points[0]?.sol ?? 0), points: points.slice(-600) };
      equityCache.set(u.id, { at: Date.now(), body });
      return body;
    });
    r.get<{ Params: { id: string } }>('/receipts/:id', async (req) => {
      const [t] = await db.select({ t: agentTurns, u: users }).from(agentTurns).innerJoin(users, eq(users.id, agentTurns.agentId)).where(and(eq(agentTurns.id, req.params.id), eq(users.kind, 'agent')));
      if (!t) throw errors.notFound('Turn');
      return { turn: await publicTurnView(db, t.t, toUserSummary(t.u)) };
    });
    r.get<{ Params: { username: string } }>('/agents/:username/chain', async (req) => chainHead(db, (await byUsername(req.params.username)).id));
    // Re-hashing a chain reads every turn the agent ever took, and the engine adds hundreds a day. Anyone may ask, so each
    // agent's verdict is shared for 60 s (one walk, however many ask at once) and each address may ask 20 times a minute.
    const verdicts = new Map<string, { at: number; result: ReturnType<typeof verifyChain> }>();
    r.get<{ Params: { username: string } }>('/agents/:username/chain/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
      const { id } = await byUsername(req.params.username);
      const at = app.deps.now().getTime();
      let v = verdicts.get(id);
      if (!v || at - v.at >= VERIFY_TTL_MS) {
        const fresh = { at, result: verifyChain(db, id) };
        verdicts.set(id, fresh);
        fresh.result.catch(() => { if (verdicts.get(id) === fresh) verdicts.delete(id); }); // a failed walk is not cached
        v = fresh;
      }
      return v.result;
    });

    // Every agent's avatar is its pixel portrait (lib/pfp.ts): a skin, a hat, glasses and a shirt picked from its id, so it
    // never changes and a new agent gets its own. An emoji an agent picked is kept but not shown.
    const avatar = async (req: { params: { file: string } }, reply: FastifyReply) => {
      const id = req.params.file.replace(/\.svg$/, '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw errors.notFound('Image');
      const svg = pfpSvg(id);
      return reply.header('content-type', 'image/svg+xml').header('cache-control', 'no-cache').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").send(svg);
    };
    for (const p of ['/agents/avatars/:file', '/world/avatars/:file']) r.get<{ Params: { file: string } }>(p, avatar);
    // A coin's token metadata (owner, 2026-10-15): its name, its ticker and its picture, nothing else. No website, no X
    // account, no links of any kind, wherever the coin is seen.
    const publicUrl = app.deps.config.publicUrl.replace(/\/+$/, '');
    const coinMeta = async (req: { params: { creatorId: string; file: string } }) => {
      const symbol = req.params.file.replace(/\.json$/, '').toUpperCase();
      const [c] = await db.select().from(worldCoins).where(and(eq(worldCoins.creatorId, req.params.creatorId), eq(worldCoins.symbol, symbol))).orderBy(desc(worldCoins.launchedAt)).limit(1);
      return c ? { name: c.name, symbol: c.symbol, description: '', image: `${publicUrl}/api/agents/coin-image/${c.mint}.svg` } : { name: symbol, symbol, description: '', image: null };
    };
    // The coin's picture, the same mark the site draws for it (shared coinMarkSvg).
    r.get<{ Params: { file: string } }>('/agents/coin-image/:file', async (req, reply) => {
      const mint = req.params.file.replace(/\.svg$/, '');
      if (!/^[A-Za-z0-9]{32,44}$/.test(mint)) throw errors.notFound('Image');
      return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=31536000, immutable').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").send(coinMarkSvg(mint));
    });
    // The /world path stays: coins launched earlier carry it on chain.
    for (const p of ['/agents/coin-meta/:creatorId/:file', '/world/coin-meta/:creatorId/:file']) r.get<{ Params: { creatorId: string; file: string } }>(p, coinMeta);
  }, { prefix: '/api' });
}

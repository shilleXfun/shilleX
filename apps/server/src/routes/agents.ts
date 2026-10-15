import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { coinMarkSvg, type AgentsInfo, type AgentsOverview, type Page, type PostView } from '@shillex/shared';
import { agentTurns, agents, conversationMembers, conversations, messages, posts, users, worldCoins } from '../db/schema.ts';
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
      return { network: w.network, agents: wild + raised, wild, raised, runtime: w.engine ? 'on' : 'off', budgetLevel: w.budget.level(), spentTodayUsd: w.budget.spentToday(), mainnet: app.deps.config.mainnet };
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
      return { coin, trades: await w.indexer.trades({ mint: coin.mint, limit: 100 }), holders: await w.indexer.holders(coin.mint) };
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

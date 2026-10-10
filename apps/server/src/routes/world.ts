import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { WORLD_AGENT_COUNT, type WorldInfo } from '@shillex/shared';
import { agentTurns, agents, channels, communities, communityMembers, conversationMembers, conversations, messages, posts, users, worldCoins } from '../db/schema.ts';
import { channelViews, communitySummaries } from '../services/communities.ts';
import { hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { toUserSummary } from '../services/users.ts';
import { errors } from '../lib/errors.ts';
import { avatarSvg } from '../lib/svg-art.ts';
import { chainHead, toTurnView, verifyChain } from '../world/provenance.ts';
import type { WorldHandles } from '../world/boot.ts';

const PAGE = 30;

/** Public, read-only views of the whole agent world: nothing here is filtered by membership, DMs included. */
export async function registerWorldRoutes(app: FastifyInstance, w: WorldHandles) {
  await app.register(async (r) => {
    const { db, presence } = app.deps;
    const byUsername = async (username: string) => {
      const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = ${username.toLowerCase()}`, eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      return u;
    };
    const messagesIn = async (scope: 'channel' | 'conversation', id: string, before?: string) => {
      const col = scope === 'channel' ? messages.channelId : messages.conversationId;
      const rows = await db.select().from(messages).where(and(eq(col, id), ne(messages.status, 'deleted'), before ? lt(messages.id, before) : undefined)).orderBy(desc(messages.id)).limit(60);
      return { messages: await hydrateMessages(db, '', rows.reverse()) };
    };

    r.get('/world/info', async (): Promise<WorldInfo> => ({ worldMode: true, network: w.network, agents: WORLD_AGENT_COUNT, runtime: w.runtime ? 'on' : 'off', budgetLevel: w.budget.level(), spentTodayUsd: w.budget.spentToday() }));

    // With an author, replies are included so an agent's page shows everything it wrote.
    r.get<{ Querystring: { before?: string; author?: string } }>('/world/feed', async (req) => {
      const author = req.query.author ? await byUsername(req.query.author) : null;
      const rows = await db.select().from(posts).where(and(isNull(posts.deletedAt), isNull(posts.communityId),
        author ? eq(posts.authorId, author.id) : inArray(posts.kind, ['post', 'quote', 'repost']),
        req.query.before ? lt(posts.id, req.query.before) : undefined)).orderBy(desc(posts.id)).limit(PAGE);
      return { posts: await hydratePosts(db, '', rows) };
    });
    r.get<{ Params: { id: string } }>('/world/posts/:id', async (req) => {
      const [root] = await db.select().from(posts).where(eq(posts.id, req.params.id));
      if (!root) throw errors.notFound('Post');
      const chain: typeof root[] = [];
      let cur = root;
      while (cur.parentId && chain.length < 20) { const [p] = await db.select().from(posts).where(eq(posts.id, cur.parentId)); if (!p) break; chain.unshift(p); cur = p; }
      const replies = await db.select().from(posts).where(and(eq(posts.parentId, root.id), eq(posts.kind, 'reply'))).orderBy(asc(posts.id)).limit(200);
      const [post, ...rest] = await hydratePosts(db, '', [root, ...chain, ...replies]);
      return { post, ancestors: rest.slice(0, chain.length), replies: rest.slice(chain.length) };
    });

    r.get('/world/communities', async () => {
      const rows = await db.select().from(communities).orderBy(asc(communities.createdAt));
      const sums = await communitySummaries({ db, presence }, '', rows);
      const chans = rows.length ? await db.select().from(channels).where(inArray(channels.communityId, rows.map((c) => c.id))) : [];
      const owners = await userSummaries(db, rows.map((c) => c.ownerId));
      return { communities: await Promise.all(sums.map(async (s) => {
        const row = rows.find((c) => c.id === s.id)!;
        return { ...s, owner: owners.get(row.ownerId) ?? null, channels: await channelViews(db, '', chans.filter((c) => c.communityId === s.id), null) };
      })) };
    });
    r.get<{ Params: { slug: string } }>('/world/communities/:slug', async (req) => {
      const [c] = await db.select().from(communities).where(eq(communities.slug, req.params.slug));
      if (!c) throw errors.notFound('Community');
      const [summary] = await communitySummaries({ db, presence }, '', [c]);
      const chans = await db.select().from(channels).where(eq(channels.communityId, c.id));
      const mem = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active')));
      const people = await userSummaries(db, [c.ownerId, ...mem.map((m) => m.userId)]);
      return { community: summary, owner: people.get(c.ownerId) ?? null, channels: await channelViews(db, '', chans, null), members: mem.map((m) => ({ user: people.get(m.userId)!, role: m.role })) };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/world/channels/:id/messages', async (req) => messagesIn('channel', req.params.id, req.query.before));

    r.get('/world/conversations', async () => {
      const rows = await db.select().from(conversations);
      const mem = rows.length ? await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, rows.map((c) => c.id))) : [];
      const people = await userSummaries(db, mem.map((m) => m.userId));
      const views = await Promise.all(rows.map(async (c) => {
        const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
        return {
          id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: false, unread: 0,
          members: mem.filter((m) => m.conversationId === c.id).map((m) => people.get(m.userId)!).filter(Boolean),
          lastMessage: last ? (await hydrateMessages(db, '', [last]))[0]! : null,
        };
      }));
      views.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
      return { conversations: views };
    });
    r.get<{ Params: { id: string }; Querystring: { before?: string } }>('/world/conversations/:id/messages', async (req) => messagesIn('conversation', req.params.id, req.query.before));

    r.get('/world/coins', async () => ({ coins: await w.indexer.coins() }));
    r.get<{ Params: { mint: string } }>('/world/coins/:mint', async (req) => {
      const coin = await w.indexer.coin(req.params.mint);
      if (!coin) throw errors.notFound('Coin');
      return { coin, trades: await w.indexer.trades({ mint: coin.mint, limit: 100 }), holders: await w.indexer.holders(coin.mint) };
    });
    r.get<{ Querystring: { limit?: string } }>('/world/trades', async (req) => ({ trades: await w.indexer.trades({ limit: Number(req.query.limit ?? 50) || 50 }) }));
    r.get('/world/leaderboard', async () => ({ agents: await w.indexer.leaderboard() }));
    r.get<{ Params: { username: string } }>('/world/agents/:username', async (req) => ({ agent: await w.indexer.agent((await byUsername(req.params.username)).id) }));
    r.get<{ Params: { username: string }; Querystring: { before?: string } }>('/world/agents/:username/turns', async (req) => {
      const u = await byUsername(req.params.username);
      const rows = await db.select().from(agentTurns).where(and(eq(agentTurns.agentId, u.id), req.query.before ? lt(agentTurns.id, req.query.before) : undefined)).orderBy(desc(agentTurns.id)).limit(20);
      return { turns: rows.map((t) => toTurnView(t, toUserSummary(u))) };
    });
    r.get<{ Params: { id: string } }>('/world/turns/:id', async (req) => {
      const [t] = await db.select({ t: agentTurns, u: users }).from(agentTurns).innerJoin(users, eq(users.id, agentTurns.agentId)).where(eq(agentTurns.id, req.params.id));
      if (!t) throw errors.notFound('Turn');
      return { turn: toTurnView(t.t, toUserSummary(t.u)) };
    });
    r.get<{ Params: { username: string } }>('/world/agents/:username/chain', async (req) => chainHead(db, (await byUsername(req.params.username)).id));
    r.get<{ Params: { username: string } }>('/world/agents/:username/chain/verify', async (req) => verifyChain(db, (await byUsername(req.params.username)).id));

    r.get<{ Params: { file: string } }>('/world/avatars/:file', async (req, reply) => {
      const id = req.params.file.replace(/\.svg$/, '');
      const [a] = await db.select().from(agents).where(eq(agents.userId, id));
      const color = a?.avatarColor && /^#[0-9a-fA-F]{6}$/.test(a.avatarColor) ? a.avatarColor : null;
      const emoji = a?.avatarEmoji?.replace(/[<>&"']/g, '') || null;
      const svg = emoji && color
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="43" font-size="32" text-anchor="middle">${emoji}</text></svg>`
        : avatarSvg(id);
      return reply.header('content-type', 'image/svg+xml').header('cache-control', 'no-cache').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").send(svg);
    });
    r.get<{ Params: { creatorId: string; file: string } }>('/world/coin-meta/:creatorId/:file', async (req) => {
      const symbol = req.params.file.replace(/\.json$/, '').toUpperCase();
      const [c] = await db.select().from(worldCoins).where(and(eq(worldCoins.creatorId, req.params.creatorId), eq(worldCoins.symbol, symbol))).orderBy(desc(worldCoins.launchedAt)).limit(1);
      return c ? { name: c.name, symbol: c.symbol, description: c.description, image: null } : { name: symbol, symbol, description: '', image: null };
    });
  }, { prefix: '/api' });
}

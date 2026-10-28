import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { agentName, type AgentSearchHit, type ChatSearchPage, type MessageSearchHit, type Page, type PostView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, messages, conversationMembers, conversations, posts, users, type MessageRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { escapeLike } from '../lib/like.ts';
import { clampLimit } from '../lib/pagination.ts';
import { agentOnlyConversationIds } from '../services/backchannel.ts';
import { collectMints, hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';

/** Messages with the chat each sits in, named by its title or else its other members. */
async function messageHits(db: Db, viewerId: string, rows: MessageRow[]): Promise<MessageSearchHit[]> {
  if (!rows.length) return [];
  const views = await hydrateMessages(db, viewerId, rows);
  const convs = await db.select().from(conversations).where(inArray(conversations.id, [...new Set(rows.map((r) => r.conversationId!))]));
  const memberRows = await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, convs.map((c) => c.id)));
  const names = await userSummaries(db, memberRows.map((m) => m.userId));
  const label = (id: string) => {
    const c = convs.find((x) => x.id === id)!;
    if (c.name) return c.name;
    return memberRows.filter((m) => m.conversationId === id && m.userId !== viewerId).flatMap((m) => { const u = names.get(m.userId); return u ? [agentName(u)] : []; }).join(', ');
  };
  return views.map((m) => ({ message: m, conversation: { id: m.scope.id, name: label(m.scope.id) } }));
}

/** The words of a search, X-style: every word must match somewhere. At most five, each without a leading @ for names. */
const wordsOf = (q: string | undefined) => (q ?? '').trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5);

export default async function searchRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  const limits = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.get<{ Querystring: { q?: string; conversationId?: string } }>('/search/messages', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { hits: [] };
    const mine = (await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, me.id))).map((r) => r.id);
    const scope = req.query.conversationId ? mine.filter((id) => id === req.query.conversationId) : mine;
    if (!scope.length) return { hits: [] };
    const rows = await db.select().from(messages).where(and(inArray(messages.conversationId, scope), eq(messages.status, 'visible'), ilike(messages.body, `%${escapeLike(q)}%`)))
      .orderBy(desc(messages.id)).limit(50);
    return { hits: await messageHits(db, me.id, rows) };
  });

  // The site's search bar (owner, 2026-10-28: "like twitter search", on every page). Public: a visitor searches too.

  // Agents by handle, name or bio: an exact handle first, then names that start with the words, then any match.
  app.get<{ Querystring: { q?: string; limit?: string } }>('/search/agents', limits, async (req): Promise<{ agents: AgentSearchHit[] }> => {
    const words = wordsOf(req.query.q).map((w) => w.replace(/^@/, '')).filter(Boolean);
    if (!words.length) return { agents: [] };
    const whole = escapeLike(words.join(' '));
    const hidden = await hiddenAuthorIds(db, req.user?.id ?? '', app.deps.config.hideDemo);
    const rows = await db.select({ id: users.id, bio: users.bio }).from(users).innerJoin(agents, eq(agents.userId, users.id))
      .where(and(eq(users.kind, 'agent'), ne(agents.status, 'retired'), hidden.length ? notInArray(users.id, hidden) : undefined,
        ...words.map((w) => { const p = `%${escapeLike(w)}%`; return or(ilike(users.username, p), ilike(users.displayName, p), ilike(users.bio, p)); })))
      .orderBy(sql`case when lower(${users.username}) = lower(${whole}) then 0
        when ${users.username} ilike ${`${whole}%`} or ${users.displayName} ilike ${`${whole}%`} then 1
        when ${users.username} ilike ${`%${whole}%`} or ${users.displayName} ilike ${`%${whole}%`} then 2 else 3 end`, users.displayName)
      .limit(clampLimit(req.query.limit, 20, 50));
    const summaries = await userSummaries(db, rows.map((r) => r.id));
    return { agents: rows.flatMap((r) => { const user = summaries.get(r.id); return user ? [{ user, bio: r.bio }] : []; }) };
  });

  // Public posts, replies and quotes whose text holds every word, newest first; a page shaped like the public feed's.
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/search/posts', limits, async (req): Promise<Page<PostView>> => {
    const words = wordsOf(req.query.q);
    if (!words.join('').length || words.join(' ').length < 2) return { items: [], nextCursor: null };
    const limit = clampLimit(req.query.limit, 20, 50);
    const viewerId = req.user?.id ?? '';
    const hidden = await hiddenAuthorIds(db, viewerId, app.deps.config.hideDemo);
    const rows = await db.select().from(posts).where(and(
      inArray(posts.kind, ['post', 'reply', 'quote']), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
      hidden.length ? notInArray(posts.authorId, hidden) : undefined, req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
      ...words.map((w) => ilike(posts.body, `%${escapeLike(w)}%`)),
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const items = await hydratePosts(db, viewerId, rows.slice(0, limit));
    return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null, tokens: await app.deps.tokens.getViews(collectMints(items)) };
  });

  // Messages in the agents' own chats (every one of them is public to read), newest first.
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/search/chats', limits, async (req): Promise<ChatSearchPage> => {
    const words = wordsOf(req.query.q);
    if (words.join(' ').length < 2) return { hits: [], nextCursor: null };
    const limit = clampLimit(req.query.limit, 20, 50);
    const ids = await agentOnlyConversationIds(db);
    if (!ids.length) return { hits: [], nextCursor: null };
    const rows = await db.select().from(messages).where(and(inArray(messages.conversationId, ids), eq(messages.status, 'visible'),
      req.query.cursor ? lt(messages.id, req.query.cursor) : undefined, ...words.map((w) => ilike(messages.body, `%${escapeLike(w)}%`))))
      .orderBy(desc(messages.id)).limit(limit + 1);
    return { hits: await messageHits(db, '', rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  });
}

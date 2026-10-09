import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { buildTokenLinks, isValidSolanaAddress, type Page, type PostView, type PublicChatMention, type TokenDiscussionStats } from '@shillex/shared';
import { tokenMentions, posts, messages, channels, communities, subscriptions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { hydrateMessages, hydratePosts, collectMints } from '../services/hydrate.ts';
import { canReadPost, hiddenAuthorIds } from '../services/visibility.ts';

const DAY = 24 * 60 * 60 * 1000;

export default async function tokensRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;
  const mintParam = (m: string) => { if (!isValidSolanaAddress(m)) throw errors.badRequest('INVALID_ADDRESS', 'Not a valid Solana address'); return m; };

  async function stats(mint: string, userId: string): Promise<TokenDiscussionStats> {
    const since = new Date(now().getTime() - DAY);
    const rows = await db.select({ t: tokenMentions.sourceType, n: sql<number>`count(*)::int` }).from(tokenMentions)
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), gt(tokenMentions.createdAt, since))).groupBy(tokenMentions.sourceType);
    const posts24h = rows.find((r) => r.t === 'post')?.n ?? 0;
    const chat24h = rows.find((r) => r.t === 'message')?.n ?? 0;
    const sub = await db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint))).limit(1);
    return { mentions24h: posts24h + chat24h, posts24h, chat24h, subscribed: sub.length > 0 };
  }

  app.get<{ Params: { mint: string } }>('/tokens/:mint', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } }, async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const token = await deps.tokens.resolve(mint);
    const links = token.status === 'resolved' || token.status === 'unindexed' ? buildTokenLinks({ mint, pairAddress: token.pairAddress, source: token.source }) : [];
    return { token, links, stats: await stats(mint, me.id) };
  });

  app.post('/tokens/resolve', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } }, async (req) => {
    requireUser(req);
    const { mints } = parse(z.object({ mints: z.array(z.string().refine(isValidSolanaAddress)).max(25) }), req.body);
    return { tokens: await deps.tokens.getViews(mints) };
  });

  app.get<{ Params: { mint: string }; Querystring: { cursor?: string; limit?: string } }>('/tokens/:mint/posts', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select({ p: posts }).from(tokenMentions).innerJoin(posts, eq(posts.id, tokenMentions.sourceId))
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), eq(tokenMentions.sourceType, 'post'), sql`${posts.deletedAt} is null`,
        req.query.cursor ? lt(posts.id, req.query.cursor) : undefined))
      .orderBy(desc(posts.id)).limit(limit + 1);
    const visible = [];
    for (const r of rows.slice(0, limit)) if (!hidden.includes(r.p.authorId) && (await canReadPost(db, r.p, me.id))) visible.push(r.p);
    const items = await hydratePosts(db, me.id, visible);
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.p.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  app.get<{ Params: { mint: string }; Querystring: { cursor?: string; limit?: string } }>('/tokens/:mint/chat', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select({ m: messages, ch: channels, c: communities }).from(tokenMentions)
      .innerJoin(messages, eq(messages.id, tokenMentions.sourceId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(communities, eq(communities.id, channels.communityId))
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), eq(tokenMentions.sourceType, 'message'),
        eq(messages.status, 'visible'), eq(communities.visibility, 'public'), req.query.cursor ? lt(messages.id, req.query.cursor) : undefined))
      .orderBy(desc(messages.id)).limit(limit + 1);
    const kept = rows.slice(0, limit).filter((r) => !hidden.includes(r.m.authorId));
    const views = await hydrateMessages(db, me.id, kept.map((r) => r.m));
    const items: PublicChatMention[] = kept.map((r, i) => ({
      message: views[i]!, community: { id: r.c.id, slug: r.c.slug, name: r.c.name, visibility: r.c.visibility }, channel: { id: r.ch.id, name: r.ch.name },
    }));
    const page: Page<PublicChatMention> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.m.id : null, tokens: await deps.tokens.getViews(views.flatMap((v) => v.mints)) };
    return page;
  });

  app.put<{ Params: { mint: string } }>('/tokens/:mint/subscription', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    await db.insert(subscriptions).values({ userId: me.id, targetType: 'token', targetId: mint, createdAt: now() }).onConflictDoNothing();
    return { subscribed: true };
  });
  app.delete<{ Params: { mint: string } }>('/tokens/:mint/subscription', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    await db.delete(subscriptions).where(and(eq(subscriptions.userId, me.id), eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint)));
    return { subscribed: false };
  });
}

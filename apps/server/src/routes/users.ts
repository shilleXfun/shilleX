import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Page, PostView, UserProfile, UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { users, follows, mutes, blocks, posts, walletLinks, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { hiddenAuthorIds, isBlockedEitherWay } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';
import { notify } from '../services/notify.ts';

export async function loadUserByUsername(db: Db, username: string): Promise<UserRow> {
  const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1);
  if (!u) throw errors.notFound('User');
  return u;
}

const count = async (db: Db, col: typeof follows.followerId | typeof follows.followeeId, id: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(col, id)))[0]?.n ?? 0;

export default async function usersRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.get<{ Querystring: { q?: string } }>('/users', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim().replace(/[%_]/g, '');
    if (!q) return { users: [] };
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select().from(users).where(and(
      or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`)), ne(users.id, me.id),
      hidden.length ? notInArray(users.id, hidden) : undefined,
    )).orderBy(users.username).limit(10);
    return { users: rows.map(toUserSummary) };
  });

  app.get<{ Params: { username: string } }>('/users/:username', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    const [followers, following, iFollow, theyFollow, muted, blocked, wallet] = await Promise.all([
      count(db, follows.followeeId, u.id), count(db, follows.followerId, u.id),
      db.select().from(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id))).limit(1),
      db.select().from(follows).where(and(eq(follows.followerId, u.id), eq(follows.followeeId, me.id))).limit(1),
      db.select().from(mutes).where(and(eq(mutes.userId, me.id), eq(mutes.targetId, u.id))).limit(1),
      db.select().from(blocks).where(and(eq(blocks.userId, me.id), eq(blocks.targetId, u.id))).limit(1),
      db.select().from(walletLinks).where(eq(walletLinks.userId, u.id)).limit(1),
    ]);
    const w = wallet[0];
    const profile: UserProfile = {
      ...toUserSummary(u), bannerUrl: u.bannerUrl ?? `/media/banner/${u.id}.svg`, bio: u.bio, links: u.links,
      createdAt: u.createdAt.toISOString(), followers, following, isSelf: u.id === me.id,
      isFollowing: iFollow.length > 0, followsYou: theyFollow.length > 0, isMuted: muted.length > 0, isBlocked: blocked.length > 0,
      wallet: w && w.displayWallet ? { address: w.address, showHoldings: w.displayHoldings, verified: false } : null,
    };
    return { profile };
  });

  app.get<{ Params: { username: string }; Querystring: { tab?: string; cursor?: string; limit?: string } }>('/users/:username/posts', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    if (u.id !== me.id && (await isBlockedEitherWay(db, me.id, u.id))) throw errors.forbidden('BLOCKED', 'You can’t view this account’s posts');
    const tab = req.query.tab === 'replies' ? 'replies' : 'posts';
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select().from(posts).where(and(
      eq(posts.authorId, u.id), isNull(posts.communityId), isNull(posts.deletedAt),
      tab === 'replies' ? eq(posts.kind, 'reply') : inArray(posts.kind, ['post', 'quote', 'repost']),
      req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const items = await hydratePosts(db, me.id, rows.slice(0, limit));
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  for (const dir of ['followers', 'following'] as const) {
    app.get<{ Params: { username: string }; Querystring: { cursor?: string } }>(`/users/:username/${dir}`, async (req) => {
      requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      const [mine, other] = dir === 'followers' ? [follows.followeeId, follows.followerId] : [follows.followerId, follows.followeeId];
      const rows = await db.select({ u: users }).from(follows).innerJoin(users, eq(users.id, other))
        .where(and(eq(mine, u.id), req.query.cursor ? lt(users.id, req.query.cursor) : undefined)).orderBy(desc(users.id)).limit(51);
      const page: Page<UserSummary> = { items: rows.slice(0, 50).map((r) => toUserSummary(r.u)), nextCursor: rows.length > 50 ? rows[49]!.u.id : null };
      return page;
    });
  }

  app.put<{ Params: { username: string } }>('/users/:username/follow', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    if (u.id === me.id) throw errors.badRequest('SELF_FOLLOW', 'You can’t follow yourself');
    if (await isBlockedEitherWay(db, me.id, u.id)) throw errors.forbidden('BLOCKED', 'You can’t follow this account');
    const ins = await db.insert(follows).values({ followerId: me.id, followeeId: u.id, createdAt: now() }).onConflictDoNothing().returning();
    if (ins.length) await notify(deps, { userId: u.id, type: 'follow', actorId: me.id, targetType: 'user', targetId: me.id, data: { username: me.username } });
    return { following: true, followers: await count(db, follows.followeeId, u.id) };
  });
  app.delete<{ Params: { username: string } }>('/users/:username/follow', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    await db.delete(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id)));
    return { following: false, followers: await count(db, follows.followeeId, u.id) };
  });

  for (const [path, table] of [['mute', mutes], ['block', blocks]] as const) {
    app.put<{ Params: { username: string } }>(`/users/:username/${path}`, async (req, reply) => {
      const me = requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      if (u.id === me.id) throw errors.badRequest('SELF', `You can’t ${path} yourself`);
      await db.insert(table).values({ userId: me.id, targetId: u.id, createdAt: now() }).onConflictDoNothing();
      if (path === 'block') {
        await db.delete(follows).where(or(
          and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id)),
          and(eq(follows.followerId, u.id), eq(follows.followeeId, me.id)),
        ));
      }
      return reply.status(204).send();
    });
    app.delete<{ Params: { username: string } }>(`/users/:username/${path}`, async (req, reply) => {
      const me = requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      await db.delete(table).where(and(eq(table.userId, me.id), eq(table.targetId, u.id)));
      return reply.status(204).send();
    });
  }
}

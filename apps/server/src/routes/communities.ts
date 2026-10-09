import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { InviteView, MemberView, Page, PostView } from '@shillex/shared';
import { communities, communityMembers, channels, invites, posts, users, type CommunityRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { clampLimit } from '../lib/pagination.ts';
import { escapeLike } from '../lib/like.ts';
import { getCommunityAccessBySlug, requireCommunityRead, requireMod, type CommunityAccess } from '../services/visibility.ts';
import { channelViews, communityDetail, communitySummaries, evictFromCommunity } from '../services/communities.ts';
import { setCommunityMentionVisibility } from '../services/mentions.ts';
import { notify } from '../services/notify.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { toUserSummary } from '../services/users.ts';
import { loadUserByUsername } from './users.ts';

const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, '3–32 lowercase letters, numbers or dashes');
const Visibility = z.enum(['public', 'private', 'invite']);
const Create = z.object({ name: z.string().trim().min(3).max(40), slug: Slug, description: z.string().max(280).default(''), visibility: Visibility, rules: z.string().max(2000).default('') });
const Update = z.object({ name: z.string().trim().min(3).max(40).optional(), description: z.string().max(280).optional(), rules: z.string().max(2000).optional(), visibility: Visibility.optional() });
const InviteBody = z.object({ maxUses: z.number().int().min(1).max(1000).optional(), expiresInHours: z.number().int().min(1).max(720).optional() });

export default async function communitiesRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, config } = deps;

  async function access(slug: string, userId: string): Promise<CommunityAccess> {
    const a = await getCommunityAccessBySlug(db, slug, userId);
    if (!a || (a.community.visibility === 'invite' && !a.isActive)) throw errors.notFound('Community');
    return a;
  }
  const memberViews = async (communityId: string, status: 'active' | 'pending'): Promise<MemberView[]> => {
    const rows = await db.select({ m: communityMembers, u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.status, status)));
    const rank = { owner: 0, mod: 1, member: 2 } as const;
    return rows.map(({ m, u }) => ({ user: toUserSummary(u), role: m.role, status: m.status, online: deps.presence.isOnline(u.id), joinedAt: m.joinedAt.toISOString() }))
      .sort((a, b) => rank[a.role] - rank[b.role] || Number(b.online) - Number(a.online) || a.user.username.localeCompare(b.user.username));
  };

  async function requireUserExists(id: string) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw errors.notFound('User');
  }

  app.get<{ Querystring: { filter?: string; q?: string } }>('/communities', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim();
    let rows: CommunityRow[];
    if (req.query.filter === 'joined') {
      rows = (await db.select({ c: communities }).from(communityMembers).innerJoin(communities, eq(communities.id, communityMembers.communityId))
        .where(and(eq(communityMembers.userId, me.id), eq(communityMembers.status, 'active')))).map((r) => r.c);
      rows.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const pattern = `%${escapeLike(q)}%`;
      rows = await db.select().from(communities).where(and(
        ne(communities.visibility, 'invite'),
        q ? or(ilike(communities.name, pattern), ilike(communities.description, pattern)) : undefined,
      )).limit(100);
    }
    const list = await communitySummaries(deps, me.id, rows);
    if (req.query.filter !== 'joined') list.sort((a, b) => b.onlineCount - a.onlineCount || b.memberCount - a.memberCount);
    return { communities: list };
  });

  app.post('/communities', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Create, req.body);
    const taken = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, body.slug)).limit(1);
    if (taken.length) throw errors.conflict('SLUG_TAKEN', 'That community URL is taken');
    const id = newId();
    const createdAt = now();
    await db.insert(communities).values({ id, ...body, ownerId: me.id, createdAt });
    await db.insert(communityMembers).values({ communityId: id, userId: me.id, role: 'owner', status: 'active', joinedAt: createdAt });
    await db.insert(channels).values({ id: newId(), communityId: id, name: 'general', topic: 'Say gm', position: 0 });
    return reply.status(201).send({ community: await communityDetail(deps, me.id, await access(body.slug, me.id)) });
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug', async (req) => {
    const me = requireUser(req);
    return { community: await communityDetail(deps, me.id, await access(req.params.slug, me.id)) };
  });

  app.patch<{ Params: { slug: string } }>('/communities/:slug', async (req) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(Update, req.body);
    if (!Object.keys(body).length) throw errors.badRequest('VALIDATION', 'Nothing to update');
    if (body.visibility && !a.isOwner) throw errors.forbidden('OWNER_ONLY', 'Only the owner can change visibility');
    await db.update(communities).set(body).where(eq(communities.id, a.community.id));
    if (body.visibility && (body.visibility === 'public') !== (a.community.visibility === 'public')) {
      await setCommunityMentionVisibility(db, a.community.id, body.visibility === 'public');
    }
    return { community: await communityDetail(deps, me.id, await access(req.params.slug, me.id)) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/join', async (req) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (a.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    if (a.member) return { status: a.member.status };
    const status = a.community.visibility === 'public' ? 'active' as const : 'pending' as const;
    const inserted = await db.insert(communityMembers).values({ communityId: a.community.id, userId: me.id, role: 'member', status, joinedAt: now() })
      .onConflictDoNothing().returning({ u: communityMembers.userId });
    if (!inserted.length) {
      const [cur] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, me.id)));
      if (cur?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
      return { status: cur?.status ?? status };
    }
    if (status === 'pending') {
      const mods = await db.select({ u: communityMembers.userId }).from(communityMembers).where(and(
        eq(communityMembers.communityId, a.community.id), eq(communityMembers.status, 'active'), inArray(communityMembers.role, ['owner', 'mod'])));
      for (const m of mods) await notify(deps, { userId: m.u, type: 'join_request', actorId: me.id, targetType: 'community', targetId: a.community.id, data: { slug: a.community.slug, communityName: a.community.name } });
    }
    deps.bus.toUser(me.id, 'community:update', { communityId: a.community.id });
    return { status };
  });

  app.delete<{ Params: { slug: string } }>('/communities/:slug/membership', async (req, reply) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (a.isOwner) throw errors.badRequest('OWNER_CANNOT_LEAVE', 'Owners can’t leave their own community');
    if (a.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    await db.delete(communityMembers).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, me.id)));
    await evictFromCommunity(deps, me.id, a.community.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/invites', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(InviteBody, req.body ?? {});
    const code = randomBytes(9).toString('base64url');
    const expiresAt = body.expiresInHours ? new Date(now().getTime() + body.expiresInHours * 3600_000) : null;
    await db.insert(invites).values({ code, communityId: a.community.id, createdBy: me.id, expiresAt, maxUses: body.maxUses ?? null, createdAt: now() });
    const invite: InviteView = { code, url: `${config.publicUrl}/invite/${code}`, expiresAt: expiresAt?.toISOString() ?? null, maxUses: body.maxUses ?? null, uses: 0 };
    return reply.status(201).send({ invite });
  });

  async function loadInvite(code: string) {
    const [inv] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!inv) throw errors.notFound('Invite');
    const valid = (!inv.expiresAt || inv.expiresAt > now()) && (inv.maxUses === null || inv.uses < inv.maxUses);
    const [c] = await db.select().from(communities).where(eq(communities.id, inv.communityId));
    return { inv, valid, community: c! };
  }
  app.get<{ Params: { code: string } }>('/invites/:code', async (req) => {
    const me = requireUser(req);
    const { valid, community } = await loadInvite(req.params.code);
    return { community: (await communitySummaries(deps, me.id, [community]))[0], valid };
  });
  app.post<{ Params: { code: string } }>('/invites/:code/accept', async (req) => {
    const me = requireUser(req);
    const { inv, community } = await loadInvite(req.params.code);
    const [existing] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, me.id)));
    if (existing?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    if (existing?.status !== 'active') {
      await db.transaction(async (tx) => {
        const t = now();
        const claimed = await tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(and(
          eq(invites.code, inv.code),
          or(isNull(invites.maxUses), sql`${invites.uses} < ${invites.maxUses}`),
          or(isNull(invites.expiresAt), gt(invites.expiresAt, t)),
        )).returning({ code: invites.code });
        if (!claimed.length) throw new AppError(410, 'INVITE_EXPIRED', 'This invite has expired or been used up');
        const joined = await tx.insert(communityMembers).values({ communityId: community.id, userId: me.id, role: 'member', status: 'active', joinedAt: t })
          .onConflictDoUpdate({ target: [communityMembers.communityId, communityMembers.userId], set: { status: 'active', joinedAt: t }, setWhere: ne(communityMembers.status, 'banned') })
          .returning({ u: communityMembers.userId });
        if (!joined.length) throw errors.forbidden('BANNED', 'You are banned from this community');
      });
    }
    return { community: (await communitySummaries(deps, me.id, [community]))[0] };
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug/members', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await access(req.params.slug, me.id));
    return { members: await memberViews(a.community.id, 'active') };
  });
  app.get<{ Params: { slug: string } }>('/communities/:slug/requests', async (req) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    return { members: await memberViews(a.community.id, 'pending') };
  });
  app.post<{ Params: { slug: string; userId: string; action: string } }>('/communities/:slug/requests/:userId/:action', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const where = and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId), eq(communityMembers.status, 'pending'));
    if (req.params.action === 'approve') await db.update(communityMembers).set({ status: 'active', joinedAt: now() }).where(where);
    else if (req.params.action === 'reject') await db.delete(communityMembers).where(where);
    else throw errors.notFound('Action');
    deps.bus.toUser(req.params.userId, 'community:update', { communityId: a.community.id });
    return reply.status(204).send();
  });

  app.post<{ Params: { slug: string; userId: string; action: string } }>('/communities/:slug/members/:userId/:action', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    await requireUserExists(req.params.userId);
    const [target] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId)));
    if (target?.role === 'owner' || (target?.role === 'mod' && !a.isOwner) || req.params.userId === me.id) {
      throw errors.forbidden('CANNOT_MODERATE', 'You can’t moderate this member');
    }
    const key = and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId));
    switch (req.params.action) {
      case 'remove': if (target) await db.delete(communityMembers).where(key); break;
      case 'ban':
        await db.insert(communityMembers).values({ communityId: a.community.id, userId: req.params.userId, role: 'member', status: 'banned', joinedAt: now() })
          .onConflictDoUpdate({ target: [communityMembers.communityId, communityMembers.userId], set: { status: 'banned', role: 'member' } });
        break;
      case 'unban': if (target?.status === 'banned') await db.delete(communityMembers).where(key); break;
      default: throw errors.notFound('Action');
    }
    if (req.params.action !== 'unban') await evictFromCommunity(deps, req.params.userId, a.community.id);
    deps.bus.toUser(req.params.userId, 'community:update', { communityId: a.community.id });
    return reply.status(204).send();
  });

  app.put<{ Params: { slug: string; userId: string } }>('/communities/:slug/members/:userId/role', async (req, reply) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (!a.isOwner) throw errors.forbidden('OWNER_ONLY', 'Only the owner can change roles');
    const { role } = parse(z.object({ role: z.enum(['mod', 'member']) }), req.body);
    if (req.params.userId === me.id) throw errors.badRequest('SELF', 'You are the owner');
    await requireUserExists(req.params.userId);
    await db.update(communityMembers).set({ role }).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId), eq(communityMembers.status, 'active')));
    return reply.status(204).send();
  });

  app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>('/communities/:slug/threads', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await access(req.params.slug, me.id));
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select().from(posts).where(and(
      eq(posts.communityId, a.community.id), inArray(posts.kind, ['post', 'quote']), sql`${posts.deletedAt} is null`,
      req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const items = await hydratePosts(db, me.id, rows.slice(0, limit));
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  app.get<{ Params: { username: string } }>('/users/:username/communities', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    const rows = (await db.select({ c: communities }).from(communityMembers).innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(and(eq(communityMembers.userId, u.id), eq(communityMembers.status, 'active')))).map((r) => r.c)
      .filter((c) => u.id === me.id || c.visibility === 'public');
    return { communities: await communitySummaries(deps, me.id, rows) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/channels', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(z.object({ name: z.string().regex(/^[a-z0-9-]{1,24}$/), topic: z.string().max(120).default('') }), req.body);
    const count = await db.select({ id: channels.id }).from(channels).where(eq(channels.communityId, a.community.id));
    if (count.length >= 20) throw errors.badRequest('TOO_MANY_CHANNELS', 'Up to 20 channels per community');
    const [row] = await db.insert(channels).values({ id: newId(), communityId: a.community.id, name: body.name, topic: body.topic, position: count.length }).returning();
    deps.bus.toRoom(`community:${a.community.id}`, 'community:update', { communityId: a.community.id });
    return reply.status(201).send({ channel: (await channelViews(db, me.id, [row!], a.member))[0] });
  });
}

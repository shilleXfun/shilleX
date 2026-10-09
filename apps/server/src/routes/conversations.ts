import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { LIMITS, type ConversationView } from '@shillex/shared';
import { conversations, conversationMembers, messages, type ConversationRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { requireConversationMember, isBlockedEitherWay } from '../services/visibility.ts';
import { hydrateMessages, userSummaries } from '../services/hydrate.ts';
import { unreadInScope } from '../services/unread.ts';
import { memberIdsOf } from '../services/messages.ts';
import { notify } from '../services/notify.ts';
import { loadUserByUsername } from './users.ts';

const Create = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), username: z.string() }),
  z.object({ kind: z.literal('group'), name: z.string().trim().min(1).max(40), usernames: z.array(z.string()).min(1).max(50) }),
]);

export default async function conversationsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, bus } = deps;

  async function view(c: ConversationRow, viewerId: string): Promise<ConversationView> {
    const members = await db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, c.id));
    const me = members.find((m) => m.userId === viewerId)!;
    const summaries = await userSummaries(db, members.map((m) => m.userId));
    const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
    return {
      id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: me.muted,
      members: members.map((m) => summaries.get(m.userId)!).filter(Boolean),
      lastMessage: last ? (await hydrateMessages(db, viewerId, [last]))[0]! : null,
      unread: await unreadInScope(db, { userId: viewerId, scopeType: 'conversation', scopeId: c.id, since: me.joinedAt }),
    };
  }
  const notifyUpdate = async (id: string) => { for (const u of await memberIdsOf(db, id)) bus.toUser(u, 'conversation:update', { conversationId: id }); };

  app.get('/conversations', async (req) => {
    const me = requireUser(req);
    const rows = (await db.select({ c: conversations }).from(conversationMembers).innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversationMembers.userId, me.id))).map((r) => r.c);
    const views = await Promise.all(rows.map((c) => view(c, me.id)));
    views.sort((a, b) => (b.lastMessage?.id ?? b.createdAt).localeCompare(a.lastMessage?.id ?? a.createdAt));
    return { conversations: views };
  });

  app.post('/conversations', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Create, req.body);
    if (body.kind === 'dm') {
      const other = await loadUserByUsername(db, body.username);
      if (other.id === me.id) throw errors.badRequest('SELF', 'You can’t DM yourself');
      const dmKey = [me.id, other.id].sort().join(':');
      const [existing] = await db.select().from(conversations).where(eq(conversations.dmKey, dmKey));
      if (existing) return reply.status(200).send({ conversation: await view(existing, me.id) });
      if (await isBlockedEitherWay(db, me.id, other.id)) throw errors.forbidden('BLOCKED', 'You can’t message this account');
      const id = newId();
      const [c] = await db.insert(conversations).values({ id, kind: 'dm', dmKey, createdBy: me.id, createdAt: now() }).returning();
      await db.insert(conversationMembers).values([me.id, other.id].map((userId) => ({ conversationId: id, userId, joinedAt: now() })));
      await notify(deps, { userId: other.id, type: 'dm', actorId: me.id, targetType: 'user', targetId: me.id, data: { conversationId: id } });
      await notifyUpdate(id);
      return reply.status(201).send({ conversation: await view(c!, me.id) });
    }
    const others = [];
    for (const u of [...new Set(body.usernames.map((x) => x.toLowerCase()))]) {
      const row = await loadUserByUsername(db, u);
      if (row.id !== me.id && !(await isBlockedEitherWay(db, me.id, row.id))) others.push(row);
    }
    if (others.length + 1 > LIMITS.groupMax) throw errors.badRequest('GROUP_TOO_LARGE', `Groups can have up to ${LIMITS.groupMax} members`);
    if (!others.length) throw errors.badRequest('NO_MEMBERS', 'Add at least one person');
    const id = newId();
    const [c] = await db.insert(conversations).values({ id, kind: 'group', name: body.name, createdBy: me.id, createdAt: now() }).returning();
    await db.insert(conversationMembers).values([me, ...others].map((u) => ({ conversationId: id, userId: u.id, joinedAt: now() })));
    for (const o of others) await notify(deps, { userId: o.id, type: 'dm', actorId: me.id, targetType: 'user', targetId: me.id, data: { conversationId: id } });
    await notifyUpdate(id);
    return reply.status(201).send({ conversation: await view(c!, me.id) });
  });

  app.get<{ Params: { id: string } }>('/conversations/:id', async (req) => {
    const me = requireUser(req);
    return { conversation: await view(await requireConversationMember(db, req.params.id, me.id), me.id) };
  });

  app.patch<{ Params: { id: string } }>('/conversations/:id', async (req) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), muted: z.boolean().optional() }), req.body);
    if (body.name !== undefined) {
      if (c.kind !== 'group') throw errors.badRequest('DM_NO_NAME', 'Direct messages can’t be renamed');
      await db.update(conversations).set({ name: body.name }).where(eq(conversations.id, c.id));
      await notifyUpdate(c.id);
    }
    if (body.muted !== undefined) await db.update(conversationMembers).set({ muted: body.muted }).where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, me.id)));
    return { conversation: await view((await db.select().from(conversations).where(eq(conversations.id, c.id)))[0]!, me.id) };
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/members', async (req) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    if (c.kind !== 'group') throw errors.badRequest('NOT_GROUP', 'Only group chats can add members');
    const { usernames } = parse(z.object({ usernames: z.array(z.string()).min(1).max(20) }), req.body);
    const current = await memberIdsOf(db, c.id);
    const add = [];
    for (const u of usernames) {
      const row = await loadUserByUsername(db, u);
      if (!current.includes(row.id) && !(await isBlockedEitherWay(db, me.id, row.id))) add.push(row);
    }
    if (current.length + add.length > LIMITS.groupMax) throw errors.badRequest('GROUP_TOO_LARGE', `Groups can have up to ${LIMITS.groupMax} members`);
    if (add.length) await db.insert(conversationMembers).values(add.map((u) => ({ conversationId: c.id, userId: u.id, joinedAt: now() })));
    await notifyUpdate(c.id);
    return { conversation: await view(c, me.id) };
  });

  app.delete<{ Params: { id: string } }>('/conversations/:id/members/me', async (req, reply) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    if (c.kind !== 'group') throw errors.badRequest('NOT_GROUP', 'You can’t leave a direct message; block or mute instead');
    await db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, me.id)));
    bus.evict(me.id, `conversation:${c.id}`);
    await notifyUpdate(c.id);
    return reply.status(204).send();
  });
}

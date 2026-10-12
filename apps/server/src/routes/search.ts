import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { agentName, type MessageSearchHit } from '@shillex/shared';
import { messages, conversationMembers, conversations } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { escapeLike } from '../lib/like.ts';
import { hydrateMessages, userSummaries } from '../services/hydrate.ts';

export default async function searchRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  app.get<{ Querystring: { q?: string; conversationId?: string } }>('/search/messages', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { hits: [] };
    const mine = (await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, me.id))).map((r) => r.id);
    const scope = req.query.conversationId ? mine.filter((id) => id === req.query.conversationId) : mine;
    if (!scope.length) return { hits: [] };
    const rows = await db.select().from(messages).where(and(inArray(messages.conversationId, scope), eq(messages.status, 'visible'), ilike(messages.body, `%${escapeLike(q)}%`)))
      .orderBy(desc(messages.id)).limit(50);
    if (!rows.length) return { hits: [] };
    const views = await hydrateMessages(db, me.id, rows);
    const convs = await db.select().from(conversations).where(inArray(conversations.id, [...new Set(rows.map((r) => r.conversationId!))]));
    const memberRows = await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, convs.map((c) => c.id)));
    const names = await userSummaries(db, memberRows.map((m) => m.userId));
    const label = (id: string) => {
      const c = convs.find((x) => x.id === id)!;
      if (c.name) return c.name;
      return memberRows.filter((m) => m.conversationId === id && m.userId !== me.id).flatMap((m) => { const u = names.get(m.userId); return u ? [agentName(u)] : []; }).join(', ');
    };
    const hits: MessageSearchHit[] = views.map((m) => ({ message: m, conversation: { id: m.scope.id, name: label(m.scope.id) } }));
    return { hits };
  });
}

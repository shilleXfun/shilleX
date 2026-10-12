import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { isValidSolanaAddress, type ClientToServerEvents, type RoomScope, type ServerToClientEvents } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import { blocks, communityMembers, conversationMembers, type UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, hashToken, sessionValid, userForToken } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { getCommunityAccess, requireChannel, requireCommunityRead, requireConversationMember } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: UserRow; sessionId: string }>;

export class SocketBus implements EventBus {
  private io: IO | null = null;
  attach(io: IO) { this.io = io; }
  disconnectSession(sessionId: string) {
    if (!this.io) return;
    for (const s of this.io.of('/').sockets.values()) if (s.data.sessionId === sessionId) s.disconnect(true);
  }
  toRoom(room: string, event: string, payload: unknown) { this.io?.to(room).emit(event as any, payload as any); }
  toUser(userId: string, event: string, payload: unknown) { this.io?.to(`user:${userId}`).emit(event as any, payload as any); }
  evict(userId: string, room: string) { this.io?.in(`user:${userId}`).socketsLeave(room); }
  async evictAllExcept(room: string, keepUserIds: string[]) {
    if (!this.io) return;
    const keep = new Set(keepUserIds);
    const sockets = await this.io.in(room).fetchSockets();
    for (const s of sockets) if (!keep.has(s.data.user.id)) s.leave(room);
  }
}

export function attachRealtime(app: FastifyInstance, bus: SocketBus): IO {
  const { db, presence, now, config } = app.deps;
  const io: IO = new Server(app.server, { path: '/socket.io', cors: { origin: config.allowedOrigins, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const user = await userForToken(db, cookies[SESSION_COOKIE], now());
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = user;
      socket.data.sessionId = hashToken(cookies[SESSION_COOKIE]!);
      next();
    } catch { next(new Error('UNAUTHORIZED')); }
  });

  async function authorize(scope: RoomScope, id: string, userId: string) {
    switch (scope) {
      case 'channel': await requireChannel(db, id, userId, 'read'); return;
      case 'conversation': await requireConversationMember(db, id, userId); return;
      case 'community': requireCommunityRead(await getCommunityAccess(db, id, userId)); return;
      case 'token': if (!isValidSolanaAddress(id)) throw errors.badRequest('INVALID_ADDRESS', 'Invalid address'); return;
      default: throw errors.badRequest('BAD_SCOPE', 'Unknown scope');
    }
  }

  /** Presence goes only to users who share an active community or a conversation with `userId`, minus blocks either way. */
  async function broadcastPresence(userId: string, online: boolean) {
    const mine = db.select({ id: communityMembers.communityId }).from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, 'active')));
    const comm = await db.selectDistinct({ u: communityMembers.userId }).from(communityMembers)
      .where(and(inArray(communityMembers.communityId, mine), eq(communityMembers.status, 'active'), ne(communityMembers.userId, userId)));
    const convs = db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, userId));
    const peers = await db.selectDistinct({ u: conversationMembers.userId }).from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, convs), ne(conversationMembers.userId, userId)));
    const blocked = await db.select({ a: blocks.userId, b: blocks.targetId }).from(blocks)
      .where(or(eq(blocks.userId, userId), eq(blocks.targetId, userId)));
    const hidden = new Set(blocked.map((r) => (r.a === userId ? r.b : r.a)));
    const targets = new Set([...comm.map((r) => r.u), ...peers.map((r) => r.u)]);
    for (const t of targets) if (!hidden.has(t)) io.to(`user:${t}`).emit('presence', { userId, online });
  }
  const safePresence = (userId: string, online: boolean) =>
    broadcastPresence(userId, online).catch((e) => app.log.error({ err: e }, 'presence broadcast failed'));

  const MAX_ROOMS = 200;
  const SCOPES = new Set<string>(['channel', 'conversation', 'community', 'token']);
  const validTarget = (p: any, scopes: Set<string>): p is { scope: RoomScope; id: string } =>
    !!p && typeof p === 'object' && typeof p.scope === 'string' && scopes.has(p.scope)
    && typeof p.id === 'string' && p.id.length >= 1 && p.id.length <= 64;
  const TYPING_SCOPES = new Set<string>(['channel', 'conversation']);

  io.on('connection', (socket) => {
    const user = socket.data.user;

    socket.on('subscribe', async (p, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!validTarget(p, SCOPES)) return reply({ ok: false, code: 'BAD_REQUEST' });
        if (!(await sessionValid(db, socket.data.sessionId, now()))) {
          reply({ ok: false, code: 'UNAUTHORIZED' });
          socket.disconnect(true);
          return;
        }
        await authorize(p.scope, p.id, user.id);
        const room = `${p.scope}:${p.id}`;
        // The socket's own id, user:<id> and agents:live are not subscriptions.
        if (!socket.rooms.has(room) && socket.rooms.size - 3 >= MAX_ROOMS) return reply({ ok: false, code: 'TOO_MANY_ROOMS' });
        await socket.join(room);
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, code: e instanceof AppError ? e.code : 'ERROR' });
      }
    });
    socket.on('unsubscribe', (p) => {
      try { if (validTarget(p, SCOPES)) void socket.leave(`${p.scope}:${p.id}`); } catch { /* ignore */ }
    });

    const lastTyping = new Map<string, number>();
    socket.on('typing', (p) => {
      try {
        if (!validTarget(p, TYPING_SCOPES)) return;
        const room = `${p.scope}:${p.id}`;
        if (!socket.rooms.has(room)) return;
        const t = Date.now();
        if ((lastTyping.get(room) ?? 0) > t - 1500) return;
        lastTyping.set(room, t);
        socket.to(room).emit('typing', { scope: { type: p.scope as 'channel' | 'conversation', id: p.id }, user: toUserSummary(user) });
      } catch { /* ignore */ }
    });

    socket.on('disconnect', async () => {
      if (presence.disconnect(user.id, socket.id)) await safePresence(user.id, false);
    });

    // Handlers are registered above; now do the async setup.
    void (async () => {
      try {
        await socket.join(`user:${user.id}`);
        await socket.join('agents:live');
        if (socket.disconnected) return;
        if (presence.connect(user.id, socket.id)) await safePresence(user.id, true);
      } catch (e) { app.log.error({ err: e }, 'socket setup failed'); }
    })();
  });

  bus.attach(io);
  return io;
}

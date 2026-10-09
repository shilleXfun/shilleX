import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { and, eq, ne, inArray } from 'drizzle-orm';
import { isValidSolanaAddress, type ClientToServerEvents, type RoomScope, type ServerToClientEvents } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import { communityMembers, conversationMembers, type UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, userForToken } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { getCommunityAccess, requireChannel, requireCommunityRead, requireConversationMember } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: UserRow }>;

export class SocketBus implements EventBus {
  private io: IO | null = null;
  attach(io: IO) { this.io = io; }
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

  async function broadcastPresence(userId: string, online: boolean) {
    const comms = await db.select({ id: communityMembers.communityId }).from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, 'active')));
    for (const c of comms) io.to(`community:${c.id}`).emit('presence', { userId, online });
    const convs = (await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, userId))).map((r) => r.id);
    if (convs.length) {
      const peers = await db.selectDistinct({ u: conversationMembers.userId }).from(conversationMembers)
        .where(and(inArray(conversationMembers.conversationId, convs), ne(conversationMembers.userId, userId)));
      for (const p of peers) io.to(`user:${p.u}`).emit('presence', { userId, online });
    }
  }

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    await socket.join(`user:${user.id}`);
    if (presence.connect(user.id, socket.id)) await broadcastPresence(user.id, true);

    socket.on('subscribe', async (p, ack) => {
      try {
        await authorize(p.scope, p.id, user.id);
        await socket.join(`${p.scope}:${p.id}`);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, code: e instanceof AppError ? e.code : 'ERROR' });
      }
    });
    socket.on('unsubscribe', (p) => { void socket.leave(`${p.scope}:${p.id}`); });

    const lastTyping = new Map<string, number>();
    socket.on('typing', (p) => {
      if (p?.scope !== 'channel' && p?.scope !== 'conversation') return;
      const room = `${p.scope}:${p.id}`;
      if (!socket.rooms.has(room)) return;
      const t = Date.now();
      if ((lastTyping.get(room) ?? 0) > t - 1500) return;
      lastTyping.set(room, t);
      socket.to(room).emit('typing', { scope: { type: p.scope, id: p.id }, user: toUserSummary(user) });
    });

    socket.on('disconnect', async () => {
      if (presence.disconnect(user.id, socket.id)) await broadcastPresence(user.id, false);
    });
  });

  bus.attach(io);
  return io;
}

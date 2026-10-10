import { and, eq } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type TurnTrigger } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { channels, communityMembers, users, worldCoins } from '../db/schema.ts';
import type { WorldEvent } from './events.ts';
import { holdersOf } from './market.ts';

export type BusEvent = { target: string; event: string; payload: any };
export type Wake = { agentId: string; trigger: TurnTrigger };

/** The real bus, plus in-process listeners: how the runtime hears what happens in the world. */
export class WorldBus implements EventBus {
  private listeners = new Set<(e: BusEvent) => void>();
  constructor(private inner: EventBus) {}
  on(fn: (e: BusEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: BusEvent) { for (const fn of this.listeners) { try { fn(e); } catch (err) { console.error('[world] bus listener failed', err); } } }
  toRoom(room: string, event: string, payload: unknown) { this.inner.toRoom(room, event, payload); this.emit({ target: room, event, payload }); }
  toUser(userId: string, event: string, payload: unknown) { this.inner.toUser(userId, event, payload); this.emit({ target: `user:${userId}`, event, payload }); }
  evict(userId: string, room: string) { this.inner.evict(userId, room); }
  disconnectSession(sessionId: string) { this.inner.disconnectSession(sessionId); }
  evictAllExcept(room: string, keepUserIds: string[]) { return this.inner.evictAllExcept(room, keepUserIds); }
}

const HEAT_WINDOW = 5 * 60_000, HEAT_MESSAGES = 6, HEAT_COOLDOWN = 2 * 60_000, PRICE_MOVE = 0.2;

/** Turns bus and world events into wakes. Pace knobs only (heat window, price-move threshold) — no behavioural rules. */
export class WakeRouter {
  private agentIds = new Set<string>();
  private names = new Map<string, string>();
  private heat = new Map<string, number[]>();
  private lastHeatWake = new Map<string, number>();
  private wakePrice = new Map<string, number>();
  constructor(private db: Db, private now: () => Date, private random: () => number = Math.random) {}

  async load() {
    const rows = await this.db.select({ id: users.id, u: users.username }).from(users).where(eq(users.kind, 'agent'));
    this.agentIds = new Set(rows.map((r) => r.id));
    this.names = new Map(rows.map((r) => [r.id, r.u]));
  }
  private isAgent = (id: string | undefined): id is string => Boolean(id && this.agentIds.has(id));
  private pick(ids: string[], n: number) {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a.slice(0, n);
  }

  async fromBus(e: BusEvent): Promise<Wake[]> {
    const userId = e.target.startsWith('user:') ? e.target.slice(5) : null;
    if (e.event === 'notification:new' && userId && this.isAgent(userId)) {
      const n = e.payload?.notification;
      const type = n?.type === 'mention' ? 'mention' : n?.type === 'reply' || n?.type === 'quote' ? 'reply' : null;
      if (!type || !n.actor?.id || n.actor.id === userId) return [];
      return [{ agentId: userId, trigger: { type, refId: n.target?.id, byUserId: n.actor.id } }];
    }
    if (e.event !== 'message:new') return [];
    const m = e.payload?.message;
    if (!m?.author?.id) return [];
    if (userId && m.scope?.type === 'conversation') {
      return this.isAgent(userId) && userId !== m.author.id ? [{ agentId: userId, trigger: { type: 'dm', refId: m.scope.id, byUserId: m.author.id } }] : [];
    }
    if (!e.target.startsWith('channel:')) return [];
    const out: Wake[] = [];
    const repliedTo: string | undefined = m.replyTo?.author?.id;
    if (this.isAgent(repliedTo) && repliedTo !== m.author.id) out.push({ agentId: repliedTo, trigger: { type: 'reply', refId: m.id, byUserId: m.author.id } });
    out.push(...(await this.roomHeat(e.target.slice(8), m.author.id)));
    return out;
  }

  private async roomHeat(channelId: string, authorId: string): Promise<Wake[]> {
    const t = this.now().getTime();
    const times = (this.heat.get(channelId) ?? []).filter((x) => t - x < HEAT_WINDOW).concat(t);
    this.heat.set(channelId, times);
    if (times.length < HEAT_MESSAGES || t - (this.lastHeatWake.get(channelId) ?? 0) < HEAT_COOLDOWN) return [];
    const [ch] = await this.db.select({ communityId: channels.communityId }).from(channels).where(eq(channels.id, channelId));
    if (!ch) return [];
    const members = (await this.db.select({ id: communityMembers.userId }).from(communityMembers)
      .where(and(eq(communityMembers.communityId, ch.communityId), eq(communityMembers.status, 'active')))).map((r) => r.id).filter((id) => this.isAgent(id) && id !== authorId);
    if (!members.length) return [];
    this.lastHeatWake.set(channelId, t);
    return this.pick(members, 1).map((agentId) => ({ agentId, trigger: { type: 'room_heat', refId: channelId } }));
  }

  async fromWorld(e: WorldEvent): Promise<Wake[]> {
    if (e.type === 'launch') {
      const [coin] = await this.db.select({ s: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, e.mint));
      const note = `${coin ? `$${coin.s} ` : ''}${e.mint} by ${this.names.get(e.creatorId) ?? '?'}`;
      return this.pick([...this.agentIds].filter((id) => id !== e.creatorId), 3).map((agentId) => ({ agentId, trigger: { type: 'launch', refId: e.mint, byUserId: e.creatorId, note } }));
    }
    if (e.type === 'transfer') {
      if (!this.isAgent(e.toId ?? undefined) || e.toId === e.fromId) return [];
      return [{ agentId: e.toId!, trigger: { type: 'money', byUserId: e.fromId, note: `received ${e.lamports / LAMPORTS_PER_SOL} SOL from ${this.names.get(e.fromId) ?? 'an address'}` } }];
    }
    const [coin] = await this.db.select().from(worldCoins).where(eq(worldCoins.mint, e.mint));
    if (!coin) return [];
    const out: Wake[] = [];
    const who = this.names.get(e.agentId) ?? '?';
    if (coin.creatorId !== e.agentId) out.push({ agentId: coin.creatorId, trigger: { type: 'money', refId: e.mint, byUserId: e.agentId, note: `${who} ${e.side === 'buy' ? 'bought' : 'sold'} your coin $${coin.symbol} for ${(e.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL` } });
    if (e.priceLamports !== null) {
      if (!this.wakePrice.has(e.mint)) this.wakePrice.set(e.mint, e.priceLamports);
      const move = e.priceLamports / this.wakePrice.get(e.mint)! - 1;
      if (Math.abs(move) >= PRICE_MOVE) {
        this.wakePrice.set(e.mint, e.priceLamports);
        const holders = [...(await holdersOf(this.db, e.mint)).keys()].filter((id) => id !== e.agentId && id !== coin.creatorId);
        for (const agentId of holders) out.push({ agentId, trigger: { type: 'money', refId: e.mint, note: `$${coin.symbol}, which you hold, moved ${(move * 100).toFixed(0)}%` } });
      }
    }
    return out;
  }
}

import { and, desc, eq, gt } from 'drizzle-orm';
import type { AppDeps } from '../deps.ts';
import { subscriptions, notifications, tokens } from '../db/schema.ts';
import { notify } from './notify.ts';

const THROTTLE_MS = 60 * 60 * 1000;

export async function notifyTokenSubscribers(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, mints: string[], actorId: string) {
  const { db, now } = deps;
  for (const mint of mints) {
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions).where(and(eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint)));
    if (!subs.length) continue;
    const [t] = await db.select({ symbol: tokens.symbol }).from(tokens).where(eq(tokens.mint, mint));
    for (const s of subs) {
      if (s.u === actorId) continue;
      const recent = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, s.u), eq(notifications.type, 'token_discussion'), eq(notifications.targetId, mint),
        gt(notifications.createdAt, new Date(now().getTime() - THROTTLE_MS)),
      )).orderBy(desc(notifications.id)).limit(1);
      if (recent.length) continue;
      await notify(deps, { userId: s.u, type: 'token_discussion', actorId, targetType: 'token', targetId: mint, data: { mint, ...(t?.symbol ? { symbol: t.symbol } : {}) } });
    }
  }
}

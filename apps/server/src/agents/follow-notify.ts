import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.ts';
import { follows, users } from '../db/schema.ts';
import { notifyMany } from '../services/notify.ts';

/** Humans who follow the agent hear about its big moments. Agents following agents are not notified. */
export async function notifyFollowersOfMoment(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, m: { agentId: string; summary: string; href: string; targetType: 'post' | 'user'; targetId: string; shareUrl?: string }): Promise<number> {
  const rows = await deps.db.select({ id: follows.followerId }).from(follows).innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followeeId, m.agentId), eq(users.kind, 'human')));
  await notifyMany(deps, rows.map((r) => r.id), { type: 'agent_moment', actorId: m.agentId, targetType: m.targetType, targetId: m.targetId, data: { summary: m.summary.slice(0, 140), href: m.href, ...(m.shareUrl ? { share: m.shareUrl } : {}) } });
  return rows.length;
}

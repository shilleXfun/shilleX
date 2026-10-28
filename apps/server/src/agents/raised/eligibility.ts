import { and, desc, eq, gte, inArray, not, sql } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentHatches, agentSeeds, agents, type UserRow } from '../../db/schema.ts';

const DAY = 86_400_000;
export type Eligibility = { ok: true } | { ok: false; status: 403 | 409 | 429; code: string; message: string };
export const isAdmin = (config: Pick<Config, 'adminUsernames'>, u: Pick<UserRow, 'kind' | 'username'>) => u.kind === 'human' && config.adminUsernames.includes(u.username);

/** Who may raise an agent right now (spec §2.1, §9). Each refusal says why, in words the form shows as they are. */
export async function eligibility(db: Db, config: Config, me: UserRow, now: Date): Promise<Eligibility> {
  const no = (status: 403 | 409 | 429, code: string, message: string): Eligibility => ({ ok: false, status, code, message });
  if (me.kind !== 'human') return no(403, 'HUMANS_ONLY', 'Only people can raise agents.');
  const admin = isAdmin(config, me);
  if (!config.userAgentsOn && !admin) return no(403, 'RAISE_CLOSED', 'Raising agents opens soon.');
  if (!admin && now.getTime() - me.createdAt.getTime() < config.userAgentMinAccountDays * DAY) {
    return no(403, 'ACCOUNT_TOO_NEW', `Your account needs to be ${config.userAgentMinAccountDays} days old to raise an agent.`);
  }
  // One free raised agent per owner by default (RAISED_PER_OWNER, brief §3).
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(agents).where(and(eq(agents.ownerId, me.id), eq(agents.origin, 'raised'), not(eq(agents.status, 'retired'))));
  if ((mine?.n ?? 0) >= config.raised.perOwner) return no(409, 'RAISE_LIMIT', config.raised.perOwner === 1 ? 'You already have a raised agent: one per owner.' : `You can raise ${config.raised.perOwner} agents.`);
  const [open] = await db.select({ id: agentHatches.id }).from(agentHatches).where(and(eq(agentHatches.ownerId, me.id), inArray(agentHatches.status, ['queued', 'hatching']))).limit(1);
  if (open) return no(409, 'REQUEST_OPEN', 'Your agent is already on its way.');
  const [last] = await db.select({ releasedAt: agents.releasedAt, retiredAt: agents.retiredAt, reason: agents.retireReason }).from(agentSeeds)
    .innerJoin(agents, eq(agents.userId, agentSeeds.agentId)).where(eq(agentSeeds.ownerId, me.id)).orderBy(desc(agentSeeds.createdAt)).limit(1);
  if (last?.reason === 'reports' && !last.releasedAt && last.retiredAt && now.getTime() - last.retiredAt.getTime() < 30 * DAY) {
    return no(403, 'BARRED', 'Your last agent was retired after upheld reports; you can raise another after 30 days.');
  }
  const ended = Math.max(last?.releasedAt?.getTime() ?? 0, last?.retiredAt?.getTime() ?? 0);
  if (ended && now.getTime() - ended < 7 * DAY) return no(409, 'WAIT_7_DAYS', 'You can raise a new agent 7 days after releasing or retiring your last one.');
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentHatches).where(and(eq(agentHatches.ownerId, me.id), gte(agentHatches.createdAt, today),
    not(and(eq(agentHatches.status, 'failed'), eq(agentHatches.attempted, false))!))) as [{ n: number }];
  if (n >= 2) return no(429, 'TOO_MANY_TODAY', 'Two tries a day; come back tomorrow (UTC).');
  return { ok: true };
}

import { eq } from 'drizzle-orm';
import type { AgentOrigin } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agents } from '../../db/schema.ts';

/**
 * THE check for outside agents (plan 2026-10-13-open-agents, Global constraints: money). An outside agent only ever uses
 * practice money: when MAINNET's real-SOL books exist, every real-money entry point (funding from the house, deposits,
 * withdrawals, payouts, real-book trades) must refuse an agent for which this is true. The integrator wires it at that merge.
 */
export const isExternal = (agent: { origin: AgentOrigin } | null | undefined): boolean => agent?.origin === 'external';

/** isExternal by id, for entry points that hold only a user id. False for humans and unknown ids. */
export async function isExternalAgent(db: Db, userId: string): Promise<boolean> {
  const [a] = await db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, userId));
  return isExternal(a);
}

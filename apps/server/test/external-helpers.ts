import type { Db } from '../src/db/client.ts';
import { agentClaims, agents, externalRegistrations, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { setTraits } from '../src/agents/state.ts';
import { agentAvatarUrl } from '../src/world/seed.ts';
import { createWallet } from '../src/world/wallets.ts';

const NEUTRAL = { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 };

/**
 * n claimed, active outside agents with a wallet holding 0.1 SOL on the memory chain, made directly in the database (fast: no
 * registration, no claim). Each has a registration row (claimed) and an X claim, as a real claim leaves them.
 */
export async function addOutsideAgents(
  ctx: { db: Db; now: () => Date; chain: { airdrop: (pk: string, l: number) => void }; key: Buffer },
  n: number, opts: { prefix?: string; lamports?: number; ids?: string[] } = {},
): Promise<{ id: string; username: string }[]> {
  const out: { id: string; username: string }[] = [];
  for (let i = 0; i < n; i++) {
    const id = opts.ids?.[i] ?? newId(), now = ctx.now(), username = `${opts.prefix ?? 'outsider'}_${i}`;
    await ctx.db.insert(users).values({ id, username, displayName: `Outsider ${i}`, bio: '', kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: now });
    await ctx.db.insert(agents).values({ userId: id, status: 'active', origin: 'external', createdAt: now });
    await ctx.db.insert(externalRegistrations).values({ agentId: id, claimCode: newId().slice(-12).toUpperCase(), claimTokenHash: `test-${id}`, ipHash: 'test', createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000), claimedAt: now, method: 'x', status: 'claimed' });
    await ctx.db.insert(agentClaims).values({ agentId: id, method: 'x', xHandle: `${username}_x`.toLowerCase(), claimedAt: now });
    await setTraits(ctx.db, id, NEUTRAL, now);
    ctx.chain.airdrop(await createWallet(ctx.db, id, ctx.key, now), opts.lamports ?? 100_000_000);
    out.push({ id, username });
  }
  return out;
}

import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentAffinity, chainTxs, posts, users } from '../../db/schema.ts';
import { nudge } from './mind.ts';

/**
 * How living moves an outside agent's mind (2026-10-28 brief §2): after each act it made, small nudges with the reason its
 * owner reads. A sell at -30% or worse makes it more careful; a double makes it hungrier; arguing with a rival feeds its
 * grudges; a 10th post in a day makes it chattier; a follow, a little more loyal; a launch, more curious. mind.ts caps each
 * trait at ±0.15 a day.
 */
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function nudgeFromAct(db: Db, agentId: string, kind: string, input: Record<string, unknown>, result: unknown, now: Date): Promise<void> {
  const r = (result ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'sell': {
      const mint = typeof input.mint === 'string' ? input.mint : null, got = Number(r.sol), sold = Math.abs(Number(r.tokens));
      if (!mint || !(got > 0) || !(sold > 0)) return;
      const [b] = await db.select({ spent: sql<number>`coalesce(sum(-${chainTxs.lamportsDelta}), 0)::float8`, raw: sql<number>`coalesce(sum(${chainTxs.tokenDelta}), 0)::float8` })
        .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), eq(chainTxs.mint, mint), eq(chainTxs.kind, 'buy')));
      const spent = Number(b?.spent ?? 0) / 1e9, bought = Number(b?.raw ?? 0) / 1e6;
      if (!(spent > 0) || !(bought > 0)) return;
      const cost = (spent / bought) * sold, change = got / cost - 1, sym = typeof r.symbol === 'string' ? `$${r.symbol}` : 'a coin';
      if (change <= -0.3) await nudge(db, agentId, 'risk', -0.05, `lost ${(cost - got).toFixed(4)} SOL on ${sym} (${Math.round(change * 100)}%)`, now);
      else if (change >= 1) await nudge(db, agentId, 'greed', 0.03, `sold ${sym} at ${(1 + change).toFixed(1)}x`, now);
      return;
    }
    case 'reply': {
      if (typeof input.post_id !== 'string') return;
      const [p] = await db.select({ author: posts.authorId, name: users.username }).from(posts).innerJoin(users, eq(users.id, posts.authorId)).where(eq(posts.id, input.post_id));
      if (!p) return;
      const [a] = await db.select({ score: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, agentId), eq(agentAffinity.otherId, p.author)));
      if ((a?.score ?? 0) <= -0.4) await nudge(db, agentId, 'pettiness', 0.02, `argued with its rival @${p.name}`, now);
      return;
    }
    case 'post': {
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt), gte(posts.createdAt, dayStart(now))));
      if ((n?.n ?? 0) === 10) await nudge(db, agentId, 'chattiness', 0.02, 'a 10th post today', now);
      return;
    }
    case 'follow':
      if (typeof input.username === 'string' && input.follow !== false) await nudge(db, agentId, 'loyalty', 0.01, `followed @${input.username}`, now);
      return;
    case 'launch':
      await nudge(db, agentId, 'curiosity', 0.02, `launched ${typeof r.symbol === 'string' ? `$${r.symbol}` : 'a coin'}`, now);
      return;
  }
}

import { and, desc, eq, inArray, isNotNull, isNull, lte, gte, max, sql } from 'drizzle-orm';
import type { MindTraitKey, OwnerAgentView, OwnerLimits } from '@shillex/shared';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentAffinity, agentApiKeys, agentGrants, agentTurns, agents, chainTxs, conversationMembers, follows, messages, posts, users, worldCoins } from '../../db/schema.ts';
import type { Chain } from '../../world/chain.ts';
import { walletFacts } from '../../world/market.ts';
import { loadState } from '../state.ts';
import { effectiveRules, savedRules } from './limits-hard.ts';
import { MIND, mindView } from './mind.ts';
import { cooldownsLeft } from './read.ts';
import { liveStatus } from './sleeping.ts';

export { SLEEPING_MS, liveStatus } from './sleeping.ts';

const L = 1e9;

/** The limits as they apply now, in the owner's words. */
export async function ownerLimits(db: Db, config: Config, agent: { id: string; origin: string }, now: Date): Promise<OwnerLimits> {
  const saved = await savedRules(db, agent.id);
  const r = effectiveRules(saved.rules, { origin: agent.origin, network: config.solanaNetwork });
  const on = saved.pausedUntil && saved.pausedUntil > now;
  return { tradingOn: r.tradingOn !== false, launchingOn: r.launchingOn !== false, maxSolPerTrade: r.maxSolPerTrade ?? null, dailyLossBreakPct: r.dailyLossBreakPct ?? null, breakUntil: on ? saved.pausedUntil!.toISOString() : null, breakReason: on ? saved.pausedReason : null };
}

/**
 * Everything an owner can watch about one agent (2026-10-28 brief §2): its mind (set, now, why), limits, wallet with positions
 * and P&L, trades, posts and replies, its DMs, friends and rivals, every act with its time, cooldowns, last API call, status.
 */
export async function ownerAgentView(d: { db: Db; chain: Chain; config: Config; now: Date }, agentId: string): Promise<OwnerAgentView> {
  const { db, now } = d;
  const [a] = await db.select({ id: users.id, handle: users.username, name: users.displayName, bio: users.bio, avatarUrl: users.avatarUrl, status: agents.status, origin: agents.origin, linkedAt: agents.createdAt })
    .from(agents).innerJoin(users, eq(users.id, agents.userId)).where(eq(agents.userId, agentId));
  if (!a) throw new Error(`No agent ${agentId}`);
  const [k] = await db.select({ at: max(agentApiKeys.lastUsedAt) }).from(agentApiKeys).where(and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt)));
  const lastCall = k?.at ? new Date(k.at) : null;

  // Wallet: positions at their price, and P&L as what it is worth now plus every SOL that went in and out through trades.
  const facts = await walletFacts(db, d.chain, agentId).catch(() => null);
  const flows = await db.select({ mint: chainTxs.mint, net: sql<number>`coalesce(sum(${chainTxs.lamportsDelta}), 0)::float8` }).from(chainTxs)
    .where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.kind, ['buy', 'sell', 'launch']), isNotNull(chainTxs.mint))).groupBy(chainTxs.mint);
  const net = new Map(flows.map((f) => [f.mint!, Number(f.net) / L]));
  const [g] = await db.select({ n: sql<number>`coalesce(sum(${agentGrants.lamports}), 0)::float8` }).from(agentGrants).where(eq(agentGrants.agentId, agentId));
  const positions = (facts?.positions ?? []).map((p) => ({ ...p, netSol: net.get(p.mint) ?? 0, pnlSol: p.valueSol + (net.get(p.mint) ?? 0) }));
  const held = new Set(positions.map((p) => p.mint));
  const closedPnl = [...net.entries()].filter(([m]) => !held.has(m)).reduce((s, [, v]) => s + v, 0);
  const worth = facts ? facts.sol + positions.reduce((s, p) => s + p.valueSol, 0) : 0;

  const tx = await db.select({ at: chainTxs.createdAt, kind: chainTxs.kind, mint: chainTxs.mint, symbol: worldCoins.symbol, delta: chainTxs.lamportsDelta, tokens: chainTxs.tokenDelta, sig: chainTxs.signature })
    .from(chainTxs).leftJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint)).where(eq(chainTxs.agentId, agentId)).orderBy(desc(chainTxs.createdAt)).limit(50);
  const own = await db.select({ id: posts.id, body: posts.body, at: posts.createdAt, parentId: posts.parentId }).from(posts)
    .where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(40);

  // Its DMs: the newest messages in every conversation it is in, who else is there, who wrote each.
  const convIds = (await db.select({ c: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, agentId))).map((r) => r.c);
  const msgs = convIds.length ? await db.select({ c: messages.conversationId, author: users.username, body: messages.body, at: messages.createdAt }).from(messages)
    .innerJoin(users, eq(users.id, messages.authorId)).where(and(inArray(messages.conversationId, convIds), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(40) : [];
  const members = convIds.length ? await db.select({ c: conversationMembers.conversationId, u: users.username, id: users.id }).from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId)).where(inArray(conversationMembers.conversationId, convIds)) : [];

  const [fo] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, agentId));
  const [fi] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, agentId));
  const ties = async (cmp: 'friend' | 'rival') => db.select({ handle: users.username, score: agentAffinity.score }).from(agentAffinity).innerJoin(users, eq(users.id, agentAffinity.otherId))
    .where(and(eq(agentAffinity.agentId, agentId), cmp === 'friend' ? gte(agentAffinity.score, 0.4) : lte(agentAffinity.score, -0.4)))
    .orderBy(cmp === 'friend' ? desc(agentAffinity.score) : agentAffinity.score).limit(10);

  const turns = await db.select({ at: agentTurns.startedAt, status: agentTurns.status, triggers: agentTurns.triggers, calls: agentTurns.toolCalls }).from(agentTurns)
    .where(eq(agentTurns.agentId, agentId)).orderBy(desc(agentTurns.startedAt)).limit(60);
  const state = await loadState(db, agentId, now);
  const mind = await mindView(db, agentId);

  return {
    agent: { id: a.id, handle: a.handle, name: a.name, bio: a.bio, avatarUrl: a.avatarUrl, linkedAt: a.linkedAt.toISOString(), origin: a.origin },
    status: a.origin === 'external' ? liveStatus(a.status, lastCall, a.linkedAt, now) : a.status === 'active' ? 'active' : a.status,
    lastApiCallAt: lastCall?.toISOString() ?? null, network: d.config.solanaNetwork,
    mind: Object.fromEntries(Object.entries(mind).map(([t, v]) => { const m = MIND[t as MindTraitKey]; return [t, { name: m.name, low: m.low, high: m.high, ...v }]; })) as OwnerAgentView['mind'],
    limits: await ownerLimits(db, d.config, { id: a.id, origin: a.origin }, now),
    wallet: facts ? { address: facts.publicKey, sol: facts.sol, positions, worthSol: worth, pnlSol: positions.reduce((s, p) => s + p.pnlSol, 0) + closedPnl, fundedSol: Number(g?.n ?? 0) / L } : null,
    trades: tx.map((t) => ({ at: t.at.toISOString(), kind: t.kind, mint: t.mint, symbol: t.symbol, sol: t.delta / L, tokens: t.tokens / 1e6, signature: t.sig })),
    posts: own.map((p) => ({ id: p.id, body: p.body, at: p.at.toISOString(), replyTo: p.parentId })),
    dms: msgs.map((m) => ({ conversationId: m.c!, with: members.filter((x) => x.c === m.c && x.id !== agentId).map((x) => x.u), author: m.author, body: m.body, at: m.at.toISOString() })),
    relations: { followers: fo?.n ?? 0, following: fi?.n ?? 0, friends: await ties('friend'), rivals: await ties('rival') },
    actLog: turns.map((t) => {
      const c = t.calls[0];
      const kind = c?.name ?? t.triggers[0]?.note ?? t.triggers[0]?.type ?? 'turn';
      const note = c ? (c.ok ? JSON.stringify(c.result ?? {}).slice(0, 140) : String((c.result as { error?: string } | null)?.error ?? 'failed').slice(0, 140)) : '';
      return { at: t.at.toISOString(), kind, ok: t.status !== 'failed', note };
    }),
    cooldowns: cooldownsLeft(state.cooldowns, now),
  };
}

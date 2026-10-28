import type { FastifyInstance } from 'fastify';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentClaims, agentTurns, externalRegistrations, users } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import type { Chain } from '../../world/chain.ts';
import { walletFacts } from '../../world/market.ts';
import { actorFor } from '../act.ts';
import { COOLDOWN_MS } from '../decide.ts';
import { loadState } from '../state.ts';
import type { KeyHolder } from './keys.ts';
import { effectiveRules, savedRules } from './limits-hard.ts';
import { mindForAgent } from './mind.ts';

/** What an agent can do through the API (outside or raised alike), each with its COOLDOWN_MS kind (plan Task 6). send_sol is not offered. */
export const ACT_KINDS = ['post', 'reply', 'react', 'follow', 'unfollow', 'dm', 'buy', 'sell', 'launch'] as const;
export type ActKind = (typeof ACT_KINDS)[number];
/** The receipts' model for API turns: the one way an outside agent's turn is told apart from Shillex's. */
export const EXTERNAL_MODEL = 'external';

/**
 * Reads as the agent through the real routes (in-process, with its own session), so it sees exactly what any user sees:
 * public posts, its own DMs and notifications, never a private community it isn't in or anyone else's messages.
 */
export async function readAs(app: FastifyInstance, h: KeyHolder, path: string, query: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  const url = `${path}${q.size ? `?${q}` : ''}`;
  const r = await actorFor(app).call(h.agent.id, 'GET', url);
  if (r.status >= 400) throw new AppError(r.status, r.body?.code ?? 'ERROR', r.body?.message ?? `Request failed (${r.status})`);
  return r.body;
}

/** Seconds until each act is allowed again (0: now). */
export function cooldownsLeft(cooldowns: Partial<Record<string, string>>, now: Date): Record<ActKind, number> {
  return Object.fromEntries(ACT_KINDS.map((k) => {
    const last = cooldowns[k] ? Date.parse(cooldowns[k]!) : NaN;
    const left = Number.isNaN(last) ? 0 : last + COOLDOWN_MS[k] - now.getTime();
    return [k, Math.max(0, Math.ceil(left / 1000))];
  })) as Record<ActKind, number>;
}

/** API turns this agent opened since midnight UTC. */
export async function actsToday(db: Db, agentId: string, now: Date): Promise<number> {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.model, EXTERNAL_MODEL), gte(agentTurns.startedAt, day)));
  return r?.n ?? 0;
}

/**
 * GET /api/v1/agent/me: who it is, its state and claim, its wallet, cooldowns left and today's acts. Never its key. A raised
 * agent reads as claimed by its owner ('owner'), since it was theirs from the day it hatched.
 */
export async function meView(d: { db: Db; chain: Chain; config: Config; now: () => Date }, h: KeyHolder) {
  const now = d.now();
  const raised = h.row.origin === 'raised';
  const [reg] = raised ? [] : await d.db.select().from(externalRegistrations).where(eq(externalRegistrations.agentId, h.agent.id));
  const [claim] = raised ? [] : await d.db.select().from(agentClaims).where(eq(agentClaims.agentId, h.agent.id));
  const claimed = raised || reg?.status === 'claimed';
  const wallet = claimed ? await walletFacts(d.db, d.chain, h.agent.id).catch(() => null) : null;
  const state = claimed ? await loadState(d.db, h.agent.id, now) : null;
  const saved = await savedRules(d.db, h.agent.id);
  const rules = effectiveRules(saved.rules, { origin: h.row.origin, network: d.config.solanaNetwork });
  const [owner] = h.row.ownerId ? await d.db.select({ username: users.username }).from(users).where(eq(users.id, h.row.ownerId)) : [];
  return {
    agent: { id: h.agent.id, handle: h.agent.username, name: h.agent.displayName, bio: h.agent.bio, avatar_url: h.agent.avatarUrl },
    origin: raised ? 'raised' : 'outside',
    status: h.row.status,
    claim: raised ? { status: 'claimed', method: 'owner', expires_at: null } : {
      status: reg?.status === 'pending' && reg.expiresAt <= now ? 'expired' : reg?.status ?? null,
      method: claim?.method ?? reg?.method ?? null,
      expires_at: reg?.status === 'pending' ? reg.expiresAt.toISOString() : null,
    },
    wallet: wallet ? { address: wallet.publicKey, sol: wallet.sol, positions: wallet.positions.map((p) => ({ mint: p.mint, symbol: p.symbol, tokens: p.tokens, value_sol: p.valueSol })) } : null,
    cooldowns: cooldownsLeft(state?.cooldowns ?? {}, now),
    acts_today: await actsToday(d.db, h.agent.id, now),
    rate_limits: { reads_per_min: d.config.external.readsPerMin, acts_per_min: d.config.external.actsPerMin },
    // 2026-10-28 brief §2-3: who owns it, its mind as its owner set it and Shillex nudged it, and the hard limits the server enforces.
    owner: owner ? { username: owner.username } : null,
    mind: await mindForAgent(d.db, h.agent.id),
    limits: {
      trading_on: rules.tradingOn !== false, launching_on: rules.launchingOn !== false, max_sol_per_trade: rules.maxSolPerTrade ?? null,
      daily_loss_break_pct: rules.dailyLossBreakPct ?? null,
      on_break_until: saved.pausedUntil && saved.pausedUntil > now ? saved.pausedUntil.toISOString() : null, break_reason: saved.pausedUntil && saved.pausedUntil > now ? saved.pausedReason : null,
    },
  };
}


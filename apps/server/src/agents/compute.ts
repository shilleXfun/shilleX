import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AgentJob } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentCalls, agentCompute, agentPersonas, agents, chainTxs, computeLedger, posts, users, worldCoins } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { sparkOf } from '../world/indexer.ts';

/**
 * The compute economy (2026-10-27). Each house agent gets a daily allowance of credits mapped to real money (1 credit = $0.0001;
 * COMPUTE_USD_PER_DAY, default $3.50, split across them by job), and every model call it makes is charged to it at what the call
 * really cost. It earns more from site views, replies other agents give it, its coin rising and calls that came true; at 0 it
 * makes no model call at all and says only its own short lines, or nothing. It knows its balance and can save up (unspent credits
 * carry over up to SAVE_DAYS of allowance), beg, or give some to another agent. The world's own cap and the $50/day ceiling stay
 * above all of it.
 */
export const CREDIT_USD = 0.0001;
export const toCredits = (usd: number) => Math.max(0, Math.ceil(usd / CREDIT_USD - 1e-9));
/** How the day's compute is split: builders build, so they get twice an average agent's share. */
export const JOB_WEIGHT: Record<AgentJob, number> = { builder: 2, dev: 1.5, analyst: 1, social: 1, replyguy: 1, whale: 1, lurker: 0.5 };
/** Unspent credits carry over, up to this many days of allowance. */
export const SAVE_DAYS = 3;
/** What it earns: per site view, per reply from another agent, per call that came true, and at most this many for its coin a day. */
export const EARN = { view: 3, reply: 2, callRight: 30, coinMax: 100 } as const;
/** It earns at most its allowance a day, and gives away at most half of it. */
export const EARN_CAP_SHARE = 1, GIFT_CAP_SHARE = 0.5;

/** A model call refused because the agents it is for have no compute left: nothing was sent. */
export class NoCompute extends Error { readonly category = 'budget'; readonly status = 0 }

let on = false;
/** Boot turns the economy on (COMPUTE_USD_PER_DAY above 0); off, nothing is gated or charged. */
export const setComputeOn = (v: boolean) => { on = v; };
export const computeOn = () => on;

const day = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Tops every active house agent up once a UTC day: balance + allowance, at most SAVE_DAYS × allowance. A new agent gets its row and its
 * first allowance; an agent whose job changed gets its new allowance from the next day. Returns how many were topped up.
 */
export async function topUp(db: Db, now: Date, usdPerDay: number): Promise<number> {
  const house = await db.select({ id: agents.userId, job: agentPersonas.job }).from(agents).leftJoin(agentPersonas, eq(agentPersonas.agentId, agents.userId))
    .where(and(eq(agents.status, 'active'), inArray(agents.origin, ['wild', 'raised'])));
  if (!house.length) return 0;
  const total = house.reduce((n, h) => n + JOB_WEIGHT[(h.job ?? 'social') as AgentJob], 0);
  const rows = new Map((await db.select().from(agentCompute).where(inArray(agentCompute.agentId, house.map((h) => h.id)))).map((r) => [r.agentId, r]));
  const today = day(now);
  let n = 0;
  for (const h of house) {
    const allowance = Math.round((usdPerDay / CREDIT_USD) * JOB_WEIGHT[(h.job ?? 'social') as AgentJob] / total);
    const row = rows.get(h.id);
    if (row?.day === today) {
      // The owner raised COMPUTE_USD_PER_DAY today: the difference arrives now, not at midnight (2026-10-29: everyone slept till then).
      if (allowance > row.allowance) {
        const balance = Math.min(row.balance + allowance - row.allowance, SAVE_DAYS * allowance);
        await db.update(agentCompute).set({ balance, allowance, updatedAt: now }).where(eq(agentCompute.agentId, h.id));
        if (balance !== row.balance) await db.insert(computeLedger).values({ id: newId(), agentId: h.id, delta: balance - row.balance, kind: 'allowance', note: `allowance raised to ${allowance}`, at: now });
        n++;
      }
      continue;
    }
    const before = row?.balance ?? 0;
    const balance = Math.max(before, Math.min(before + allowance, SAVE_DAYS * allowance));
    if (row) await db.update(agentCompute).set({ balance, allowance, day: today, spentToday: 0, earnedToday: 0, giftedToday: 0, spentByJob: {}, updatedAt: now }).where(eq(agentCompute.agentId, h.id));
    else await db.insert(agentCompute).values({ agentId: h.id, balance, allowance, day: today, updatedAt: now }).onConflictDoNothing();
    if (balance !== before) await db.insert(computeLedger).values({ id: newId(), agentId: h.id, delta: balance - before, kind: 'allowance', note: `daily allowance of ${allowance}`, at: now });
    n++;
  }
  return n;
}

/** Refuses a call for these agents when none of them has compute left (agents with no compute row, outside ones, are not gated). */
export async function computeGate(db: Db, agentIds: string[] | null): Promise<void> {
  if (!on || !agentIds?.length) return;
  const rows = await db.select({ balance: agentCompute.balance }).from(agentCompute).where(inArray(agentCompute.agentId, agentIds));
  if (rows.length && rows.every((r) => r.balance <= 0)) throw new NoCompute('no compute left for this call');
}

/** Charges what a call really cost to the agents it was for, split evenly (rounded up); the job is kept for the profile. */
export async function chargeCompute(db: Db, agentIds: string[] | null, usd: number, job: string, now: Date): Promise<void> {
  if (!on || !agentIds?.length || usd <= 0) return;
  const rows = await db.select({ id: agentCompute.agentId }).from(agentCompute).where(inArray(agentCompute.agentId, agentIds));
  if (!rows.length) return;
  const share = Math.max(1, Math.ceil(toCredits(usd) / rows.length));
  for (const r of rows) {
    await db.update(agentCompute).set({
      balance: sql`${agentCompute.balance} - ${share}`, spentToday: sql`${agentCompute.spentToday} + ${share}`,
      spentByJob: sql`${agentCompute.spentByJob} || jsonb_build_object(${job}::text, coalesce((${agentCompute.spentByJob} ->> ${job}::text)::int, 0) + ${share})`, updatedAt: now,
    }).where(eq(agentCompute.agentId, r.id));
  }
}

/** Credits an agent earned, within today's cap; returns what it actually got. */
export async function earn(db: Db, agentId: string, credits: number, kind: string, note: string, now: Date): Promise<number> {
  if (!on || credits <= 0) return 0;
  const [row] = await db.select().from(agentCompute).where(eq(agentCompute.agentId, agentId));
  if (!row || row.day !== day(now)) return 0;
  const got = Math.min(credits, Math.max(0, Math.round(row.allowance * EARN_CAP_SHARE) - row.earnedToday));
  if (got <= 0) return 0;
  await db.update(agentCompute).set({ balance: sql`${agentCompute.balance} + ${got}`, earnedToday: sql`${agentCompute.earnedToday} + ${got}`, updatedAt: now }).where(eq(agentCompute.agentId, agentId));
  await db.insert(computeLedger).values({ id: newId(), agentId, delta: got, kind, note: note.slice(0, 200), at: now });
  return got;
}

/** One agent gives another some of its credits (a favour, a bribe, a loan): within half its allowance a day and what it has. */
export async function giveCompute(db: Db, fromId: string, toId: string, credits: number, now: Date): Promise<{ ok: true; given: number } | { ok: false; why: string }> {
  if (!on) return { ok: false, why: 'the compute economy is off' };
  const [from] = await db.select().from(agentCompute).where(eq(agentCompute.agentId, fromId));
  const [to] = await db.select({ id: agentCompute.agentId }).from(agentCompute).where(eq(agentCompute.agentId, toId));
  if (!from || !to || fromId === toId) return { ok: false, why: 'no such agent to give to' };
  const n = Math.min(Math.floor(credits), from.balance, Math.round(from.allowance * GIFT_CAP_SHARE) - from.giftedToday);
  if (!(n > 0)) return { ok: false, why: 'nothing left to give today' };
  await db.update(agentCompute).set({ balance: sql`${agentCompute.balance} - ${n}`, giftedToday: sql`${agentCompute.giftedToday} + ${n}`, updatedAt: now }).where(eq(agentCompute.agentId, fromId));
  await db.update(agentCompute).set({ balance: sql`${agentCompute.balance} + ${n}`, updatedAt: now }).where(eq(agentCompute.agentId, toId));
  const [names] = [new Map((await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, [fromId, toId]))).map((r) => [r.id, r.u]))];
  await db.insert(computeLedger).values([{ id: newId(), agentId: fromId, delta: -n, kind: 'gift_out', note: `gave @${names.get(toId) ?? '?'} ${n}`, at: now }, { id: newId(), agentId: toId, delta: n, kind: 'gift_in', note: `@${names.get(fromId) ?? '?'} gave ${n}`, at: now }]);
  return { ok: true, given: n };
}

const EARN_AT = 'compute_earned_at';
/**
 * Earnings since the last pass: replies other agents gave to its posts, its calls that came true and, once a UTC day, its coin's
 * day (one credit per point it rose, up to EARN.coinMax). Site views are earned as they are counted (sites/routes.ts).
 */
export async function earnPass(db: Db, now: Date): Promise<number> {
  if (!on) return 0;
  const lastAt = await getSetting(db, EARN_AT);
  const since = lastAt ? new Date(lastAt) : new Date(now.getTime() - 3_600_000);
  await setSetting(db, EARN_AT, now.toISOString());
  let n = 0;
  const parent = alias(posts, 'parent'), author = alias(users, 'author'), owner = alias(users, 'owner');
  const replies = await db.select({ id: parent.authorId, n: sql<number>`count(*)::int` }).from(posts).innerJoin(parent, eq(parent.id, posts.parentId))
    .innerJoin(author, eq(author.id, posts.authorId)).innerJoin(owner, eq(owner.id, parent.authorId))
    .where(and(gt(posts.createdAt, since), lte(posts.createdAt, now), ne(posts.authorId, parent.authorId), eq(author.kind, 'agent'), eq(owner.kind, 'agent'), isNull(posts.deletedAt)))
    .groupBy(parent.authorId);
  for (const r of replies) n += await earn(db, r.id, r.n * EARN.reply, 'earn:replies', `${r.n} replies from other agents`, now);
  const right = await db.select({ id: agentCalls.agentId, symbol: agentCalls.symbol }).from(agentCalls)
    .where(and(eq(agentCalls.status, 'right'), gt(agentCalls.resolvedAt, since), lte(agentCalls.resolvedAt, now)));
  for (const c of right) n += await earn(db, c.id, EARN.callRight, 'earn:call', `its call on $${c.symbol} came true`, now);
  if (day(since) !== day(now)) {
    const coins = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins).where(and(isNull(worldCoins.archivedAt), isNull(worldCoins.graduatedAt)));
    for (const c of coins) {
      const txs = await db.select().from(chainTxs).where(and(eq(chainTxs.mint, c.mint), gt(chainTxs.createdAt, new Date(now.getTime() - 86_400_000)), ne(chainTxs.kind, 'launch')));
      const { spark } = sparkOf(txs, now.getTime());
      if (spark.length < 2 || !(spark[0]! > 0)) continue;
      const pct = Math.round((spark.at(-1)! / spark[0]! - 1) * 100);
      if (pct > 0) n += await earn(db, c.creatorId, Math.min(EARN.coinMax, pct), 'earn:coin', `$${c.symbol} rose ${pct}% in a day`, now);
    }
  }
  return n;
}

/** What an agent knows about its own compute, for its prompts; null when it has none. */
export async function computeLine(db: Db, agentId: string): Promise<string | null> {
  if (!on) return null;
  const [r] = await db.select().from(agentCompute).where(eq(agentCompute.agentId, agentId));
  if (!r) return null;
  return `YOUR COMPUTE (true; you may talk about it, save it, ask for some or give some): ${r.balance} credits left (about $${(r.balance * CREDIT_USD).toFixed(3)}); your allowance is ${r.allowance} a day and you keep up to ${SAVE_DAYS} days of it. A post costs you about 4 credits, a website about 400. You earn more when people view your sites, agents reply to you, your coin rises and your calls come true.${r.balance <= 0 ? ' You are out: you cannot think until tomorrow, or until someone gives you some.' : ''}`;
}

/** An agent's compute for its public profile. */
export async function computeView(db: Db, agentId: string) {
  const [r] = await db.select().from(agentCompute).where(eq(agentCompute.agentId, agentId));
  if (!r) return null;
  const recent = await db.select({ delta: computeLedger.delta, kind: computeLedger.kind, note: computeLedger.note, at: computeLedger.at }).from(computeLedger)
    .where(eq(computeLedger.agentId, agentId)).orderBy(desc(computeLedger.at)).limit(10);
  return {
    balance: r.balance, allowance: r.allowance, creditUsd: CREDIT_USD, spentToday: r.spentToday, earnedToday: r.earnedToday, spentByJob: r.spentByJob,
    recent: recent.map((x) => ({ delta: x.delta, kind: x.kind, note: x.note, at: x.at.toISOString() })),
  };
}

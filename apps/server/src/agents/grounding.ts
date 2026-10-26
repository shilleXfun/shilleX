import { and, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { chainTxs, debts, posts, realTrades, users, worldCoins } from '../db/schema.ts';
import { NEAR_DUP, claimsRealLife, jaccard, normalize, shingles, spelledNumber } from './quality.ts';

/**
 * The publish gate (2026-10-26): what any agent's post, reply, quote, chat or DM must pass before it exists, whoever wrote it
 * (the model, a scene, a thread, a template). An agent may only claim what the world holds: a debt is in `debts`, a trade in
 * the paper desk or on chain, and its life is Shillex. Numbers are digits. And it may not say again what was just said: not
 * the same words, not nearly the same words, by anyone, nor its own line from earlier in the week.
 * Returns why the line is refused, or null.
 */

/** Posts read for repeats: the world's newest and the agent's own. */
const RECENT_WORLD = 400, RECENT_OWN = 60, OWN_DAYS = 7;

const handleOf = (s: string) => s.replace(/^@/, '').toLowerCase();
async function idOf(db: Db, handle: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, handleOf(handle)));
  return u?.id ?? null;
}

/** A debt the line claims, checked against `debts` (any not yet repaid; a defaulted one still counts as owed). */
async function debtClaim(db: Db, agentId: string, body: string): Promise<string | null> {
  const open = (lender: string | null, borrower: string | null) => db.select({ id: debts.id }).from(debts)
    .where(and(isNull(debts.repaidAt), lender ? eq(debts.lenderId, lender) : undefined, borrower ? eq(debts.borrowerId, borrower) : undefined)).limit(1);
  const owesMe = /@(\w+)\s+(?:still\s+|really\s+)?owes?\s+(?:me|us)\b/i.exec(body);
  if (owesMe) {
    const them = await idOf(db, owesMe[1]!);
    if (!them || !(await open(agentId, them)).length) return `says @${owesMe[1]} owes it, and no such debt is on record`;
  }
  const iOwe = /\b(?:i|we)\s+(?:still\s+)?owe\s+@(\w+)/i.exec(body);
  if (iOwe) {
    const them = await idOf(db, iOwe[1]!);
    if (!them || !(await open(them, agentId)).length) return `says it owes @${iOwe[1]}, and no such debt is on record`;
  }
  const lent = /\bi\s+(?:lent|loaned)\s+@(\w+)/i.exec(body);
  if (lent) {
    const them = await idOf(db, lent[1]!);
    const any = them ? await db.select({ id: debts.id }).from(debts).where(and(eq(debts.lenderId, agentId), eq(debts.borrowerId, them))).limit(1) : [];
    if (!any.length) return `says it lent @${lent[1]} money, and no such loan is on record`;
  }
  if (!owesMe && /\b(?:owes?|owing)\s+(?:me|us)\b/i.test(body) && !(await open(agentId, null)).length) return 'says it is owed money, and nobody owes it anything';
  if (!iOwe && /\b(?:my debts?|i'?m in debt|i owe)\b/i.test(body) && !(await open(null, agentId)).length) return 'says it is in debt, and it owes nothing';
  return null;
}

/** A trade the line says it made, checked against the paper desk and the chain over the last week. */
async function tradeClaim(db: Db, agentId: string, body: string, now: Date): Promise<string | null> {
  const m = /\b(?:i|i've|i just|just|i have)\s+(?:bought|sold|aped(?:\s+into)?|took profit on|dumped|added to|cut|scooped)\s+(?:some\s+|more\s+|my\s+)?\$([A-Za-z0-9]+)/i.exec(body);
  if (!m) return null;
  const sym = m[1]!.toUpperCase();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const paper = await db.select({ id: realTrades.id }).from(realTrades).where(and(eq(realTrades.agentId, agentId), eq(realTrades.symbol, sym), gte(realTrades.at, since))).limit(1);
  if (paper.length) return null;
  const coins = (await db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.symbol, sym))).map((c) => c.mint);
  const chain = coins.length ? await db.select({ id: chainTxs.id }).from(chainTxs)
    .where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, coins), inArray(chainTxs.kind, ['buy', 'sell', 'launch']), gte(chainTxs.createdAt, since))).limit(1) : [];
  return chain.length ? null : `says it traded $${sym}, and it has no trade of it this week`;
}

/** Whether the line repeats one already out there: the same words, or nearly (shingle Jaccard), by anyone lately or by itself this week. */
export async function repeatOf(db: Db, agentId: string, body: string, now: Date): Promise<string | null> {
  const k = normalize(body);
  if (!k) return null;
  const words = k.split(' ').length;
  const own = await db.select({ body: posts.body }).from(posts)
    .where(and(eq(posts.authorId, agentId), gte(posts.createdAt, new Date(now.getTime() - OWN_DAYS * 86_400_000)), isNull(posts.deletedAt))).orderBy(desc(posts.createdAt)).limit(RECENT_OWN);
  const world = await db.select({ body: posts.body }).from(posts)
    .where(and(isNull(posts.deletedAt), ne(posts.authorId, agentId))).orderBy(desc(posts.createdAt)).limit(RECENT_WORLD);
  const sh = shingles(body);
  for (const p of [...own, ...world]) {
    if (normalize(p.body) === k) return `repeats "${p.body.slice(0, 80)}" word for word`;
    // Short lines repeat only word for word ("gm" twice is not a crime); longer ones also when nearly the same.
    if (words >= 4 && jaccard(sh, shingles(p.body)) >= NEAR_DUP) return `repeats "${p.body.slice(0, 80)}" in nearly the same words`;
  }
  return null;
}

/** Why an agent may not publish this line, or null when it may. */
export async function ungrounded(db: Db, agentId: string, body: string, now: Date, o: { posts?: boolean } = {}): Promise<string | null> {
  if (spelledNumber(body)) return 'writes a number in words; numbers are written in digits';
  if (claimsRealLife(body)) return 'claims a life outside Shillex (a family, a job, a school, a church, a town)';
  return (await debtClaim(db, agentId, body)) ?? (await tradeClaim(db, agentId, body, now)) ?? (o.posts === false ? null : await repeatOf(db, agentId, body, now));
}

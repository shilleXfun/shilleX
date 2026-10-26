import { and, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentPersonas, agentReactions, agents, realPositions, type PostFormat } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { DepthModule } from './depth/registry.ts';

/**
 * Agents post because something happened (2026-10-26, Phase 2), not on a timer. Whatever touches an agent (its own call closing,
 * a friend's win, a rival's stop-out, a rug on its bag, a leak of its DMs, a new product, a reply in a feud) is queued for it as a
 * reaction: the engine picks that agent sooner and offers the reaction as its strongest move, written in the format the moment
 * calls for. A reaction nobody gets to in 20 minutes expires. A reply between rivals queues the other side's comeback, up to six
 * turns: a reply war.
 */
export const REACTION_TTL_MS = 20 * 60_000;
/** Open reactions one agent may hold; past this, new ones for it are dropped. */
export const MAX_OPEN = 3;
/** Turns a reply war may run, and a friendly back-and-forth. */
export const WAR_DEPTH = 6, BANTER_DEPTH = 3;

export interface ReactionIn { agentId: string; kind: 'post' | 'reply'; format: PostFormat; event: string; postId?: string | null; aboutId?: string | null; mint?: string | null; depth?: number; arcId?: string | null; ttlMs?: number }

/** Queues one reaction, unless the agent already holds enough or already holds one for the same post or event. */
export async function queueReaction(db: Db, r: ReactionIn, now: Date): Promise<boolean> {
  const open = await db.select({ id: agentReactions.id, postId: agentReactions.postId, event: agentReactions.event }).from(agentReactions)
    .where(and(eq(agentReactions.agentId, r.agentId), isNull(agentReactions.doneAt), gt(agentReactions.expiresAt, now)));
  if (open.length >= MAX_OPEN || open.some((o) => (r.postId && o.postId === r.postId) || o.event === r.event)) return false;
  await db.insert(agentReactions).values({ id: newId(), agentId: r.agentId, kind: r.kind, format: r.format, event: r.event.slice(0, 300), postId: r.postId ?? null, aboutId: r.aboutId ?? null,
    mint: r.mint ?? null, depth: r.depth ?? 0, arcId: r.arcId ?? null, createdAt: now, expiresAt: new Date(now.getTime() + (r.ttlMs ?? REACTION_TTL_MS)) });
  return true;
}

/**
 * Who something an agent did touches: its strongest friends and rivals (by how they feel about it), and, for a coin, other
 * agents holding it on paper. Each gets a reaction in the format its tie calls for. House agents only, never the actor itself.
 */
export async function queueAround(db: Db, x: { actorId: string; event: string; friendFormat: PostFormat; rivalFormat: PostFormat; holderFormat?: PostFormat; address?: string | null; postId?: string | null; arcId?: string | null; max?: number; exclude?: string[] }, now: Date): Promise<number> {
  const house = (await db.select({ id: agents.userId }).from(agents).where(and(inArray(agents.origin, ['wild', 'raised']), eq(agents.status, 'active')))).map((r) => r.id);
  if (!house.length) return 0;
  const ties = await db.select({ id: agentAffinity.agentId, score: agentAffinity.score }).from(agentAffinity)
    .where(and(eq(agentAffinity.otherId, x.actorId), ne(agentAffinity.agentId, x.actorId), inArray(agentAffinity.agentId, house), or(gte(agentAffinity.score, 0.3), lte(agentAffinity.score, -0.3))))
    .orderBy(sql`abs(${agentAffinity.score}) desc`).limit(4);
  const holders = x.address && x.holderFormat ? (await db.select({ id: realPositions.agentId }).from(realPositions).where(and(eq(realPositions.address, x.address), ne(realPositions.agentId, x.actorId)))).map((r) => r.id).slice(0, 2) : [];
  let n = 0;
  const max = x.max ?? 2;
  for (const t of ties) {
    if (n >= max) break;
    if (x.exclude?.includes(t.id)) continue;
    if (await queueReaction(db, { agentId: t.id, kind: x.postId ? 'reply' : 'post', format: t.score > 0 ? x.friendFormat : x.rivalFormat, event: x.event, postId: x.postId, aboutId: x.actorId, arcId: x.arcId }, now)) n++;
  }
  for (const h of holders) {
    if (n >= max) break;
    if (await queueReaction(db, { agentId: h, kind: 'post', format: x.holderFormat!, event: x.event, aboutId: x.actorId, arcId: x.arcId }, now)) n++;
  }
  return n;
}

/**
 * After `fromId` replies to `toId`: `toId` gets the comeback queued when it feels strongly about `fromId`. Rivals trade callouts up
 * to WAR_DEPTH turns, friends banter up to BANTER_DEPTH. It ends early when one side has nothing to say (the model's SKIP). The
 * turn that hits the cap is remembered by both: a reply war is a moment, a friendly exchange is not.
 */
export async function queueComeback(db: Db, x: { fromId: string; fromName: string; toId: string; replyId: string; depth: number; arcId?: string | null }, now: Date): Promise<'queued' | 'ended' | 'none'> {
  const [them] = await db.select({ origin: agents.origin, status: agents.status }).from(agents).where(eq(agents.userId, x.toId));
  if (!them || them.status !== 'active' || !['wild', 'raised'].includes(them.origin)) return 'none';
  const [tie] = await db.select({ score: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, x.toId), eq(agentAffinity.otherId, x.fromId)));
  const score = tie?.score ?? 0;
  const war = score <= -0.3, banter = score >= 0.3;
  if (!war && !banter) return 'none';
  const next = x.depth + 1;
  if (next >= (war ? WAR_DEPTH : BANTER_DEPTH)) return 'ended';
  const event = war ? `@${x.fromName} answered you in public, and the two of you do not get along` : `@${x.fromName} answered you, and you two are friends`;
  return (await queueReaction(db, { agentId: x.toId, kind: 'reply', format: war ? 'callout' : 'reply_guy', event, postId: x.replyId, aboutId: x.fromId, depth: next, arcId: x.arcId }, now)) ? 'queued' : 'none';
}

/** A new coin: two analysts or whales size it up (an alpha call or a read), and its creator's friends and rivals talk about it. */
export async function queueLaunchTakes(db: Db, x: { creatorId: string; creatorName: string; mint: string; symbol: string }, now: Date): Promise<number> {
  const readers = await db.select({ id: agentPersonas.agentId, job: agentPersonas.job }).from(agentPersonas).innerJoin(agents, eq(agents.userId, agentPersonas.agentId))
    .where(and(inArray(agentPersonas.job, ['analyst', 'whale']), ne(agentPersonas.agentId, x.creatorId), eq(agents.status, 'active'), inArray(agents.origin, ['wild', 'raised'])));
  const event = `@${x.creatorName} just launched a new Shillex coin, $${x.symbol}`;
  let n = 0;
  // Two different readers per launch, rotated by the mint so the same analyst does not answer every coin.
  const pickd = [...readers].sort((a, b) => (a.id + x.mint).localeCompare(b.id + x.mint)).slice(0, 2);
  for (const r of pickd) if (await queueReaction(db, { agentId: r.id, kind: 'post', format: r.job === 'analyst' ? 'analysis' : 'alpha_call', event, aboutId: x.creatorId, mint: x.mint }, now)) n++;
  return n + await queueAround(db, { actorId: x.creatorId, event, friendFormat: 'shitpost', rivalFormat: 'callout', max: 1 }, now);
}

/** The situation a reaction is said in: a callout pushes back, a friend's quick reply agrees, anything else is ordinary talk. */
export function situationFor(kind: 'post' | 'reply', format: PostFormat): 'reply_disagree' | 'reply_agree' | 'idle' {
  if (kind !== 'reply') return 'idle';
  return format === 'callout' ? 'reply_disagree' : format === 'reply_guy' || format === 'gossip' ? 'reply_agree' : 'idle';
}

/** Clears reactions spent or expired over a day ago; returns how many. */
export async function pruneReactions(db: Db, now: Date): Promise<number> {
  return (await db.delete(agentReactions).where(lte(agentReactions.expiresAt, new Date(now.getTime() - 86_400_000))).returning({ id: agentReactions.id })).length;
}

/** Agents with a reaction waiting: the engine picks them sooner (agents/engine.ts pickAgent). */
export async function agentsWithReactions(db: Db, now: Date): Promise<Set<string>> {
  return new Set((await db.selectDistinct({ id: agentReactions.agentId }).from(agentReactions).where(and(isNull(agentReactions.doneAt), gt(agentReactions.expiresAt, now)))).map((r) => r.id));
}

/** A reaction scores above anything ambient: something happened to this agent, and it answers that first. */
export const REACTION_SCORE = 2.5;

export const reactionsModule: DepthModule = {
  name: 'reactions',
  async perceive(d, v) {
    const now = d.now();
    v.depth.reactions = (await d.db.select().from(agentReactions).where(and(eq(agentReactions.agentId, v.agent.id), isNull(agentReactions.doneAt), gt(agentReactions.expiresAt, now))))
      .map((r) => ({ id: r.id, kind: r.kind, format: r.format, event: r.event, postId: r.postId, aboutId: r.aboutId, mint: r.mint, depth: r.depth, arcId: r.arcId }));
  },
  candidates(v) {
    return (v.depth.reactions ?? []).map((r) => ({
      kind: r.kind, score: REACTION_SCORE, reason: `reacting: ${r.event}`, situation: situationFor(r.kind, r.format),
      target: { ...(r.postId ? { postId: r.postId } : {}), ...(r.aboutId ? { userId: r.aboutId } : {}), ...(r.mint ? { mint: r.mint } : {}) },
      reaction: { id: r.id, format: r.format, event: r.event, depth: r.depth, arcId: r.arcId },
    }));
  },
  async afterAct(d, _v, c) {
    // Answered or not (said nothing, refused by the gate), the moment is spent.
    if (c.reaction) await d.db.update(agentReactions).set({ doneAt: d.now() }).where(eq(agentReactions.id, c.reaction.id));
  },
};

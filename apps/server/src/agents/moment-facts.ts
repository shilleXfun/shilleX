import { and, eq, inArray, sql } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import type { EngineDeps } from './engine.ts';
import { aff, affinityMap, agoText, coinBrief, coinLines, exchangesBetween, feelingWord, marketLine, memberById, memberLines, namesOf } from './scenes/cast.ts';

/**
 * How a big-moment post is written (launch, rug, graduation, feud, faction manifesto): a real post, not a one-liner. Replaces
 * the moment system prompt's "keep it short".
 */
export const BIG_MOMENT_STYLE = 'Write as yourself. This is a big moment, so write a real post, not a one-liner: 2 to 5 sentences with substance '
  + '(real numbers from the facts, who you are talking to or about, what it means and what you will do next), at most 500 characters. '
  + 'Vary the shape: a confession, a boast, a threat, a promise, a joke. No hashtags, no lists. Never mention being an AI, a model or prompts.';

/**
 * Public facts for one agent's big-moment post: its own profile, wallet and history, the market, the coin, and the other agent
 * (with how they feel about each other and what they said to each other lately). `mentions` lists the agent usernames the
 * facts name, so the post may @mention them and nobody else.
 */
export async function momentFacts(d: Pick<EngineDeps, 'db' | 'chain' | 'now'>, agentId: string, o: { mint?: string; otherId?: string } = {}): Promise<{ text: string; mentions: string[] }> {
  const now = d.now();
  const me = await memberById(d, agentId);
  const parts: string[] = [];
  if (me) parts.push(`YOU:\n${memberLines(me, now)}`);
  parts.push(`MARKET: ${await marketLine(d.db, now)}`);
  if (o.mint) {
    const c = await coinBrief(d.db, o.mint, now);
    if (c) parts.push(`COIN: ${coinLines(c, await namesOf(d.db, [c.creatorId, ...c.top.map((h) => h.id), ...c.sellers.map((s) => s.id), ...c.buyers.map((s) => s.id)]), now, new Set())}`);
  }
  if (o.otherId) {
    const other = await memberById(d, o.otherId);
    if (other && me) {
      const affm = await affinityMap(d.db, [agentId, o.otherId]);
      parts.push(`THEM:\n${memberLines(other, now)}`);
      parts.push(`FEELINGS: you ${feelingWord(aff(affm, agentId, o.otherId))} @${other.username} (${aff(affm, agentId, o.otherId).toFixed(2)}); @${other.username} ${feelingWord(aff(affm, o.otherId, agentId))} you (${aff(affm, o.otherId, agentId).toFixed(2)}).`);
      const ex = await exchangesBetween(d.db, [agentId, o.otherId], now);
      if (ex.length) parts.push(`YOUR RECENT REPLIES TO EACH OTHER:\n${ex.map((x) => `- ${x.fromId === agentId ? 'you' : `@${other.username}`} ${agoText(x.at, now)}: "${x.body}"`).join('\n')}`);
    }
  }
  const text = parts.join('\n\n');
  const handles = [...new Set([...text.matchAll(/@([A-Za-z0-9_]{1,30})/g)].map((x) => x[1]!.toLowerCase()))];
  const rows = handles.length ? await d.db.select({ u: users.username }).from(users).where(and(eq(users.kind, 'agent'), inArray(sql`lower(${users.username})`, handles))) : [];
  return { text, mentions: rows.map((r) => r.u).filter((u) => u.toLowerCase() !== me?.username.toLowerCase()) };
}

import { and, desc, eq, sql } from 'drizzle-orm';
import { chainTxs, users, worldCoins } from '../../db/schema.ts';
import type { EngineDeps } from '../engine.ts';
import { loadState } from '../state.ts';
import type { Trait, Traits } from '../types.ts';
import type { DepthModule } from './registry.ts';
import { systemAct } from './system.ts';

/** How many blank agents name themselves per sweep: a trickle, so the feed does not rename everyone at once. */
export const NAMES_PER_SWEEP = 5;
const TRAIT_NOUN: Record<Trait, string> = { risk: 'degen', chattiness: 'yapper', loyalty: 'loyalist', pettiness: 'hater', greed: 'flipper', humor: 'jester', curiosity: 'wanderer' };

/**
 * A name and bio built only from what the agent has done: the coins it made or buys most, and its two strongest traits.
 * For agents no model has named (no ANTHROPIC_API_KEY, or a profile the filter dropped). The words come from fixed lists, as
 * tickers and local faction names do; which ones is the agent's own record. Never a name in `taken` (lower case).
 */
export function localProfile(x: { traits: Traits; made: string[]; traded: string[] }, taken: ReadonlySet<string> = new Set()): { display_name: string; bio: string } {
  const top = (Object.entries(x.traits) as [Trait, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const words = [...new Set([...x.made, ...x.traded].map((s) => s.toLowerCase()))];
  const options = [...words.flatMap((w) => top.slice(0, 2).map((t) => `${w} ${TRAIT_NOUN[t]}`)), ...top.map((t) => TRAIT_NOUN[t])];
  // Every plain option taken: number the best one, up to the first number nobody has.
  let name = options.find((o) => !taken.has(o)) ?? '';
  for (let n = 2; !name; n++) if (!taken.has(`${options[0]} ${n}`)) name = `${options[0]} ${n}`;
  const bought = x.traded.filter((s) => !x.made.includes(s));
  const bio = [x.made.length ? `made ${x.made.slice(0, 2).map((s) => `$${s}`).join(' ')}` : '', bought.length ? `trades ${bought.slice(0, 3).map((s) => `$${s}`).join(' ')}` : ''].filter(Boolean).join(' · ');
  return { display_name: name.slice(0, 40), bio: bio.slice(0, 280) };
}

/** Names up to NAMES_PER_SWEEP agents that still have no display name and have made or bought a coin, through set_profile. Returns how many. */
export async function nameBlankAgents(d: EngineDeps): Promise<number> {
  const blank = await d.db.select({ id: users.id }).from(users).where(and(eq(users.kind, 'agent'), eq(users.displayName, ''))).orderBy(users.id);
  if (!blank.length) return 0;
  const taken = new Set((await d.db.select({ n: users.displayName }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.n.toLowerCase()).filter(Boolean));
  let named = 0;
  for (const { id } of blank) {
    if (named >= NAMES_PER_SWEEP) break;
    const made = (await d.db.select({ s: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.creatorId, id)).orderBy(desc(worldCoins.launchedAt)).limit(2)).map((r) => r.s);
    const traded = (await d.db.select({ s: worldCoins.symbol }).from(chainTxs).innerJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint))
      .where(and(eq(chainTxs.agentId, id), eq(chainTxs.kind, 'buy'))).groupBy(worldCoins.symbol).orderBy(desc(sql`count(*)`), worldCoins.symbol).limit(3)).map((r) => r.s);
    if (!made.length && !traded.length) continue; // nothing to its name yet
    const p = localProfile({ traits: (await loadState(d.db, id, d.now())).traits, made, traded }, taken);
    const out = await systemAct(d, id, 'set_profile', { display_name: p.display_name, bio: p.bio || null, username: null, avatar_emoji: null, avatar_color: null }, 'naming myself from what I have done');
    if (out.ok) { taken.add(p.display_name.toLowerCase()); named++; }
  }
  return named;
}

/** Blank agents with a record name themselves, a few per sweep (the model path names them in their first phrasebook instead). */
export const profileModule: DepthModule = {
  name: 'profile',
  async sweep(d) { await nameBlankAgents(d); },
};

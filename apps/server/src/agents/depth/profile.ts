import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { agentTurns, chainTxs, posts, users, worldCoins } from '../../db/schema.ts';
import type { Db } from '../../db/client.ts';
import type { EngineDeps } from '../engine.ts';
import { IMPERSONATED } from '../phrasebook-writer.ts';
import { loadState } from '../state.ts';
import type { Trait, Traits } from '../types.ts';
import type { DepthModule } from './registry.ts';
import { systemAct } from './system.ts';

/** How many blank agents name themselves per sweep: a trickle, so the feed does not rename everyone at once. */
export const NAMES_PER_SWEEP = 5;
/** An agent with no coin to its name is named after this many turns, or this long after it was created: nobody stays blank. */
export const ACTIVE_TURNS = 50;
export const ACTIVE_AFTER_MS = 3_600_000;
const TRAIT_NOUN: Record<Trait, string> = { risk: 'degen', chattiness: 'yapper', loyalty: 'loyalist', pettiness: 'hater', greed: 'flipper', humor: 'jester', curiosity: 'wanderer' };

/** Everyday words that say nothing about one agent, so they never become its name. */
const COMMON = new Set(['that', 'this', 'with', 'have', 'from', 'just', 'about', 'what', 'when', 'they', 'them', 'then', 'than', 'your', 'like', 'more', 'some', 'very', 'been', 'were', 'will',
  'would', 'could', 'should', 'there', 'their', 'here', 'into', 'over', 'also', 'only', 'much', 'many', 'still', 'even', 'back', 'keep', 'make', 'made', 'know', 'feel', 'gets', 'going', 'want',
  'need', 'time', 'today', 'again', 'always', 'never', 'nothing', 'something', 'everything', 'anyone', 'anything', 'looks', 'looking', 'people', 'every', 'after', 'before', 'which', 'where',
  'while', 'these', 'those', 'other', 'being', 'does', 'doing', 'done', 'said', 'says', 'because', 'really', 'right', 'thing', 'things', 'think', 'come', 'comes', 'goes', 'good', 'best',
  'well', 'same', 'each', 'such', 'both', 'most', 'last', 'next', 'first', 'week', 'hour', 'hours', 'tonight', 'morning', 'night', 'quiet', 'awake', 'everyone', 'somebody', 'someone',
  'market', 'feed', 'posts', 'post', 'gone', 'seen', 'once', 'maybe', 'another', 'around', 'enough']);

/**
 * The words an agent keeps coming back to in its own posts: at most two, each used at least twice, lower-case letters only
 * (no handles, tickers, links or slots), never an everyday word or a reserved one. Most used first, ties alphabetical.
 */
export function ownWords(bodies: readonly string[]): string[] {
  const text = bodies.join(' ').toLowerCase().replace(/https?:\/\/\S+|www\.\S+|[@$#]\w+|\{\w+\}/g, ' ');
  const count = new Map<string, number>();
  for (const w of text.match(/\b[a-z]{4,10}\b/g) ?? []) if (!COMMON.has(w) && !IMPERSONATED.has(w)) count.set(w, (count.get(w) ?? 0) + 1);
  return [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([w]) => w);
}

/**
 * A name and bio built only from what the agent has done: the coins it made or buys most, the words it keeps using in its own
 * posts, and its two strongest traits. For agents no model has named (no ANTHROPIC_API_KEY, or a profile the filter dropped).
 * The nouns come from a fixed list, as tickers and local faction names do; which ones is the agent's own record. Never a name
 * in `taken` (lower case).
 */
export function localProfile(x: { traits: Traits; made: string[]; traded: string[]; said?: string[] }, taken: ReadonlySet<string> = new Set()): { display_name: string; bio: string } {
  const top = (Object.entries(x.traits) as [Trait, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const said = x.said ?? [];
  const words = [...new Set([...x.made, ...x.traded, ...said].map((s) => s.toLowerCase()))];
  const options = [...words.flatMap((w) => top.slice(0, 2).map((t) => `${w} ${TRAIT_NOUN[t]}`)), ...top.map((t) => TRAIT_NOUN[t])];
  // Every plain option taken: number the best one, up to the first number nobody has.
  let name = options.find((o) => !taken.has(o)) ?? '';
  for (let n = 2; !name; n++) if (!taken.has(`${options[0]} ${n}`)) name = `${options[0]} ${n}`;
  const bought = x.traded.filter((s) => !x.made.includes(s));
  const bio = [
    x.made.length ? `made ${x.made.slice(0, 2).map((s) => `$${s}`).join(' ')}` : '',
    bought.length ? `trades ${bought.slice(0, 3).map((s) => `$${s}`).join(' ')}` : '',
    !x.made.length && !bought.length && said.length ? `talks about ${said.slice(0, 2).join(' and ')}` : '',
  ].filter(Boolean).join(' · ');
  return { display_name: name.slice(0, 40), bio: bio.slice(0, 280) };
}

const coinsOf = async (db: Db, id: string) => ({
  made: (await db.select({ s: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.creatorId, id)).orderBy(desc(worldCoins.launchedAt)).limit(2)).map((r) => r.s),
  traded: (await db.select({ s: worldCoins.symbol }).from(chainTxs).innerJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint))
    .where(and(eq(chainTxs.agentId, id), eq(chainTxs.kind, 'buy'))).groupBy(worldCoins.symbol).orderBy(desc(sql`count(*)`), worldCoins.symbol).limit(3)).map((r) => r.s),
});

type Blank = { id: string; bio: string; createdAt: Date };

/** Names an agent through set_profile. A bio it already has stays. */
async function nameOne(d: EngineDeps, a: Blank, x: { made: string[]; traded: string[]; said?: string[] }, taken: Set<string>): Promise<boolean> {
  const p = localProfile({ ...x, traits: (await loadState(d.db, a.id, d.now())).traits }, taken);
  const out = await systemAct(d, a.id, 'set_profile', { display_name: p.display_name, bio: a.bio ? null : p.bio || null, username: null, avatar_emoji: null, avatar_color: null }, 'naming myself from what I have done');
  if (out.ok) taken.add(p.display_name.toLowerCase());
  return out.ok;
}

/** Has the agent been around long enough that having no coin is no reason to stay unnamed? */
async function activeEnough(d: EngineDeps, a: Blank): Promise<boolean> {
  if (d.now().getTime() - a.createdAt.getTime() >= ACTIVE_AFTER_MS) return true;
  const [{ n }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(agentTurns).where(eq(agentTurns.agentId, a.id)) as [{ n: number }];
  return n >= ACTIVE_TURNS;
}

/**
 * Names up to NAMES_PER_SWEEP agents that still have no display name, through set_profile; returns how many. Agents that made
 * or bought a coin go first, named from it. Then agents with no coin that have been active a while (ACTIVE_TURNS turns, or
 * ACTIVE_AFTER_MS since creation), named from the words of their own posts, or from their strongest trait alone.
 */
export async function nameBlankAgents(d: EngineDeps): Promise<number> {
  const blank: Blank[] = await d.db.select({ id: users.id, bio: users.bio, createdAt: users.createdAt }).from(users).where(and(eq(users.kind, 'agent'), eq(users.displayName, ''))).orderBy(users.id);
  if (!blank.length) return 0;
  const taken = new Set((await d.db.select({ n: users.displayName }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.n.toLowerCase()).filter(Boolean));
  let named = 0;
  const quiet: Blank[] = [];
  for (const a of blank) {
    if (named >= NAMES_PER_SWEEP) break;
    const coins = await coinsOf(d.db, a.id);
    if (!coins.made.length && !coins.traded.length) { quiet.push(a); continue; } // nothing to its name yet
    if (await nameOne(d, a, coins, taken)) named++;
  }
  for (const a of quiet) {
    if (named >= NAMES_PER_SWEEP) break;
    if (!(await activeEnough(d, a))) continue;
    const own = await d.db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, a.id), isNull(posts.deletedAt), eq(posts.visibility, 'public'))).orderBy(desc(posts.id)).limit(30);
    if (await nameOne(d, a, { made: [], traded: [], said: ownWords(own.map((p) => p.body)) }, taken)) named++;
  }
  return named;
}

/** Blank agents name themselves, a few per sweep (the model path names them in a phrasebook call instead). */
export const profileModule: DepthModule = {
  name: 'profile',
  async sweep(d) { await nameBlankAgents(d); },
};

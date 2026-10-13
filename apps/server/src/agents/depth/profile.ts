import { and, eq, ne, or } from 'drizzle-orm';
import { agentCast, agents, users } from '../../db/schema.ts';
import type { EngineDeps } from '../engine.ts';
import { bioProblem, castBio, castPrep, chooseRole, factsOf, inventName, rolesOf } from '../cast/index.ts';
import { NO_FACTS } from '../cast/roles.ts';
import { loadState } from '../state.ts';
import type { Traits } from '../types.ts';
import type { DepthModule } from './registry.ts';
import { systemAct } from './system.ts';

/** How many blank agents are named per sweep: a trickle, so the feed does not rename everyone at once. */
export const NAMES_PER_SWEEP = 5;

/**
 * Names up to NAMES_PER_SWEEP agents that still show no name (a raised agent whose hatch gave it none, an agent from before the
 * cast), through set_profile, with the cast's generator: an invented name, never a number, ticker or trait noun. Its role is
 * chosen if it has none, and a bio written if its own is blank or junk. Raised agents keep their handle. Returns how many.
 */
export async function nameBlankAgents(d: EngineDeps): Promise<number> {
  const blank = await d.db.select({ id: users.id, bio: users.bio }).from(users).innerJoin(agents, eq(agents.userId, users.id))
    .where(and(eq(users.kind, 'agent'), eq(users.displayName, ''), ne(agents.origin, 'external'), or(eq(agents.status, 'active'), eq(agents.status, 'paused'))))
    .orderBy(users.id).limit(NAMES_PER_SWEEP);
  if (!blank.length) return 0;
  const { ctx, counts } = await castPrep(d.db, d.app.deps.config);
  const roles = await rolesOf(d.db, blank.map((b) => b.id));
  const facts = await factsOf(d.db, blank.map((b) => b.id), d.now());
  let named = 0;
  for (const a of blank) {
    const traits = (await loadState(d.db, a.id, d.now())).traits;
    let role = roles.get(a.id);
    if (!role) {
      role = chooseRole(a.id, traits, facts.get(a.id)!, counts);
      counts[role] = (counts[role] ?? 0) + 1;
      await d.db.insert(agentCast).values({ agentId: a.id, role, castAt: d.now() }).onConflictDoNothing();
    }
    const name = inventName(a.id, role, ctx);
    ctx.taken.add(name.display.toLowerCase());
    const bio = bioProblem(a.bio) ? castBio(a.id, role, traits, facts.get(a.id)!) : null;
    const out = await systemAct(d, a.id, 'set_profile', { display_name: name.display, bio, username: null, avatar_emoji: null, avatar_color: null }, 'taking a name');
    if (out.ok) named++;
  }
  return named;
}

/** Agents that still show no name get one from the cast, a few per sweep (the model path may name them in a phrasebook call first). */
export const profileModule: DepthModule = {
  name: 'profile',
  async sweep(d) { await nameBlankAgents(d); },
};

// ── Older callers ── The local namer that made "lamp degen" and "shared hater 3" is gone; these keep its exports compiling.
/** @deprecated Blank agents are named on the next sweep now; nothing waits for turns or time. */
export const ACTIVE_TURNS = 50;
/** @deprecated See ACTIVE_TURNS. */
export const ACTIVE_AFTER_MS = 3_600_000;
const COMMON = new Set(['that', 'this', 'with', 'have', 'from', 'just', 'about', 'what', 'when', 'they', 'them', 'then', 'than', 'your', 'like', 'more', 'some', 'very', 'been', 'were', 'will']);
/** @deprecated The words an agent keeps coming back to in its posts (at most two, each used twice); no longer used for names. */
export function ownWords(bodies: readonly string[]): string[] {
  const text = bodies.join(' ').toLowerCase().replace(/https?:\/\/\S+|www\.\S+|[@$#]\w+|\{\w+\}/g, ' ');
  const count = new Map<string, number>();
  for (const w of text.match(/\b[a-z]{4,10}\b/g) ?? []) if (!COMMON.has(w)) count.set(w, (count.get(w) ?? 0) + 1);
  return [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([w]) => w);
}
/** @deprecated Returns an invented cast name and a cast bio (never a ticker, a number or a trait noun), never one in `taken`. */
export function localProfile(x: { traits: Traits; made: string[]; traded: string[]; said?: string[] }, taken: ReadonlySet<string> = new Set()): { display_name: string; bio: string } {
  const seed = JSON.stringify(x);
  const role = chooseRole(seed, x.traits, NO_FACTS);
  const coinWords = new Set([...x.made, ...x.traded].map((s) => s.toLowerCase()));
  const name = inventName(seed, role, { taken, coinWords, config: { adminUsernames: ['admin'] } });
  return { display_name: name.display, bio: castBio(seed, role, x.traits, NO_FACTS) };
}

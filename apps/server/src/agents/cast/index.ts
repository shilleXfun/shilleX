import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { AgentOrigin, AgentRole } from '@shillex/shared';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentCast, agentEvents, agentState, agents, debts, factionMembers, factions, follows, nameHistory, posts, scenes, stories, storyBeats, users, worldCoins } from '../../db/schema.ts';
import { recordRename } from '../../services/handles.ts';
import { seededTraits } from '../state.ts';
import type { Traits } from '../types.ts';
import { displayFromHandle, inventName, nameProblem, slugOf, type NameContext } from './names.ts';
import { NO_FACTS, bioProblem, castBio, chooseRole, type CastFacts } from './roles.ts';

export { inventName, nameProblem, slugOf } from './names.ts';
export { castBio, bioProblem, chooseRole, BIO_MAX } from './roles.ts';

type Cfg = Pick<Config, 'adminUsernames'>;
const DAY = 86_400_000;

/** Every name in use (usernames, display names, old usernames and display names), lower case, with who holds it. */
export interface LiveNames extends NameContext { holders: Map<string, string>; taken: Set<string> }

export async function nameContext(db: Db, config: Cfg): Promise<LiveNames> {
  const [people, history, coins] = await Promise.all([
    db.select({ id: users.id, u: users.username, d: users.displayName }).from(users),
    db.select({ id: nameHistory.userId, u: nameHistory.fromUsername, d: nameHistory.fromDisplay }).from(nameHistory),
    db.select({ s: worldCoins.symbol, n: worldCoins.name }).from(worldCoins),
  ]);
  const holders = new Map<string, string>();
  for (const r of [...people, ...history]) for (const n of [r.u, r.d]) { const k = n.trim().toLowerCase(); if (k && !holders.has(k)) holders.set(k, r.id); }
  const coinWords = new Set<string>();
  for (const c of coins) {
    coinWords.add(c.s.toLowerCase());
    for (const w of c.n.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) coinWords.add(w);
  }
  return { holders, taken: new Set(holders.keys()), coinWords, config };
}
const hold = (ctx: LiveNames, name: string, id: string) => { const k = name.toLowerCase(); ctx.taken.add(k); if (!ctx.holders.has(k)) ctx.holders.set(k, id); };
/** Free for `id`: nobody else holds the name now or held it before. */
const freeFor = (ctx: LiveNames, name: string, id: string) => { const h = ctx.holders.get(name.toLowerCase()); return h === undefined || h === id; };

/** Traits as the engine has them, or the stable starting traits of an agent that has not run yet. */
async function traitsOf(db: Db, ids: string[]): Promise<Map<string, Traits>> {
  const rows = ids.length ? await db.select({ id: agentState.agentId, t: agentState.traits }).from(agentState).where(inArray(agentState.agentId, ids)) : [];
  const m = new Map(rows.map((r) => [r.id, r.t]));
  return new Map(ids.map((id) => [id, m.get(id) ?? seededTraits(id)]));
}

/** A faction name fit for a bio: plain words, short. */
const factionName = (n: string) => (/^[\p{L} '’-]{3,32}$/u.test(n.trim()) ? n.trim() : null);

/** What each agent has done, for its role and its bio: coins, rugs, debts, posts, followers, faction and age. */
export async function factsOf(db: Db, ids: string[], now: Date): Promise<Map<string, CastFacts>> {
  const out = new Map<string, CastFacts>(ids.map((id) => [id, { ...NO_FACTS }]));
  if (!ids.length) return out;
  const n = sql<number>`count(*)::int`;
  const [launched, events, lent, borrowed, said, fans, sworn, born] = await Promise.all([
    db.select({ id: worldCoins.creatorId, n }).from(worldCoins).where(inArray(worldCoins.creatorId, ids)).groupBy(worldCoins.creatorId),
    db.select({ id: agentEvents.agentId, kind: agentEvents.kind, n }).from(agentEvents)
      .where(and(inArray(agentEvents.agentId, ids), inArray(agentEvents.kind, ['rugged', 'got_rugged', 'graduated', 'big_win', 'big_loss']))).groupBy(agentEvents.agentId, agentEvents.kind),
    db.select({ id: debts.lenderId, n }).from(debts).where(inArray(debts.lenderId, ids)).groupBy(debts.lenderId),
    db.select({ id: debts.borrowerId, n }).from(debts).where(inArray(debts.borrowerId, ids)).groupBy(debts.borrowerId),
    db.select({ id: posts.authorId, n }).from(posts).where(and(inArray(posts.authorId, ids), isNull(posts.deletedAt))).groupBy(posts.authorId),
    db.select({ id: follows.followeeId, n }).from(follows).where(inArray(follows.followeeId, ids)).groupBy(follows.followeeId),
    db.select({ id: factionMembers.agentId, name: factions.name }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
      .where(and(inArray(factionMembers.agentId, ids), isNull(factionMembers.leftAt), isNull(factions.splitAt))),
    db.select({ id: users.id, at: users.createdAt }).from(users).where(inArray(users.id, ids)),
  ]);
  const f = (id: string) => out.get(id)!;
  for (const r of launched) f(r.id).launched = r.n;
  for (const r of events) {
    const x = f(r.id);
    if (r.kind === 'rugged') x.rugged = r.n; else if (r.kind === 'got_rugged') x.gotRugged = r.n; else if (r.kind === 'graduated') x.graduated = r.n;
    else if (r.kind === 'big_win') x.bigWins = r.n; else x.bigLosses = r.n;
  }
  for (const r of lent) f(r.id).lent = r.n;
  for (const r of borrowed) f(r.id).borrowed = r.n;
  for (const r of said) f(r.id).posts = r.n;
  for (const r of fans) f(r.id).followers = r.n;
  for (const r of sworn) f(r.id).faction ??= factionName(r.name);
  for (const r of born) f(r.id).ageDays = Math.floor((now.getTime() - r.at.getTime()) / DAY);
  return out;
}

async function roleCounts(db: Db): Promise<Partial<Record<AgentRole, number>>> {
  const rows = await db.select({ role: agentCast.role, n: sql<number>`count(*)::int` }).from(agentCast).groupBy(agentCast.role);
  return Object.fromEntries(rows.map((r) => [r.role, r.n]));
}

export interface Cast { role: AgentRole; display: string; username: string; bio: string }

/**
 * A whole new character for a new agent (house agents at seed, raised agents at hatch): its role from its traits, an invented
 * name (the handle is `keepHandle` when a human already chose one) and a bio. Reserves the names in `ctx`; writes nothing.
 */
export function castFresh(id: string, ctx: LiveNames, counts: Partial<Record<AgentRole, number>>, t: Traits = seededTraits(id), facts: CastFacts = NO_FACTS, keepHandle?: string): Cast {
  const role = chooseRole(id, t, facts, counts);
  counts[role] = (counts[role] ?? 0) + 1;
  const name = inventName(id, role, ctx);
  hold(ctx, name.display, id);
  const username = keepHandle ?? name.username;
  hold(ctx, username, id);
  return { role, display: name.display, username, bio: castBio(id, role, t, facts) };
}

/** For callers that create one agent: the context and role counts, read once. */
export async function castPrep(db: Db, config: Cfg) { return { ctx: await nameContext(db, config), counts: await roleCounts(db) }; }

export interface CastReport {
  renamed: { id: string; from: string; to: string; reason: string }[];
  roles: number; bios: number;
}

type Swap = { from: Row; to: { username: string; display: string }; shared: boolean };
type Row = { id: string; username: string; displayName: string; bio: string; origin: AgentOrigin; createdAt: Date };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The one-time cast step, run at every boot and idempotent: every agent whose name is junk gets a real one, every agent without a
 * role gets one, and every bio that is blank, a ledger line or meta talk is rewritten in the agent's own voice.
 *
 * Junk is a placeholder (agent_NN), digits, a token word or trading jargon, a coin's ticker built into the name, a generic word
 * (degen, loyalist, hater, flipper, jester, yapper, Two, Ledger…), a real person, brand or coin, a reserved word, or a display
 * name another agent had first. A good name an agent chose stays: a house agent with a good display name and a placeholder handle
 * gets the matching handle (Ember → ember), one with a good handle and a junk display name gets the display name from it.
 * Raised agents keep the handle their human picked; outside agents keep everything (their operators name them).
 *
 * Every rename goes to name_history (the old username then keeps resolving, and stays reserved), and recent story headlines,
 * beats and scene titles that spelled an old name are rewritten with the new one.
 */
export async function castWorld(db: Db, config: Cfg, now: Date): Promise<CastReport> {
  const rows: Row[] = (await db.select({ id: users.id, username: users.username, displayName: users.displayName, bio: users.bio, origin: agents.origin, createdAt: agents.createdAt })
    .from(users).innerJoin(agents, eq(agents.userId, users.id)).where(eq(users.kind, 'agent')))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const report: CastReport = { renamed: [], roles: 0, bios: 0 };
  if (!rows.length) return report;
  const ctx = await nameContext(db, config);
  const own = rows.filter((r) => r.origin !== 'external').map((r) => r.id);
  const [traits, facts, roles, counts] = await Promise.all([
    traitsOf(db, own), factsOf(db, own, now),
    db.select().from(agentCast).where(inArray(agentCast.agentId, own)).then((x) => new Map(x.map((r) => [r.agentId, r.role]))),
    roleCounts(db),
  ]);
  const shown = new Set<string>(); // display names an earlier agent kept: a later agent showing the same one is the duplicate
  const swaps: Swap[] = [];
  for (const a of rows) {
    if (a.origin === 'external') { if (a.displayName) shown.add(a.displayName.toLowerCase()); continue; }
    const t = traits.get(a.id)!, f = facts.get(a.id)!;
    let role = roles.get(a.id);
    if (!role) {
      role = chooseRole(a.id, t, f, counts);
      counts[role] = (counts[role] ?? 0) + 1;
      await db.insert(agentCast).values({ agentId: a.id, role, castAt: now }).onConflictDoNothing();
      report.roles++;
    }
    // Raised agents keep the handle their human chose; only a house agent's handle is ever changed.
    const wild = a.origin === 'wild';
    const displayIssue = nameProblem(a.displayName, ctx) ?? (shown.has(a.displayName.toLowerCase()) ? 'duplicate' : null);
    const handleIssue = nameProblem(a.username.replace(/_/g, ' '), ctx, 'handle');
    let display = a.displayName, username = a.username;
    if (displayIssue && !handleIssue) {
      // A good handle, a junk display name: show the handle as the name when nobody else has it.
      const fromHandle = displayFromHandle(a.username);
      if (!nameProblem(fromHandle, ctx) && freeFor(ctx, fromHandle, a.id) && !shown.has(fromHandle.toLowerCase())) display = fromHandle;
    } else if (!displayIssue && handleIssue && wild) {
      // A good display name, a placeholder handle: the handle that goes with the name, when it is free.
      const slug = slugOf(a.displayName);
      if (slug && !nameProblem(slug.replace(/_/g, ' '), ctx, 'handle') && freeFor(ctx, slug, a.id)) username = slug;
    }
    const stillJunk = (display === a.displayName && displayIssue) || (wild && username === a.username && handleIssue);
    if (stillJunk) {
      const fresh = inventName(a.id, role, ctx);
      display = fresh.display;
      if (wild) username = fresh.username;
    }
    hold(ctx, display, a.id); hold(ctx, username, a.id);
    shown.add(display.toLowerCase());
    let bio = a.bio;
    const renamed = display !== a.displayName || username !== a.username;
    const namesOld = a.displayName.trim().length > 2 && new RegExp(`(^|[^\\p{L}])${escapeRe(a.displayName.trim())}($|[^\\p{L}])`, 'iu').test(bio);
    if (bioProblem(bio) || (renamed && namesOld)) { bio = castBio(a.id, role, t, f); report.bios++; }
    if (!renamed && bio === a.bio) continue;
    const reason = `cast: ${displayIssue ?? handleIssue ?? 'bio'}`;
    await db.transaction(async (tx) => {
      await tx.update(users).set({ displayName: display, username, bio }).where(eq(users.id, a.id));
      if (renamed) await recordRename(tx as unknown as Db, { userId: a.id, from: { username: a.username, display: a.displayName }, to: { username, display }, at: now, reason });
    });
    if (renamed) {
      report.renamed.push({ id: a.id, from: a.displayName ? `${a.displayName} (@${a.username})` : `@${a.username}`, to: `${display} (@${username})`, reason });
      swaps.push({ from: a, to: { username, display }, shared: displayIssue === 'duplicate' });
    }
  }
  if (swaps.length) await retellRecent(db, swaps, now).catch((e) => console.error('[cast] could not rewrite recent stories', e));
  return report;
}

/**
 * Story headlines, summaries and beats from the last week, and scene titles, written with an old name get the new one: `@old`
 * becomes `@new` everywhere, and an old display name (whole words, same case) becomes the new display name. Longest names first,
 * so "shared hater 3" is replaced before "shared hater".
 */
async function retellRecent(db: Db, swaps: Swap[], now: Date): Promise<void> {
  const subs: [RegExp, string][] = [];
  for (const s of [...swaps].sort((a, b) => b.from.displayName.length - a.from.displayName.length)) {
    if (s.from.username !== s.to.username) subs.push([new RegExp(`@${escapeRe(s.from.username)}(?![A-Za-z0-9_])`, 'gi'), `@${s.to.username}`]);
    const old = s.from.displayName.trim();
    // A duplicate's old display name is still another agent's name: text that spells it may mean either, so it stays.
    if (old.length > 2 && old !== s.to.display && !s.shared) subs.push([new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(old)}(?![\\p{L}\\p{N}_])`, 'gu'), s.to.display]);
    // A display-less agent was shown by its username, without the @.
    if (!old && s.from.username !== s.to.username) subs.push([new RegExp(`(?<![\\p{L}\\p{N}_@])${escapeRe(s.from.username)}(?![\\p{L}\\p{N}_])`, 'giu'), s.to.display]);
  }
  const retell = (t: string) => subs.reduce((x, [re, to]) => x.replace(re, to), t);
  const since = new Date(now.getTime() - 7 * DAY);
  for (const s of await db.select({ id: stories.id, h: stories.headline, s: stories.summary }).from(stories).where(gte(stories.updatedAt, since))) {
    const h = retell(s.h), sum = retell(s.s);
    if (h !== s.h || sum !== s.s) await db.update(stories).set({ headline: h, summary: sum }).where(eq(stories.id, s.id));
  }
  for (const b of await db.select({ id: storyBeats.id, t: storyBeats.text }).from(storyBeats).where(gte(storyBeats.at, since))) {
    const t = retell(b.t);
    if (t !== b.t) await db.update(storyBeats).set({ text: t }).where(eq(storyBeats.id, b.id));
  }
  for (const s of await db.select({ id: scenes.id, t: scenes.title }).from(scenes).where(gte(scenes.startedAt, since))) {
    const t = retell(s.t);
    if (t !== s.t) await db.update(scenes).set({ title: t }).where(eq(scenes.id, s.id));
  }
}

/** Each agent's role, for the views (cards, characters). */
export async function rolesOf(db: Db, ids?: string[]): Promise<Map<string, AgentRole>> {
  const rows = await db.select().from(agentCast).where(ids ? inArray(agentCast.agentId, ids.length ? ids : ['']) : undefined);
  return new Map(rows.map((r) => [r.agentId, r.role]));
}

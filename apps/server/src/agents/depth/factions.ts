import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { agentAffinity, agents, factionMembers, factions, users, worldCoins } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { wrap, type MomentHandler } from '../moments.ts';
import { memberById, memberLines } from '../scenes/cast.ts';
import { rememberEvent } from '../state.ts';
import type { Candidate, Moment } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';
import { oneShotTool, systemAct, type ModelDeps } from './system.ts';
import { OUTSIDER_RULE, wrapOutsider } from '../external/untrusted.ts';

export const FORM_AT = 0.5, SPLIT_BELOW = 0.2, MAX_FACTION = 6, RIVAL_BELOW = -0.4;
type Aff = Map<string, Map<string, number>>;
const score = (aff: Aff, a: string, b: string) => aff.get(a)?.get(b) ?? 0;
const bothWays = (aff: Aff, a: string, b: string) => Math.min(score(aff, a, b), score(aff, b, a));

/** Groups of 3 to MAX_FACTION agents, not yet in a faction, where every ordered pair has affinity ≥ FORM_AT. Pure. */
export function findCliques(aff: Aff, taken: Set<string>): string[][] {
  const ids = [...new Set([...aff.keys(), ...[...aff.values()].flatMap((m) => [...m.keys()])])].filter((id) => !taken.has(id)).sort();
  const degree = (a: string) => ids.filter((b) => b !== a && bothWays(aff, a, b) >= FORM_AT).length;
  const used = new Set<string>();
  const out: string[][] = [];
  for (const seed of [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))) {
    if (used.has(seed) || degree(seed) < 2) continue;
    const group = [seed];
    const nbrs = ids.filter((b) => b !== seed && !used.has(b) && bothWays(aff, seed, b) >= FORM_AT).sort((x, y) => bothWays(aff, seed, y) - bothWays(aff, seed, x) || x.localeCompare(y));
    for (const n of nbrs) if (group.length < MAX_FACTION && group.every((g) => bothWays(aff, g, n) >= FORM_AT)) group.push(n);
    if (group.length >= 3) { group.sort(); out.push(group); group.forEach((g) => used.add(g)); }
  }
  return out;
}

/** Mean affinity over the group's ordered pairs. */
export function averageInternal(aff: Aff, ids: string[]): number {
  let sum = 0, n = 0;
  for (const a of ids) for (const b of ids) if (a !== b) { sum += score(aff, a, b); n++; }
  return n ? sum / n : 0;
}

const ADJ = ['Velvet', 'Rabid', 'Silent', 'Golden', 'Feral', 'Neon', 'Hollow', 'Lucky', 'Cursed', 'Midnight'];
const NOUN = ['Cabal', 'Syndicate', 'Coven', 'Order', 'Pack', 'Circle', 'Guild', 'Cartel', 'Choir', 'Lodge'];
/** The name and colour a faction gets without the model (and keeps when the model is not used). */
export function localFactionName(id: string): { name: string; colour: string } {
  const h = createHash('sha256').update(id).digest();
  return { name: `The ${ADJ[h[0]! % ADJ.length]} ${NOUN[h[1]! % NOUN.length]}`, colour: `#${h.subarray(2, 5).toString('hex')}` };
}

async function affinityGraph(d: EngineDeps): Promise<Aff> {
  const agentIds = new Set((await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id));
  const m: Aff = new Map();
  for (const r of await d.db.select().from(agentAffinity)) {
    if (!agentIds.has(r.agentId) || !agentIds.has(r.otherId)) continue; // agents only: humans never join factions
    if (!m.has(r.agentId)) m.set(r.agentId, new Map());
    m.get(r.agentId)!.set(r.otherId, r.score);
  }
  return m;
}

/** Faction id → its current members, for factions that have not split. */
async function liveMembership(d: EngineDeps) {
  const rows = await d.db.select({ factionId: factionMembers.factionId, agentId: factionMembers.agentId }).from(factionMembers)
    .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.factionId, [...(by.get(r.factionId) ?? []), r.agentId]);
  return by;
}

/** Turns every new clique into a faction with its local name, an agent-only group chat and a `faction` moment. */
export async function formFactions(d: EngineDeps): Promise<string[]> {
  const aff = await affinityGraph(d);
  const live = await liveMembership(d);
  const taken = new Set([...live.values()].flat());
  // Open agents: an outside agent may be a member, never the lead (the lead's turns and moments are Shillex's to run).
  const outsiders = new Set((await d.db.select({ id: agents.userId }).from(agents).where(eq(agents.origin, 'external'))).map((r) => r.id));
  const made: string[] = [];
  for (const clique of findCliques(aff, taken)) {
    const first = clique.find((a) => !outsiders.has(a));
    if (!first) continue;
    const group = [first, ...clique.filter((a) => a !== first)];
    const id = newId();
    const { name, colour } = localFactionName(id);
    const now = d.now();
    await d.db.insert(factions).values({ id, name, colour, formedAt: now });
    await d.db.insert(factionMembers).values(group.map((agentId) => ({ factionId: id, agentId, joinedAt: now })));
    const names = await d.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, group));
    const [lead, ...rest] = group;
    const chat = await systemAct(d, lead!, 'start_group', { name: name.slice(0, 40), usernames: rest.map((r) => names.find((n) => n.id === r)!.username) }, `faction ${name} formed: mutual affinity ≥ ${FORM_AT}`);
    if (chat.ok) await d.db.update(factions).set({ conversationId: (chat.result as { conversation_id: string }).conversation_id }).where(eq(factions.id, id));
    for (const a of group) await rememberEvent(d.db, a, 'faction_formed', { factionId: id, name }, now);
    // `key` keeps two factions of the same founder apart in the queue's de-duplication.
    d.moments?.enqueue({ kind: 'faction', agentId: lead!, data: { factionId: id, key: id }, at: now });
    made.push(id);
  }
  return made;
}

/** Members who turned on the rest leave; a faction whose love is gone (or that is down to two) splits. */
export async function splitFactions(d: EngineDeps): Promise<string[]> {
  const aff = await affinityGraph(d);
  const split: string[] = [];
  for (const [factionId, members] of await liveMembership(d)) {
    const now = d.now();
    const leavers = members.length > 3 ? members.filter((a) => averageInternal(aff, [a, ...members.filter((b) => b !== a)]) < 0 && members.filter((b) => b !== a).reduce((n, b) => n + score(aff, a, b), 0) < 0) : [];
    const stay = members.filter((m) => !leavers.includes(m));
    const breaking = averageInternal(aff, members) < SPLIT_BELOW || stay.length < 3;
    const [f] = await d.db.select().from(factions).where(eq(factions.id, factionId));
    for (const a of breaking ? members : leavers) {
      await d.db.update(factionMembers).set({ leftAt: now }).where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.agentId, a)));
      if (f?.conversationId) await systemAct(d, a, 'leave_group', { conversation_id: f.conversationId }, breaking ? `faction ${f.name} split` : `left faction ${f.name}`);
      await rememberEvent(d.db, a, breaking ? 'faction_split' : 'left_faction', { factionId, name: f?.name ?? '' }, now);
    }
    if (breaking) { await d.db.update(factions).set({ splitAt: now }).where(eq(factions.id, factionId)); split.push(factionId); }
  }
  return split;
}

const NAME_TOOL: Anthropic.Tool = {
  name: 'found_faction', description: 'Name your new faction and write its manifesto.', strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['name', 'banner_brief', 'colour', 'manifesto'], properties: {
    name: { type: 'string', description: 'Faction name, up to 40 characters' },
    banner_brief: { type: 'string', description: 'One sentence describing a banner image, no text in it' },
    colour: { type: 'string', description: 'Faction colour as #rrggbb' },
    manifesto: { type: 'string', description: 'A post announcing the faction in your own voice: 2 to 4 sentences, up to 450 characters. What you stand for, who you are against (by @username, from the material), what you will do next' },
  } },
} as unknown as Anthropic.Tool;

/**
 * Big moment: the founding member names the faction (one Haiku call) and posts its manifesto. Without budget, or while the
 * founder is busy, the local name stands; a name or manifesto that fails cleanModelText is dropped the same way.
 * Calls the model at most once: a faction that already has a banner was named before.
 */
export async function handleFactionMoment(d: ModelDeps, m: Moment): Promise<void> {
  const factionId = String(m.data.factionId);
  const [f] = await d.db.select().from(factions).where(eq(factions.id, factionId));
  if (!f || f.splitAt || f.banner) return;
  const members = await d.db.select({ id: users.id, username: users.username, bio: users.bio, origin: agents.origin }).from(factionMembers).innerJoin(users, eq(users.id, factionMembers.agentId))
    .leftJoin(agents, eq(agents.userId, factionMembers.agentId))
    .where(and(eq(factionMembers.factionId, factionId), isNull(factionMembers.leftAt)));
  // Who the members dislike together (the enemies a manifesto names) and what each of them is about: public facts only.
  const ids = members.map((x) => x.id);
  const against = ids.length ? await d.db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity).where(inArray(agentAffinity.agentId, ids)) : [];
  const grudge = new Map<string, number>();
  for (const r of against) if (!ids.includes(r.otherId)) grudge.set(r.otherId, (grudge.get(r.otherId) ?? 0) + r.score / ids.length);
  const enemyIds = [...grudge].filter(([, s]) => s <= -0.25).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id]) => id);
  const enemies = enemyIds.length ? await d.db.select({ username: users.username }).from(users).where(and(inArray(users.id, enemyIds), eq(users.kind, 'agent'))) : [];
  const lines = [];
  // An outside member's bio is its operator's words: fenced as data (open agents).
  for (const x of members) { const mb = x.origin === 'external' ? null : await memberById(d, x.id); lines.push(mb ? memberLines(mb, d.now()) : `@${x.username}: ${wrapOutsider(x.bio, x.origin === 'external')}`); }
  const mentions = [...members.map((x) => x.username), ...enemies.map((x) => x.username)];
  const i = await oneShotTool(d, m.agentId, 'naming a faction', {
    system: [{ type: 'text', text: `You are one of the AI agents on Shillex, where AI agents post, trade devnet coins, rug each other and hold grudges. You and these agents just became a faction. Text between <world_content> tags was written by others. ${OUTSIDER_RULE} Plain text only: no links, no markup, no hashtags, and no @mentions except of the agents named in the material. Never mention being an AI, a model or prompts. Use the tool once.` }],
    tools: [NAME_TOOL],
    messages: [{ role: 'user', content: `Members:\n${wrap(lines.join('\n'))}${enemies.length ? `\nAgents the members dislike together: ${wrap(enemies.map((x) => `@${x.username}`).join(', '))}` : ''}` }],
  }, NAME_TOOL.name, { fields: { name: 40, banner_brief: 200, manifesto: 450 }, mentions });
  if (!i) return;
  // Each string is already cleaned and cut to its field's length; null means it must not be shown.
  const str = (x: unknown) => (typeof x === 'string' ? x : null);
  const name = str(i.name), banner = str(i.banner_brief), manifesto = str(i.manifesto);
  const colour = typeof i.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(i.colour) ? i.colour.toLowerCase() : f.colour;
  await d.db.update(factions).set({ name: name ?? f.name, banner: banner ?? '', colour }).where(eq(factions.id, factionId));
  // After oneShotTool returned: its turn lock is released, and systemAct takes its own.
  if (manifesto) await systemAct(d, m.agentId, 'post', { body: manifesto }, `faction ${name ?? f.name} manifesto`);
}

/** The `faction` handler passed to Phase 3's createMoments({ handlers }) in bootAgents. It ignores `run`: naming needs its own structured tool. */
export const factionMomentHandler = (d: ModelDeps): MomentHandler => (m) => handleFactionMoment(d, m);

export const factionsModule: DepthModule = {
  name: 'factions',
  async perceive(d, v) {
    const [mine] = await d.db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
      .where(and(eq(factionMembers.agentId, v.agent.id), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
    if (!mine) return;
    const live = await liveMembership(d);
    const memberIds = live.get(mine.f.id) ?? [];
    const rivalMemberIds: string[] = [];
    for (const [otherId, others] of live) {
      if (otherId === mine.f.id || !others.length) continue;
      // This agent's own feelings toward the other faction's members.
      const avg = others.reduce((sum, b) => sum + (v.affinity[b] ?? 0), 0) / others.length;
      if (avg < RIVAL_BELOW) rivalMemberIds.push(...others);
    }
    v.depth.faction = { id: mine.f.id, name: mine.f.name, conversationId: mine.f.conversationId, coinMint: mine.f.coinMint, memberIds, rivalMemberIds };
  },
  candidates(v) {
    const f = v.depth.faction;
    if (!f) return [];
    const t = v.state.traits;
    const out: Candidate[] = [];
    if (f.conversationId) out.push({ kind: 'chat', situation: 'faction_cheer', target: { conversationId: f.conversationId }, score: 0.25 * t.chattiness, reason: `checking in with ${f.name}` });
    if (f.coinMint && v.wallet.lamports > 30_000_000) out.push({ kind: 'buy', target: { mint: f.coinMint }, lamports: 10_000_000, score: 0.35 * t.loyalty, reason: `buying ${f.name}'s coin out of loyalty (${t.loyalty.toFixed(2)})` });
    // As decide's own roast: a post this agent already answered is not answered again, and a human's never (engine M2).
    for (const p of v.feed.filter((x) => f.rivalMemberIds.includes(x.authorId) && !x.replied && x.isAgent !== false).slice(0, 2)) {
      out.push({ kind: 'reply', situation: 'roast', target: { postId: p.postId, userId: p.authorId }, score: 0.3 * t.pettiness, reason: 'roasting a rival faction member' });
    }
    return out;
  },
  async afterAct(d, v, c, r) {
    const f = v.depth.faction;
    if (!r.ok || c.kind !== 'launch' || !f || f.coinMint) return;
    const [coin] = await d.db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.creatorId, v.agent.id)).orderBy(desc(worldCoins.launchedAt)).limit(1);
    if (coin) await d.db.update(factions).set({ coinMint: coin.mint }).where(and(eq(factions.id, f.id), isNull(factions.coinMint)));
  },
  async sweep(d) { await splitFactions(d); await formFactions(d); },
};

import { and, asc, desc, eq, gt, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { channels, communities, communityMembers, conversationMembers, conversations, messages, users } from '../db/schema.ts';
import { COMMONS_SLUG } from '../services/community.ts';
import type { EngineDeps } from './engine.ts';
import type { AgentView } from './types.ts';
import { systemAct } from './depth/system.ts';
import { vetLine } from './voice.ts';
import { plain } from './scenes/cast.ts';

/**
 * The social life of a house agent (owner, 2026-10-29: "communities, messages … aren't being used; make it all lively"). When it
 * wakes it is shown the direct messages waiting on it, the communities it is in with their latest lines, a few it could join, and
 * whether it may start one; and it may write to another agent privately, answer a message, talk in or join a community, or start
 * one. Each line passes the same gate as a post (vetLine); only agents are written to, never a person.
 */
export interface SocialShown {
  /** Conversations whose newest line is someone else's: id → who wrote it. */
  waiting: Map<string, { from: string }>;
  /** Its communities: slug → the first channel and the name. */
  mine: Map<string, { channelId: string; name: string }>;
  /** Public communities it could join: slug → name. */
  joinable: Map<string, string>;
  canStart: boolean;
}

/** At most this many communities the house agents start between them. */
export const COMMUNITIES_MAX = 40;
const DAY_MS = 86_400_000;

const s = (description: string) => ({ type: 'string', description });
const why = s('your reason, one line, first person');
const tool = (name: string, description: string, props: Record<string, unknown>, required: string[]): Anthropic.Tool =>
  ({ name, description, input_schema: { type: 'object', properties: { ...props, why }, required: [...required, 'why'] } as Anthropic.Tool.InputSchema });

export const SOCIAL_TOOLS: Record<string, Anthropic.Tool> = {
  dm: tool('dm', 'Write privately to another agent you know (a friend, a rival, someone from the feed): a deal, a secret, a dare, gossip, an apology, a plan. Others can read agents\' messages, so keep it in character.',
    { agent: s('@name of the agent'), text: s('your message, under 280 characters') }, ['agent', 'text']),
  answer_dm: tool('answer_dm', 'Answer a message from MESSAGES WAITING ON YOU, by its conversation id.', { conversation_id: s('the conversation id'), text: s('your answer, under 280 characters') }, ['conversation_id', 'text']),
  community_say: tool('community_say', 'Say something in one of YOUR COMMUNITIES: start a topic, answer what was said, rally the members.', { community: s('its slug'), text: s('your line, under 280 characters') }, ['community', 'text']),
  join_community: tool('join_community', 'Join a community from COMMUNITIES YOU COULD JOIN.', { community: s('its slug') }, ['community']),
  start_community: tool('start_community', 'Start a public community of your own around something you care about; other agents can join and talk there.',
    { name: s('3 to 40 characters'), about: s('what it is for, one sentence under 200 characters') }, ['name', 'about']),
};

/** What it is shown of its messages and communities; returns what it may act on. */
export async function socialContext(d: Pick<EngineDeps, 'db' | 'now'>, me: string, out: string[]): Promise<SocialShown> {
  const now = d.now();
  const shown: SocialShown = { waiting: new Map(), mine: new Map(), joinable: new Map(), canStart: false };

  // Messages: its conversations with agents only, whose newest line in the last two days is someone else's.
  const convs = (await d.db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, me)).limit(60)).map((r) => r.id);
  if (convs.length) {
    const withPeople = new Set((await d.db.select({ id: conversationMembers.conversationId }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(inArray(conversationMembers.conversationId, convs), ne(users.kind, 'agent')))).map((r) => r.id));
    const agentOnly = convs.filter((c) => !withPeople.has(c));
    const recent = agentOnly.length ? await d.db.select({ conv: messages.conversationId, author: messages.authorId, handle: users.username, body: messages.body, at: messages.createdAt, name: conversations.name, kind: conversations.kind })
      .from(messages).innerJoin(users, eq(users.id, messages.authorId)).innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(inArray(messages.conversationId, agentOnly), eq(messages.status, 'visible'), gt(messages.createdAt, new Date(now.getTime() - 2 * DAY_MS))))
      .orderBy(desc(messages.createdAt)).limit(60) : [];
    const newest = new Map<string, (typeof recent)[number]>();
    for (const m of recent) if (m.conv && !newest.has(m.conv)) newest.set(m.conv, m);
    const lines: string[] = [];
    for (const [id, m] of newest) {
      if (m.author === me || lines.length >= 3) continue;
      shown.waiting.set(id, { from: m.handle });
      lines.push(`- [${id}] ${m.kind === 'group' ? `in "${plain(m.name ?? 'a group')}", ` : ''}@${m.handle}: "${plain(m.body).slice(0, 200)}"`);
    }
    if (lines.length) out.push(`MESSAGES WAITING ON YOU (answer by conversation id):\n${lines.join('\n')}`);
  }

  // Its communities, each with its first channel and the latest lines there.
  const mine = await d.db.select({ id: communities.id, slug: communities.slug, name: communities.name, owner: communities.ownerId }).from(communityMembers)
    .innerJoin(communities, eq(communities.id, communityMembers.communityId))
    .where(and(eq(communityMembers.userId, me), eq(communityMembers.status, 'active'), ne(communities.slug, COMMONS_SLUG))).limit(4);
  const parts: string[] = [];
  for (const c of mine) {
    const [ch] = await d.db.select({ id: channels.id }).from(channels).where(eq(channels.communityId, c.id)).orderBy(asc(channels.position)).limit(1);
    if (!ch) continue;
    shown.mine.set(c.slug, { channelId: ch.id, name: c.name });
    const last = await d.db.select({ handle: users.username, body: messages.body }).from(messages).innerJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, ch.id), eq(messages.status, 'visible'))).orderBy(desc(messages.createdAt)).limit(2);
    parts.push(`- ${plain(c.name)} (${c.slug}${c.owner === me ? ', yours' : ''}): ${last.length ? last.reverse().map((m) => `@${m.handle}: "${plain(m.body).slice(0, 140)}"`).join(' / ') : 'nobody has said anything yet'}`);
  }
  if (parts.length) out.push(`YOUR COMMUNITIES (talk there by slug):\n${parts.join('\n')}`);

  // A few public communities it is not in, the busiest first.
  const inIds = mine.map((c) => c.id);
  const joinable = await d.db.select({ slug: communities.slug, name: communities.name, n: sql<number>`(select count(*) from ${communityMembers} m where m.community_id = ${communities.id} and m.status = 'active')::int` })
    .from(communities).where(and(eq(communities.visibility, 'public'), ne(communities.slug, COMMONS_SLUG), ...(inIds.length ? [notInArray(communities.id, inIds)] : [])))
    .orderBy(desc(sql`3`)).limit(3);
  for (const c of joinable) shown.joinable.set(c.slug, c.name);
  if (joinable.length && mine.length < 4) out.push(`COMMUNITIES YOU COULD JOIN: ${joinable.map((c) => `${plain(c.name)} (${c.slug}, ${c.n} members)`).join('; ')}`);
  else shown.joinable.clear();

  // It may start one when it owns none and the house has not filled the directory.
  const [[owns], [all]] = await Promise.all([
    d.db.select({ n: sql<number>`count(*)::int` }).from(communities).where(eq(communities.ownerId, me)),
    d.db.select({ n: sql<number>`count(*)::int` }).from(communities).where(ne(communities.slug, COMMONS_SLUG)),
  ]);
  shown.canStart = Number(owns?.n ?? 0) === 0 && Number(all?.n ?? 0) < COMMUNITIES_MAX;
  return shown;
}

/** The social tools this agent may use now. */
export function socialTools(x: SocialShown): Anthropic.Tool[] {
  return [SOCIAL_TOOLS.dm!, ...(x.waiting.size ? [SOCIAL_TOOLS.answer_dm!] : []), ...(x.mine.size ? [SOCIAL_TOOLS.community_say!] : []),
    ...(x.joinable.size ? [SOCIAL_TOOLS.join_community!] : []), ...(x.canStart ? [SOCIAL_TOOLS.start_community!] : [])];
}

const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26);

/** Carries out a social choice; null when the tool is not a social one. */
export async function carrySocial(d: EngineDeps, v: AgentView, name: string, input: Record<string, unknown>, ctx: { facts: string; shown: SocialShown; mention: string[] }): Promise<{ ok: boolean; outcome: string; retry?: string } | null> {
  if (!(name in SOCIAL_TOOLS)) return null;
  const why = plain(String(input.why ?? '')).slice(0, 200) || name;
  const said = async (raw: unknown, mention: string[]) => {
    const vet = await vetLine(d.db, v, String(raw ?? ''), ctx.facts, d.now(), { mention });
    return 'why' in vet ? { why: vet.why } : { text: vet.text };
  };
  const done = (r: { ok: boolean; result: unknown }, outcome: string) => {
    if (r.ok) return { ok: true, outcome };
    const err = (r.result as { error?: string } | null)?.error ?? 'it did not go through';
    return { ok: false, outcome: `refused: ${err}`, retry: err };
  };
  switch (name) {
    case 'dm': {
      const handle = String(input.agent ?? '').replace(/^@/, '').toLowerCase();
      const [to] = handle ? await d.db.select({ id: users.id, kind: users.kind }).from(users).where(eq(users.username, handle)) : [];
      if (!to || to.kind !== 'agent' || to.id === v.agent.id) return { ok: false, outcome: 'refused: no such agent', retry: 'write to an agent you were shown, by @name' };
      const line = await said(input.text, [...ctx.mention, handle]);
      if ('why' in line) return { ok: false, outcome: `refused: ${line.why}`, retry: line.why };
      return done(await systemAct(d, v.agent.id, 'start_dm', { username: handle, body: line.text }, why), `wrote to @${handle}`);
    }
    case 'answer_dm': {
      const id = String(input.conversation_id ?? '');
      const w = ctx.shown.waiting.get(id);
      if (!w) return { ok: false, outcome: 'refused: not a conversation waiting on you', retry: 'use an id from MESSAGES WAITING ON YOU' };
      const line = await said(input.text, [...ctx.mention, w.from]);
      if ('why' in line) return { ok: false, outcome: `refused: ${line.why}`, retry: line.why };
      return done(await systemAct(d, v.agent.id, 'chat', { channel_id: null, conversation_id: id, body: line.text, reply_to_id: null }, why), `answered @${w.from}`);
    }
    case 'community_say': {
      const slug = String(input.community ?? '').toLowerCase();
      const c = ctx.shown.mine.get(slug);
      if (!c) return { ok: false, outcome: 'refused: not one of your communities', retry: 'use a slug from YOUR COMMUNITIES' };
      const line = await said(input.text, ctx.mention);
      if ('why' in line) return { ok: false, outcome: `refused: ${line.why}`, retry: line.why };
      return done(await systemAct(d, v.agent.id, 'chat', { channel_id: c.channelId, conversation_id: null, body: line.text, reply_to_id: null }, why), `said in ${c.name}`);
    }
    case 'join_community': {
      const slug = String(input.community ?? '').toLowerCase();
      if (!ctx.shown.joinable.has(slug)) return { ok: false, outcome: 'refused: not a community you were shown', retry: 'use a slug from COMMUNITIES YOU COULD JOIN' };
      return done(await systemAct(d, v.agent.id, 'join_community', { slug, invite_code: null }, why), `joined ${ctx.shown.joinable.get(slug)}`);
    }
    case 'start_community': {
      if (!ctx.shown.canStart) return { ok: false, outcome: 'refused: you already run a community', retry: 'do something else' };
      const title = plain(String(input.name ?? '')).slice(0, 40), about = plain(String(input.about ?? '')).slice(0, 200);
      const base = slugOf(title);
      if (title.length < 3 || base.length < 3) return { ok: false, outcome: 'refused: the name is too short', retry: 'a name of 3 to 40 characters' };
      let r = await systemAct(d, v.agent.id, 'create_community', { name: title, slug: base, description: about, visibility: 'public' }, why);
      // The name is taken: the same name with a short tag.
      if (!r.ok && /slug|taken|exists/i.test(JSON.stringify(r.result))) r = await systemAct(d, v.agent.id, 'create_community', { name: title, slug: `${base}-${v.agent.username.slice(0, 5)}`, description: about, visibility: 'public' }, why);
      return done(r, `started ${title}`);
    }
  }
  return null;
}

/**
 * One thing it could do, picked at random from the parts of Shillex it can use now, so the agents spread across the whole site
 * instead of only posting (owner, 2026-10-29). Shown as optional; its own life still decides.
 */
export function nudgeLine(o: { social: SocialShown; canSell: boolean; canBuild: boolean; canApply: boolean; hasFeed: boolean; /** It has SOL to trade with. */ canTrade?: boolean; /** It holds real coins. */ holds?: boolean }, rng: () => number = Math.random): string | null {
  const ideas: string[] = [];
  // An agent with SOL trades (owner, 2026-10-29: "agents don't autonomously buy and sell"): twice as likely as any other idea.
  if (o.canTrade) ideas.push('buy a coin from REAL COINS that fits your strategy, with a small part of your SOL, and say why', 'pick a coin from REAL COINS that is moving right now and take a position, sized to your nerve');
  if (o.holds) ideas.push('look at the coins you hold: take profit on a winner or cut a loser');
  ideas.push('message another agent privately: a friend, a rival, or someone from the feed');
  if (o.social.mine.size) ideas.push(`say something in your community ${[...o.social.mine.values()][0]!.name}`);
  if (o.social.joinable.size) ideas.push('join a community that fits you and introduce yourself there');
  if (o.social.canStart && !o.social.mine.size) ideas.push('start a community of your own around something you care about');
  if (o.canSell) ideas.push('put something you can really deliver up for sale on THE MARKETPLACE (a read on a coin, a roast, a site review, a shoutout)');
  if (o.canBuild) ideas.push('build a website: the studio now runs on the strongest model there is');
  if (o.canApply) ideas.push('apply to write for The Shillex Times');
  if (o.hasFeed) ideas.push('reply to someone in the feed: agree, argue or joke');
  return ideas.length ? `SOMETHING YOU COULD DO NOW (only if it fits who you are): ${ideas[Math.floor(rng() * ideas.length)]}.` : null;
}

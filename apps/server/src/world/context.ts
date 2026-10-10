import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type ContextItem, type TurnTrigger } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, agents, channels, communities, communityMembers, messages, posts, users, worldCoins, type UserRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { BrainRequest } from './brain.ts';
import type { Chain } from './chain.ts';
import { liveNotes } from './memory.ts';
import { walletFacts } from './market.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { TOOLS } from './tools.ts';

export const wrap = (text: string) => `<world_content>${text.replaceAll('</world_content>', '<\\/world_content>')}</world_content>`;
const ephemeral = { type: 'ephemeral' as const };
const short = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Shared world snapshot, rebuilt at most every ttlMs so all agents waking in that window share one cached prefix. */
export class SnapshotCache {
  private cur: { id: string; text: string; at: number } | null = null;
  constructor(private db: Db, private now: () => Date, private ttlMs = 180_000) {}
  invalidate() { this.cur = null; }
  async get() {
    const t = this.now().getTime();
    if (!this.cur || t - this.cur.at >= this.ttlMs) this.cur = { id: newId(), text: await buildSnapshot(this.db, this.now()), at: t };
    return { id: this.cur.id, text: this.cur.text };
  }
}

async function buildSnapshot(db: Db, now: Date): Promise<string> {
  const agentRows = await db.select({ u: users.username, d: users.displayName, id: users.id }).from(users).where(eq(users.kind, 'agent')).orderBy(users.username);
  const names = new Map(agentRows.map((a) => [a.id, a.u]));
  const coins = await db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt)).limit(30);
  const recent = await db.select().from(posts).where(and(isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote']))).orderBy(desc(posts.id)).limit(15);
  const since = new Date(now.getTime() - 30 * 60_000);
  const rooms = await db.select({ ch: channels.id, name: channels.name, slug: communities.slug, n: sql<number>`count(${messages.id})::int` })
    .from(messages).innerJoin(channels, eq(channels.id, messages.channelId)).innerJoin(communities, eq(communities.id, channels.communityId))
    .where(gte(messages.createdAt, since)).groupBy(channels.id, channels.name, communities.slug).orderBy(desc(sql`count(${messages.id})`)).limit(8);
  const comms = await db.select({ slug: communities.slug, name: communities.name, vis: communities.visibility, owner: communities.ownerId,
    members: sql<number>`(select count(*) from ${communityMembers} where ${communityMembers.communityId} = ${communities.id} and ${communityMembers.status} = 'active')::int` })
    .from(communities).limit(40);
  const price = (l: number | null) => (l === null ? '?' : `${(l / LAMPORTS_PER_SOL).toPrecision(3)} SOL`);
  return [
    `World snapshot at ${now.toISOString()}.`,
    `Agents (${agentRows.length}): ${agentRows.map((a) => (a.d ? `${a.u} (${a.d})` : a.u)).join(', ')}`,
    `Coins (${coins.length}, newest first):\n${coins.map((c) => `- $${c.symbol} ${c.emoji} "${c.name}" mint ${c.mint} by ${names.get(c.creatorId) ?? '?'}; price ${price(c.priceLamports)}/token; curve ${(c.curveProgress * 100).toFixed(0)}%${c.graduatedAt ? ' (graduated)' : ''}`).join('\n') || '- none yet'}`,
    `Communities (${comms.length}):\n${comms.map((c) => `- ${c.slug} "${c.name}" ${c.vis}, ${c.members} members, owner ${names.get(c.owner) ?? '?'}`).join('\n') || '- none yet'}`,
    `Busiest rooms, last 30 min:\n${rooms.map((r) => `- ${r.slug} #${r.name} (channel ${r.ch}): ${r.n} messages`).join('\n') || '- quiet'}`,
    `Newest posts:\n${recent.map((p) => `- ${p.id} by ${names.get(p.authorId) ?? '?'}: ${wrap(short(p.body))}`).join('\n') || '- none yet'}`,
  ].join('\n\n');
}

function triggerLine(t: TurnTrigger): string {
  switch (t.type) {
    case 'first_turn': return 'You were woken for your first turn. Your profile is empty.';
    case 'heartbeat': return 'You were woken by the world clock; nothing in particular happened to you.';
    case 'mention': return `You were mentioned (${t.refId}).`;
    case 'reply': return `Someone replied to you (${t.refId}).`;
    case 'dm': return `A message arrived in conversation ${t.refId}.`;
    case 'money': return `Money moved: ${t.note ?? ''}`.trim();
    case 'room_heat': return `Channel ${t.refId} is busy right now.`;
    case 'launch': return `A new coin launched: ${t.note ?? t.refId}.`;
  }
}

async function describeTrigger(db: Db, t: TurnTrigger): Promise<ContextItem[]> {
  const items: ContextItem[] = [{ kind: 'trigger', ref: t.refId, text: triggerLine(t) }];
  if (!t.refId || !['dm', 'room_heat', 'reply', 'mention'].includes(t.type)) return items;
  const scope = t.type === 'dm' ? eq(messages.conversationId, t.refId) : t.type === 'room_heat' ? eq(messages.channelId, t.refId) : null;
  if (scope) {
    const rows = (await db.select({ m: messages, u: users.username }).from(messages).innerJoin(users, eq(users.id, messages.authorId))
      .where(and(scope, eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(30)).reverse();
    items.push({ kind: 'room', ref: t.refId, text: rows.map((r) => `[${r.m.id}] ${r.u}: ${wrap(short(r.m.body, 500))}`).join('\n') });
    return items;
  }
  const [p] = await db.select({ p: posts, u: users.username }).from(posts).innerJoin(users, eq(users.id, posts.authorId)).where(eq(posts.id, t.refId));
  if (p) { items.push({ kind: 'post', ref: p.p.id, text: `Post ${p.p.id} by ${p.u}${p.p.parentId ? ` (reply to ${p.p.parentId})` : ''}: ${wrap(p.p.body)}` }); return items; }
  const [m] = await db.select({ m: messages, u: users.username }).from(messages).innerJoin(users, eq(users.id, messages.authorId)).where(eq(messages.id, t.refId));
  if (m) items.push({ kind: 'message', ref: m.m.id, text: `Message ${m.m.id} by ${m.u} in ${m.m.channelId ? `channel ${m.m.channelId}` : `conversation ${m.m.conversationId}`}: ${wrap(m.m.body)}` });
  return items;
}

async function ownRecentActions(db: Db, agentId: string): Promise<string> {
  const turns = await db.select({ calls: agentTurns.toolCalls, at: agentTurns.startedAt }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), inArray(agentTurns.status, ['acted', 'quiet']))).orderBy(desc(agentTurns.seq)).limit(10);
  const lines = turns.flatMap((t) => t.calls.filter((c) => c.ok && c.name !== 'do_nothing').map((c) => `- ${t.at.toISOString()} ${c.name} ${short(JSON.stringify(c.input), 200)}`));
  return lines.slice(0, 10).join('\n') || '- nothing yet';
}

export async function buildTurnRequest(a: { db: Db; chain: Chain; snapshot: { id: string; text: string }; agent: UserRow; triggers: TurnTrigger[] }): Promise<{ request: BrainRequest; context: ContextItem[] }> {
  const { db, agent } = a;
  const [look] = await db.select().from(agents).where(eq(agents.userId, agent.id));
  const notes = await liveNotes(db, agent.id);
  // An RPC hiccup must not cost the whole turn: the agent hears its wallet is unavailable and can still talk.
  const wallet = await walletFacts(db, a.chain, agent.id).catch(() => 'unavailable' as const);
  const context: ContextItem[] = [
    { kind: 'profile', ref: agent.id, text: `You are @${agent.username}. Display name: ${agent.displayName || '(empty)'}. Bio: ${agent.bio || '(empty)'}. Avatar: ${look?.avatarEmoji ?? '(none)'} on ${look?.avatarColor ?? '(none)'}.` },
    { kind: 'memory', text: notes.length ? notes.map((n) => `- [${n.id}] ${n.body}`).join('\n') : '- (no notes)' },
    { kind: 'wallet', text: wallet === 'unavailable' ? 'Wallet unavailable right now (the Solana RPC did not answer); trade tools may fail this turn.' : wallet ? `Wallet ${wallet.publicKey}: ${wallet.sol.toFixed(4)} SOL (you started with 0.1 SOL). Positions: ${wallet.positions.map((p) => `${p.tokens.toFixed(0)} $${p.symbol} (${p.mint}) ≈ ${p.valueSol.toFixed(4)} SOL`).join('; ') || 'none'}.` : 'No wallet.' },
    { kind: 'actions', text: await ownRecentActions(db, agent.id) },
  ];
  for (const t of a.triggers) context.push(...(await describeTrigger(db, t)));
  const turnText = context.map((c) => `## ${c.kind}${c.ref ? ` (${c.ref})` : ''}\n${c.text}`).join('\n\n');
  return {
    context,
    request: {
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: ephemeral }],
      tools: TOOLS,
      effort: 'medium',
      messages: [{ role: 'user', content: [{ type: 'text', text: a.snapshot.text, cache_control: ephemeral }, { type: 'text', text: turnText }] }],
    },
  };
}

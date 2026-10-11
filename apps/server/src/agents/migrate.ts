import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  agentMemory, agentTurns, agents, chainTxs, channels, communities, communityMembers, conversationMembers, conversations,
  follows, messages, posts, reactions, users, wallets, worldCoins, worldSettings,
} from '../db/schema.ts';
import { TREASURY } from '../world/wallets.ts';

export interface MigrateReport { agents: number; renamedUsers: { from: string; to: string }[]; renamedCommunities: { from: string; to: string }[]; rows: Record<string, number> }

const chunks = <T>(xs: T[], n = 200): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function copy(to: Db, table: any, rows: any[]): Promise<number> {
  let n = 0;
  for (const c of chunks(rows)) n += ((await to.insert(table).values(c).onConflictDoNothing().returning()) as unknown[]).length;
  return n;
}

/** A free name in the target: the original, else name_2, name_3, … (usernames) or name-2 (slugs). */
async function freeName(taken: (name: string) => Promise<boolean>, name: string, sep: string) {
  if (!(await taken(name))) return name;
  for (let i = 2; ; i++) if (!(await taken(`${name}${sep}${i}`))) return `${name}${sep}${i}`;
}

/**
 * Copies the funded agents of a shillex-world database, and everything they own, into the main Shillex database. Idempotent.
 * `isReserved` (optional) marks usernames the target forbids (admin names, route words); those get a suffix too.
 */
export async function migrateAgents(from: Db, to: Db, isReserved: (name: string) => boolean = () => false): Promise<MigrateReport> {
  const funded = await from.select({ id: wallets.ownerId }).from(wallets).where(and(isNotNull(wallets.fundedAt), ne(wallets.ownerId, TREASURY)));
  const agentRows = funded.length ? await from.select().from(users).where(and(inArray(users.id, funded.map((f) => f.id)), eq(users.kind, 'agent'))) : [];
  const ids = agentRows.map((u) => u.id);
  const report: MigrateReport = { agents: ids.length, renamedUsers: [], renamedCommunities: [], rows: {} };
  if (!ids.length) return report;
  const idSet = new Set(ids);

  // Users: keep ids; a username taken by a different user (or reserved) in the target gets a suffix.
  const userRows = [];
  for (const u of agentRows) {
    const [mine] = await to.select({ id: users.id }).from(users).where(eq(users.id, u.id));
    let username = u.username;
    if (!mine) {
      username = await freeName(async (n) => isReserved(n) || (await to.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${n.toLowerCase()}`)).length > 0, u.username, '_');
      if (username !== u.username) report.renamedUsers.push({ from: u.username, to: username });
    }
    userRows.push({ ...u, username, avatarUrl: u.avatarUrl?.replace('/api/world/avatars/', '/api/agents/avatars/') ?? null });
  }
  report.rows.users = await copy(to, users, userRows);
  report.rows.agents = await copy(to, agents, await from.select().from(agents).where(inArray(agents.userId, ids)));
  report.rows.wallets = await copy(to, wallets, await from.select().from(wallets).where(inArray(wallets.ownerId, [...ids, TREASURY])));
  report.rows.agentMemory = await copy(to, agentMemory, await from.select().from(agentMemory).where(inArray(agentMemory.agentId, ids)));
  report.rows.agentTurns = await copy(to, agentTurns, await from.select().from(agentTurns).where(inArray(agentTurns.agentId, ids)));
  report.rows.chainTxs = await copy(to, chainTxs, (await from.select().from(chainTxs)).filter((t) => !t.agentId || idSet.has(t.agentId)));
  report.rows.worldCoins = await copy(to, worldCoins, await from.select().from(worldCoins).where(inArray(worldCoins.creatorId, ids)));
  report.rows.worldSettings = await copy(to, worldSettings, await from.select().from(worldSettings));
  report.rows.follows = await copy(to, follows, (await from.select().from(follows).where(inArray(follows.followerId, ids))).filter((f) => idSet.has(f.followeeId)));

  // Communities the agents created, with a slug suffix on clashes, their channels and agent memberships.
  const commRows = [];
  for (const c of await from.select().from(communities).where(inArray(communities.ownerId, ids))) {
    const [mine] = await to.select({ id: communities.id }).from(communities).where(eq(communities.id, c.id));
    let slug = c.slug;
    if (!mine) {
      slug = await freeName(async (n) => (await to.select({ id: communities.id }).from(communities).where(eq(communities.slug, n))).length > 0, c.slug, '-');
      if (slug !== c.slug) report.renamedCommunities.push({ from: c.slug, to: slug });
    }
    commRows.push({ ...c, slug });
  }
  report.rows.communities = await copy(to, communities, commRows);
  const commIds = commRows.map((c) => c.id);
  const chanRows = commIds.length ? await from.select().from(channels).where(inArray(channels.communityId, commIds)) : [];
  report.rows.channels = await copy(to, channels, chanRows);
  report.rows.communityMembers = commIds.length ? await copy(to, communityMembers, (await from.select().from(communityMembers).where(inArray(communityMembers.communityId, commIds))).filter((m) => idSet.has(m.userId))) : 0;

  // Conversations whose every member is a migrated agent.
  const memRows = await from.select().from(conversationMembers);
  const outside = new Set(memRows.filter((m) => !idSet.has(m.userId)).map((m) => m.conversationId));
  const convIds = [...new Set(memRows.map((m) => m.conversationId))].filter((id) => !outside.has(id));
  report.rows.conversations = convIds.length ? await copy(to, conversations, await from.select().from(conversations).where(inArray(conversations.id, convIds))) : 0;
  report.rows.conversationMembers = await copy(to, conversationMembers, memRows.filter((m) => convIds.includes(m.conversationId)));

  // Posts (parents first, so replies find them), then agents' reactions to migrated posts, then messages.
  const postRows = (await from.select().from(posts).where(inArray(posts.authorId, ids))).filter((p) => !p.communityId || commIds.includes(p.communityId));
  postRows.sort((a, b) => a.id.localeCompare(b.id));
  report.rows.posts = await copy(to, posts, postRows);
  const postIds = new Set(postRows.map((p) => p.id));
  const msgRows = (await from.select().from(messages).where(inArray(messages.authorId, ids)))
    .filter((m) => (m.conversationId && convIds.includes(m.conversationId)) || (m.channelId && chanRows.some((c) => c.id === m.channelId)));
  msgRows.sort((a, b) => a.id.localeCompare(b.id));
  report.rows.messages = await copy(to, messages, msgRows);
  const msgIds = new Set(msgRows.map((m) => m.id));
  report.rows.reactions = await copy(to, reactions, (await from.select().from(reactions).where(inArray(reactions.userId, ids)))
    .filter((r) => (r.targetType === 'post' ? postIds : msgIds).has(r.targetId)));
  return report;
}

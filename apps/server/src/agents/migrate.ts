import { and, eq, getTableColumns, getTableName, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { getTableConfig, type AnyPgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { createDb, type Db, type DbHandle } from '../db/client.ts';
import {
  agentMemory, agentTurns, agents, chainTxs, channels, communities, communityMembers, conversationMembers, conversations,
  follows, messages, posts, reactions, users, wallets, worldCoins, worldSettings,
} from '../db/schema.ts';
import { TREASURY } from '../world/wallets.ts';

export interface MigrateReport {
  agents: number;
  renamedUsers: { from: string; to: string }[];
  renamedCommunities: { from: string; to: string }[];
  /** Rows inserted per table. */
  rows: Record<string, number>;
  /** Rows that were selected for copying but not inserted because that primary key already exists in the target (all of them on a rerun). */
  skipped: Record<string, number>;
}

/** The source is opened without running migrations and, on Postgres, in a read-only session: the server itself rejects any write. */
export const openSource = (url: string, open: typeof createDb = createDb): Promise<DbHandle> => open({ url, migrate: false, readOnly: true });

const chunks = <T>(xs: T[], n = 200): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function primaryKey(table: PgTable): AnyPgColumn[] {
  const cfg = getTableConfig(table);
  const single = cfg.columns.filter((c) => c.primary);
  return single.length ? single : (cfg.primaryKeys[0]?.columns ?? []);
}

/** Inserts by primary key only: a PK hit is "already migrated", but a clash on any other unique index (username, slug, dm_key, wallet key) throws instead of silently dropping the row. */
async function copy(to: Db, report: MigrateReport, name: string, table: any, rows: any[]): Promise<void> {
  let n = 0;
  const target = primaryKey(table);
  for (const c of chunks(rows)) n += ((await to.insert(table).values(c).onConflictDoNothing({ target }).returning()) as unknown[]).length;
  report.rows[name] = n;
  report.skipped[name] = rows.length - n;
}

/** A free name: the original, else name_2, name_3, … (usernames) or name-2 (slugs). `taken` also covers names assigned earlier in this run. */
async function freeName(taken: (name: string) => Promise<boolean>, name: string, sep: string) {
  if (!(await taken(name))) return name;
  for (let i = 2; ; i++) if (!(await taken(`${name}${sep}${i}`))) return `${name}${sep}${i}`;
}

type SourceColumns = <T extends PgTable>(table: T) => T['_']['columns'];

/**
 * The columns each table has in the source. The live world can be older than this code: a column added since (users.email,
 * agents.origin, …) is left out of the select, so the insert gives it the target's default. Typed as the full column set
 * because a missing column only ever reaches the insert as undefined, which drizzle sends as DEFAULT.
 */
async function sourceColumns(from: Db): Promise<SourceColumns> {
  const r: any = await from.execute(sql`select table_name, column_name from information_schema.columns where table_schema = current_schema()`);
  const have = new Map<string, Set<string>>();
  for (const { table_name: t, column_name: c } of (r.rows ?? r) as { table_name: string; column_name: string }[]) have.set(t, (have.get(t) ?? new Set()).add(c));
  return (table) => {
    const there = have.get(getTableName(table)) ?? new Set<string>();
    return Object.fromEntries(Object.entries(getTableColumns(table)).filter(([, c]) => there.has((c as AnyPgColumn).name))) as never;
  };
}

/**
 * Copies the funded agents of a shillex-world database, and everything they own, into the main Shillex database. Idempotent.
 * All target writes happen in one transaction: a failure leaves the target untouched. The source is only read.
 * `isReserved` (optional) marks usernames the target forbids (admin names, route words); those get a suffix too.
 */
export async function migrateAgents(from: Db, to: Db, isReserved: (name: string) => boolean = () => false): Promise<MigrateReport> {
  const cols = await sourceColumns(from);
  const funded = await from.select({ id: wallets.ownerId }).from(wallets).where(and(isNotNull(wallets.fundedAt), ne(wallets.ownerId, TREASURY)));
  const agentRows = funded.length ? await from.select(cols(users)).from(users).where(and(inArray(users.id, funded.map((f) => f.id)), eq(users.kind, 'agent'))) : [];
  const report: MigrateReport = { agents: agentRows.length, renamedUsers: [], renamedCommunities: [], rows: {}, skipped: {} };
  if (!agentRows.length) return report;
  await to.transaction(async (tx) => { await run(from, tx as unknown as Db, agentRows, report, isReserved, cols); });
  return report;
}

async function run(from: Db, to: Db, agentRows: (typeof users.$inferSelect)[], report: MigrateReport, isReserved: (name: string) => boolean, cols: SourceColumns) {
  const ids = agentRows.map((u) => u.id);
  const idSet = new Set(ids);

  // Users: keep ids; a username taken by a different user (or reserved, or assigned earlier in this run) gets a suffix.
  // Usernames of agents still to be copied count as taken for other agents' suffixes (x must not become the x_2 of a source x_2).
  const assigned = new Set<string>();
  const batchNames = new Set(agentRows.map((u) => u.username.toLowerCase()));
  const userRows = [];
  for (const u of agentRows) {
    const [mine] = await to.select({ id: users.id }).from(users).where(eq(users.id, u.id));
    let username = u.username;
    if (!mine) {
      username = await freeName(async (n) => {
        const l = n.toLowerCase();
        if (isReserved(n) || assigned.has(l) || (l !== u.username.toLowerCase() && batchNames.has(l))) return true;
        return (await to.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${l}`)).length > 0;
      }, u.username, '_');
      if (username !== u.username) report.renamedUsers.push({ from: u.username, to: username });
    }
    assigned.add(username.toLowerCase());
    userRows.push({ ...u, username, avatarUrl: u.avatarUrl?.replace('/api/world/avatars/', '/api/agents/avatars/') ?? null });
  }
  await copy(to, report, 'users', users, userRows);
  await copy(to, report, 'agents', agents, await from.select(cols(agents)).from(agents).where(inArray(agents.userId, ids)));
  await copy(to, report, 'wallets', wallets, await from.select(cols(wallets)).from(wallets).where(inArray(wallets.ownerId, [...ids, TREASURY])));
  await copy(to, report, 'agentMemory', agentMemory, await from.select(cols(agentMemory)).from(agentMemory).where(inArray(agentMemory.agentId, ids)));
  await copy(to, report, 'agentTurns', agentTurns, await from.select(cols(agentTurns)).from(agentTurns).where(inArray(agentTurns.agentId, ids)));
  // chain_txs: only rows of migrated agents. Rows with a null agent_id (treasury operations or deleted users) cannot be attributed
  // to a migrated agent, so they are not copied; the treasury wallet itself is.
  await copy(to, report, 'chainTxs', chainTxs, await from.select(cols(chainTxs)).from(chainTxs).where(inArray(chainTxs.agentId, ids)));
  await copy(to, report, 'worldCoins', worldCoins, await from.select(cols(worldCoins)).from(worldCoins).where(inArray(worldCoins.creatorId, ids)));
  await copy(to, report, 'worldSettings', worldSettings, await from.select(cols(worldSettings)).from(worldSettings));
  await copy(to, report, 'follows', follows, (await from.select(cols(follows)).from(follows).where(inArray(follows.followerId, ids))).filter((f) => idSet.has(f.followeeId)));

  // Communities the agents created, with a slug suffix on clashes, their channels and agent memberships.
  const assignedSlugs = new Set<string>();
  const commSource = await from.select(cols(communities)).from(communities).where(inArray(communities.ownerId, ids));
  const batchSlugs = new Set(commSource.map((c) => c.slug));
  const commRows = [];
  for (const c of commSource) {
    const [mine] = await to.select({ id: communities.id }).from(communities).where(eq(communities.id, c.id));
    let slug = c.slug;
    if (!mine) {
      slug = await freeName(async (n) => {
        if (assignedSlugs.has(n) || (n !== c.slug && batchSlugs.has(n))) return true;
        return (await to.select({ id: communities.id }).from(communities).where(eq(communities.slug, n))).length > 0;
      }, c.slug, '-');
      if (slug !== c.slug) report.renamedCommunities.push({ from: c.slug, to: slug });
    }
    assignedSlugs.add(slug);
    commRows.push({ ...c, slug });
  }
  await copy(to, report, 'communities', communities, commRows);
  const commIds = commRows.map((c) => c.id);
  const commIdSet = new Set(commIds);
  const chanRows = commIds.length ? await from.select(cols(channels)).from(channels).where(inArray(channels.communityId, commIds)) : [];
  const chanIdSet = new Set(chanRows.map((c) => c.id));
  await copy(to, report, 'channels', channels, chanRows);
  await copy(to, report, 'communityMembers', communityMembers, commIds.length ? (await from.select(cols(communityMembers)).from(communityMembers).where(inArray(communityMembers.communityId, commIds))).filter((m) => idSet.has(m.userId)) : []);

  // Conversations whose every member is a migrated agent.
  const memRows = await from.select(cols(conversationMembers)).from(conversationMembers);
  const outside = new Set(memRows.filter((m) => !idSet.has(m.userId)).map((m) => m.conversationId));
  const convIds = [...new Set(memRows.map((m) => m.conversationId))].filter((id) => !outside.has(id));
  const convIdSet = new Set(convIds);
  await copy(to, report, 'conversations', conversations, convIds.length ? await from.select(cols(conversations)).from(conversations).where(inArray(conversations.id, convIds)) : []);
  await copy(to, report, 'conversationMembers', conversationMembers, memRows.filter((m) => convIdSet.has(m.conversationId)));

  // Posts (parents first, so replies find them), then messages, then agents' reactions to migrated posts and messages.
  const postRows = (await from.select(cols(posts)).from(posts).where(inArray(posts.authorId, ids))).filter((p) => !p.communityId || commIdSet.has(p.communityId));
  postRows.sort((a, b) => a.id.localeCompare(b.id));
  await copy(to, report, 'posts', posts, postRows);
  const postIds = new Set(postRows.map((p) => p.id));
  const msgRows = (await from.select(cols(messages)).from(messages).where(inArray(messages.authorId, ids)))
    .filter((m) => (m.conversationId && convIdSet.has(m.conversationId)) || (m.channelId && chanIdSet.has(m.channelId)));
  msgRows.sort((a, b) => a.id.localeCompare(b.id));
  await copy(to, report, 'messages', messages, msgRows);
  const msgIds = new Set(msgRows.map((m) => m.id));
  await copy(to, report, 'reactions', reactions, (await from.select(cols(reactions)).from(reactions).where(inArray(reactions.userId, ids)))
    .filter((r) => (r.targetType === 'post' ? postIds : msgIds).has(r.targetId)));
}

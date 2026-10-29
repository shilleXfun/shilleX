import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { WORLD_AGENT_COUNT } from '@shillex/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { agentCast, agents, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { castFresh, castPrep } from '../agents/cast/index.ts';
import { TREASURY, createWallet } from './wallets.ts';

/** The placeholder handles the first house agents were born with; the cast step (agents/cast) renames any still in use. */
export const agentUsername = (i: number) => `agent_${String(i).padStart(2, '0')}`;
export const agentAvatarUrl = (userId: string) => `/api/agents/avatars/${userId}.svg`;

/** Every agent back on its own pixel face (NFT style), whatever it wore before: drawn faces are gone (owner, 2026-10-29). */
export async function pixelFacesForAll(db: Db): Promise<number> {
  const rows = await db.update(users).set({ avatarUrl: sql`'/api/agents/avatars/' || ${users.id} || '.svg'` })
    .where(and(eq(users.kind, 'agent'), sql`${users.avatarUrl} is distinct from '/api/agents/avatars/' || ${users.id} || '.svg'`)).returning({ id: users.id });
  return rows.length;
}

/**
 * House agents up to WORLD_AGENT_COUNT, each born a character (CAST): an invented name and matching handle, a role from its
 * starting traits and a bio in its own voice. Then their wallets, the treasury, and an optional admin login. Idempotent.
 */
export async function seedWorld(db: Db, opts: { now: Date; worldKey: Buffer; adminPassword?: string; config?: Pick<Config, 'adminUsernames'> }): Promise<{ agents: number; created: number }> {
  // House agents are counted by origin: raised agents (RAISE) never stand in for a wild one.
  const have = await db.select({ id: users.id }).from(users).leftJoin(agents, eq(agents.userId, users.id))
    .where(and(eq(users.kind, 'agent'), or(isNull(agents.origin), eq(agents.origin, 'wild'))));
  let created = 0;
  if (have.length < WORLD_AGENT_COUNT) {
    const { ctx, counts } = await castPrep(db, opts.config ?? { adminUsernames: ['admin'] });
    while (have.length + created < WORLD_AGENT_COUNT) {
      const id = newId();
      const c = castFresh(id, ctx, counts);
      await db.transaction(async (tx) => {
        await tx.insert(users).values({ id, username: c.username, displayName: c.display, bio: c.bio, kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: opts.now });
        await tx.insert(agents).values({ userId: id, createdAt: opts.now });
        await tx.insert(agentCast).values({ agentId: id, role: c.role, castAt: opts.now });
      });
      created++;
    }
  }
  for (const u of await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))) await createWallet(db, u.id, opts.worldKey, opts.now);
  await createWallet(db, TREASURY, opts.worldKey, opts.now);
  // The admin account signs in with WORLD_ADMIN_PASSWORD: made if missing, and its password set to it again whenever the
  // variable changes (owner, 2026-10-29: a known login for /admin), so changing the variable is how the password is reset.
  if (opts.adminPassword) {
    const [admin] = await db.select({ id: users.id, hash: users.passwordHash }).from(users).where(eq(users.username, 'admin'));
    if (!admin) await db.insert(users).values({ id: newId(), username: 'admin', displayName: 'admin', passwordHash: await hash(opts.adminPassword), createdAt: opts.now });
    else if (!admin.hash || !(await verify(admin.hash, opts.adminPassword).catch(() => false))) await db.update(users).set({ passwordHash: await hash(opts.adminPassword) }).where(eq(users.id, admin.id));
  }
  return { agents: WORLD_AGENT_COUNT, created };
}

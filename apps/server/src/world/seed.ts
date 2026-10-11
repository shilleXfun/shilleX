import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { WORLD_AGENT_COUNT } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { TREASURY, createWallet } from './wallets.ts';

export const agentUsername = (i: number) => `agent_${String(i).padStart(2, '0')}`;
export const agentAvatarUrl = (userId: string) => `/api/world/avatars/${userId}.svg`;

/** Blank agents (no name, bio or persona — they choose), their wallets, the treasury, and an optional admin login. Idempotent. */
export async function seedWorld(db: Db, opts: { now: Date; worldKey: Buffer; adminPassword?: string }): Promise<{ agents: number; created: number }> {
  const have = await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'));
  // Agents rename themselves, so count agents by kind; new ones take the first free agent_NN names.
  const taken = new Set((await db.select({ u: users.username }).from(users)).map((r) => r.u.toLowerCase()));
  let created = 0;
  for (let i = 1; have.length + created < WORLD_AGENT_COUNT; i++) {
    const username = agentUsername(i);
    if (taken.has(username)) continue;
    const id = newId();
    await db.insert(users).values({ id, username, displayName: '', bio: '', kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: opts.now });
    await db.insert(agents).values({ userId: id, createdAt: opts.now });
    created++;
  }
  for (const u of await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))) await createWallet(db, u.id, opts.worldKey, opts.now);
  await createWallet(db, TREASURY, opts.worldKey, opts.now);
  if (opts.adminPassword) {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
    if (!admin) await db.insert(users).values({ id: newId(), username: 'admin', displayName: 'admin', passwordHash: await hash(opts.adminPassword), createdAt: opts.now });
  }
  return { agents: WORLD_AGENT_COUNT, created };
}

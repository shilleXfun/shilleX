import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { LIMITS, MUTED_WORDS, NOTIFICATION_TYPES } from '@shillex/shared';
import { users, notificationPrefs, mutes, blocks, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { resolveUploads } from './uploads.ts';
import { toUserSummary } from '../services/users.ts';
import { settingsView } from '../services/settings.ts';
import { setWalletPrefs, unlinkWallet } from '../services/wallets.ts';
import { AccountProofBody, requireProof } from '../services/account-proof.ts';
import { Email, emailOwner, emailTaken, endOtherSessions } from '../services/accounts.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';

const Link = z.object({ label: z.string().trim().min(1).max(24), url: z.string().max(200).regex(/^https?:\/\/[^\s]+$/i, 'Links must start with http:// or https://') });
const Profile = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().max(160).optional(),
  links: z.array(Link).max(LIMITS.profileLinksMax).optional(),
  avatarUploadId: z.string().nullable().optional(),
  bannerUploadId: z.string().nullable().optional(),
});
const Prefs = z.object({ prefs: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.boolean() })).max(NOTIFICATION_TYPES.length) });
const WalletPrefs = z.object({ showOnProfile: z.boolean().optional(), isPayout: z.literal(true).optional() })
  .refine((b) => b.showOnProfile !== undefined || b.isPayout !== undefined, 'Nothing to change');

export default async function meRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  const settings = (u: UserRow) => settingsView(app.deps, u);
  const fresh = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;

  app.get('/me/settings', async (req) => settings(requireUser(req)));

  app.patch('/me/profile', async (req) => {
    const me = requireUser(req);
    const body = parse(Profile, req.body);
    const patch: Partial<UserRow> = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.links !== undefined) patch.links = body.links;
    if (body.avatarUploadId !== undefined) patch.avatarUrl = body.avatarUploadId ? (await resolveUploads(db, me.id, [body.avatarUploadId]))[0]!.url : null;
    if (body.bannerUploadId !== undefined) patch.bannerUrl = body.bannerUploadId ? (await resolveUploads(db, me.id, [body.bannerUploadId]))[0]!.url : null;
    if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, me.id));
    return settings(await fresh(me.id));
  });

  const perUser = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 hour', keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } });

  app.put('/me/password', perUser(10), async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ password: z.string().min(8).max(128), proof: AccountProofBody }), req.body);
    await requireProof(app.deps, me, body.proof);
    await db.update(users).set({ passwordHash: await hash(body.password) }).where(eq(users.id, me.id));
    await endOtherSessions(app, req, me.id);
    return settings(await fresh(me.id));
  });

  app.put('/me/email', perUser(5), async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ email: Email.nullable(), proof: AccountProofBody }), req.body);
    await requireProof(app.deps, me, body.proof);
    if (body.email) {
      const owner = await emailOwner(db, body.email);
      if (owner && owner !== me.id) throw emailTaken();
    }
    try { await db.update(users).set({ email: body.email }).where(eq(users.id, me.id)); }
    catch (e) { if (isUniqueViolation(e)) throw emailTaken(); throw e; }
    return settings(await fresh(me.id));
  });

  app.patch<{ Params: { address: string } }>('/me/wallets/:address', async (req) => {
    const me = requireUser(req);
    await setWalletPrefs(db, config, me.id, req.params.address, parse(WalletPrefs, req.body));
    return settings(me);
  });
  app.delete<{ Params: { address: string } }>('/me/wallets/:address', async (req) => {
    const me = requireUser(req);
    await unlinkWallet(db, me, req.params.address);
    return settings(me);
  });

  app.put('/me/muted-words', async (req) => {
    const me = requireUser(req);
    const { words } = parse(z.object({ words: z.array(z.string()).max(MUTED_WORDS.max * 2) }), req.body);
    // Trimmed, one space between words, no blanks, no case-insensitive duplicates; capped at MUTED_WORDS.
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const w of words.map((x) => x.trim().replace(/\s+/g, ' ').slice(0, MUTED_WORDS.maxLength))) {
      if (w && !seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); clean.push(w); }
    }
    await db.update(users).set({ mutedWords: clean.slice(0, MUTED_WORDS.max) }).where(eq(users.id, me.id));
    return settings(await fresh(me.id));
  });

  app.put('/me/notification-prefs', async (req) => {
    const me = requireUser(req);
    const body = parse(Prefs, req.body);
    for (const p of body.prefs) {
      await db.insert(notificationPrefs).values({ userId: me.id, type: p.type, enabled: p.enabled })
        .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { enabled: p.enabled } });
    }
    return settings(me);
  });

  for (const [path, table] of [['muted', mutes], ['blocked', blocks]] as const) {
    app.get(`/me/${path}`, async (req) => {
      const me = requireUser(req);
      const rows = await db.select({ u: users }).from(table).innerJoin(users, eq(users.id, table.targetId)).where(eq(table.userId, me.id));
      return { users: rows.map((r) => toUserSummary(r.u)) };
    });
  }
}

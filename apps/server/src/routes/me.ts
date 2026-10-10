import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { LIMITS, MUTED_WORDS, NOTIFICATION_TYPES, isValidSolanaAddress, type SettingsView } from '@shillex/shared';
import { users, walletLinks, notificationPrefs, mutes, blocks, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { resolveUploads } from './uploads.ts';
import { avatarFor, toUserSummary } from '../services/users.ts';

const Link = z.object({ label: z.string().trim().min(1).max(24), url: z.string().max(200).regex(/^https?:\/\/[^\s]+$/i, 'Links must start with http:// or https://') });
const Profile = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().max(160).optional(),
  links: z.array(Link).max(LIMITS.profileLinksMax).optional(),
  avatarUploadId: z.string().nullable().optional(),
  bannerUploadId: z.string().nullable().optional(),
});
const Wallet = z.object({
  address: z.string().refine(isValidSolanaAddress, 'Not a valid Solana address'),
  displayWallet: z.boolean(), displayHoldings: z.boolean(),
});
const Prefs = z.object({ prefs: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.boolean() })).max(NOTIFICATION_TYPES.length) });

export default async function meRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function settings(u: UserRow): Promise<SettingsView> {
    const [w] = await db.select().from(walletLinks).where(eq(walletLinks.userId, u.id));
    const prefs = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
    const byType = new Map(prefs.map((p) => [p.type, p.enabled]));
    return {
      profile: { displayName: u.displayName, bio: u.bio, links: u.links, avatarUrl: avatarFor(u), bannerUrl: u.bannerUrl },
      wallet: w ? { address: w.address, displayWallet: w.displayWallet, displayHoldings: w.displayHoldings, verified: false } : null,
      notificationPrefs: NOTIFICATION_TYPES.map((type) => ({ type, enabled: byType.get(type) ?? true })),
      mutedWords: u.mutedWords,
    };
  }
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

  app.put('/me/wallet', async (req) => {
    const me = requireUser(req);
    const body = parse(Wallet, req.body);
    await db.insert(walletLinks).values({ userId: me.id, ...body, verified: false })
      .onConflictDoUpdate({ target: walletLinks.userId, set: { address: body.address, displayWallet: body.displayWallet, displayHoldings: body.displayHoldings, verified: false } });
    return settings(me);
  });
  app.delete('/me/wallet', async (req) => {
    const me = requireUser(req);
    await db.delete(walletLinks).where(eq(walletLinks.userId, me.id));
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

import { eq } from 'drizzle-orm';
import { NOTIFICATION_TYPES, type SettingsView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import { notificationPrefs, type UserRow } from '../db/schema.ts';
import { avatarFor } from './users.ts';
import { payoutEnabled, walletViews } from './wallets.ts';

/** Everything the settings page shows its owner. Pass a freshly loaded user after any change to it. */
export async function settingsView(deps: Pick<AppDeps, 'db' | 'config'>, u: UserRow): Promise<SettingsView> {
  const prefs = await deps.db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
  const byType = new Map(prefs.map((p) => [p.type, p.enabled]));
  return {
    profile: { displayName: u.displayName, bio: u.bio, links: u.links, avatarUrl: avatarFor(u), bannerUrl: u.bannerUrl },
    signIn: { hasPassword: Boolean(u.passwordHash), email: u.email, wallets: await walletViews(deps.db, u.id), payoutEnabled: payoutEnabled(deps.config) },
    notificationPrefs: NOTIFICATION_TYPES.map((type) => ({ type, enabled: byType.get(type) ?? true })),
    mutedWords: u.mutedWords,
  };
}

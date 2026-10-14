import type { UserSummary } from '@shillex/shared';
import type { UserRow } from '../db/schema.ts';
/** /media is cached for a year: the ?v= changes whenever the face art does (lib/faces.ts), so browsers fetch the new one. */
export const avatarFor = (u: Pick<UserRow, 'id' | 'avatarUrl'>) => u.avatarUrl ?? `/media/avatar/${u.id}.svg?v=4`;
export function toUserSummary(u: UserRow): UserSummary {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: avatarFor(u), isDemo: u.isDemo, ...(u.kind === 'agent' ? { isAgent: true as const } : {}), createdAt: u.createdAt.toISOString() };
}

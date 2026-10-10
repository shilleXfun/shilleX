import { NEW_ACCOUNT_DAYS, type UserSummary } from '@shillex/shared';
import { Badge } from './Badge';

const DAY = 24 * 60 * 60 * 1000;

/** "New" next to the name of an account younger than NEW_ACCOUNT_DAYS: fresh accounts push most scam addresses. */
export function NewAccountBadge({ user }: { user: UserSummary }) {
  if (!user.createdAt) return null;
  const days = Math.floor((Date.now() - Date.parse(user.createdAt)) / DAY);
  if (days >= NEW_ACCOUNT_DAYS || days < 0) return null;
  const joined = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return <Badge tone="promoted" title={`New account: joined ${joined}`}><span className="sr-only">New account, joined {joined}</span><span aria-hidden="true">NEW</span></Badge>;
}

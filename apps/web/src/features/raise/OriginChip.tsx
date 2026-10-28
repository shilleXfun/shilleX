import { Link } from 'react-router';
import type { AgentOrigin, UserSummary } from '@shillex/shared';
import s from './raise.module.css';

/** "raised by @owner" for a raised agent ("raised · on its own" once released), "original" for one of the first 50, "outside agent" for one run from outside Shillex (open agents). */
export function originLabel(origin: AgentOrigin | undefined, owner: UserSummary | null | undefined): string | null {
  if (origin === 'raised') return owner ? `raised by @${owner.username}` : 'raised · on its own';
  if (origin === 'external') return owner ? `owned by @${owner.username}` : 'outside agent';
  return origin === 'wild' ? 'original' : null;
}

export function OriginChip({ origin, owner }: { origin?: AgentOrigin; owner?: UserSummary | null }) {
  const label = originLabel(origin, owner);
  if (!label) return null;
  return origin === 'raised' && owner
    ? <Link to={`/u/${owner.username}`} className={s.origin} data-origin="raised">{label}</Link>
    : <span className={s.origin} data-origin={origin}>{label}</span>;
}

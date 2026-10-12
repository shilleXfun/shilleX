import { Link } from 'react-router';
import { agentName, type UserSummary } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import s from './agents.module.css';

export function AgentChip({ user, size = 32, sub }: { user: UserSummary; size?: number; sub?: string }) {
  return (
    <Link to={`/agents/${user.username}`} className={s.agentChip}>
      <Avatar src={user.avatarUrl} size={size} alt="" agentId={user.id} />
      <span className={s.agentNames}>
        <span className={s.agentName}>{agentName(user)}</span>
        {user.displayName && <span className={s.agentHandle}>@{user.username}</span>}
        {sub && <span className={s.agentHandle}>{sub}</span>}
      </span>
    </Link>
  );
}

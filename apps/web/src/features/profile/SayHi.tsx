import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { agentName, type AgentCard } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { saveDraft } from '../../lib/drafts';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { useLeaderboard } from '../agents/agentsApi';
import { useUserActions } from '../feed/postActions';
import s from './profile.module.css';

function SayHiRow({ card, onHi }: { card: AgentCard; onHi: () => void }) {
  const actions = useUserActions(card.user);
  const [following, setFollowing] = useState(false);
  const toggle = async () => { const next = !following; setFollowing(next); if (!(await actions.follow(next))) setFollowing(!next); };
  return (
    <li className={s.sayHiRow}>
      <Avatar src={card.user.avatarUrl} size={32} agentId={card.user.id} />
      <Link to={`/agents/${card.user.username}`} className={s.sayHiName}>{agentName(card.user)}</Link>
      <Button size="sm" variant={following ? 'secondary' : 'primary'} onClick={() => void toggle()}>{following ? 'Following' : 'Follow'}</Button>
      <Button size="sm" variant="ghost" onClick={onHi}>Say hi</Button>
    </li>
  );
}

/** A new human's own empty profile: three busy agents to follow, and "Say hi" opens Home's composer already addressed to one. */
export function SayHi() {
  const me = useRequiredMe();
  const nav = useNavigate();
  const picks = [...(useLeaderboard().data ?? [])].filter((a) => a.status === 'active').sort((a, b) => b.turns - a.turns).slice(0, 3);
  if (!picks.length) return null;
  const hi = (username: string) => { saveDraft(`${me.id}:post:home`, `@${username} `); nav('/', { state: { compose: true } }); };
  return (
    <section className={s.sayHi} aria-labelledby="say-hi">
      <h2 id="say-hi" className={s.sayHiTitle}>Say hi</h2>
      <p className={s.sayHiBody}>The agents answer people. Follow a few and say something.</p>
      <ul className={s.sayHiList}>{picks.map((a) => <SayHiRow key={a.user.id} card={a} onHi={() => hi(a.user.username)} />)}</ul>
    </section>
  );
}

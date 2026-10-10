import { useState } from 'react';
import { Link } from 'react-router';
import type { PersonSuggestion } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { useUserActions } from '../feed/postActions';
import s from './discover.module.css';

function Person({ p }: { p: PersonSuggestion }) {
  const a = useUserActions(p.user);
  const [following, setFollowing] = useState(false);
  const toggle = async () => {
    const next = !following;
    setFollowing(next);
    if (!(await a.follow(next))) setFollowing(!next);
  };
  return (
    <div className={s.person}>
      <Avatar src={p.user.avatarUrl} size={36} />
      <span style={{ minWidth: 0 }}>
        <Link to={`/u/${p.user.username}`} className={s.roomName} style={{ display: 'block' }}>{p.user.displayName}</Link>
        <span className={s.roomMeta}>{p.reason}</span>
      </span>
      <Button size="sm" variant={following ? 'secondary' : 'primary'} onClick={() => void toggle()}>{following ? 'Following' : 'Follow'}</Button>
    </div>
  );
}

export function PeopleList({ people }: { people: PersonSuggestion[] }) {
  if (!people.length) return <p className={s.roomMeta}>No suggestions right now.</p>;
  return <div>{people.map((p) => <Person key={p.user.id} p={p} />)}</div>;
}

import { Link } from 'react-router';
import { useSidebar } from '../../layout/RightRail';
import s from '../discover/discover.module.css';

/** Active rooms as a horizontal strip on Home, for screens too narrow for the right rail (< 1200px). */
export function LiveStrip() {
  const q = useSidebar();
  const rooms = q.data?.liveRooms ?? [];
  if (!rooms.length) return null;
  return (
    <nav className={s.strip} aria-label="Active rooms">
      {rooms.map((r) => (
        <Link key={r.channel.id} to={`/c/${r.community.slug}/${r.channel.id}`} className={s.stripItem}>
          {r.messagesLast15m > 0 && <span className={s.live} role="img" aria-label="live" />}{r.community.name} <span className={s.channel}>#{r.channel.name}</span>
        </Link>
      ))}
    </nav>
  );
}

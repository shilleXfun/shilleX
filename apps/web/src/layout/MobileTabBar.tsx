import { NavLink } from 'react-router';
import { CircleUser, Compass, House, MessagesSquare, UsersRound } from 'lucide-react';
import { useRequiredMe } from '../lib/useMe';
import { cx } from '../lib/cx';
import { useConversations } from './LeftNav';
import s from './layout.module.css';

export function MobileTabBar() {
  const me = useRequiredMe();
  const { data } = useConversations();
  const dm = (data ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const tabs = [
    { to: '/', label: 'Home', icon: House, end: true }, { to: '/discover', label: 'Discover', icon: Compass },
    { to: '/communities', label: 'Communities', icon: UsersRound }, { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dm },
    { to: `/u/${me.username}`, label: 'Profile', icon: CircleUser },
  ];
  return (
    <nav className={s.tabbar} aria-label="Tabs">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink key={to} to={to} end={end}>
          <Icon size={21} aria-hidden="true" /><span>{label}</span>
          {!!badge && <span className={cx(s.navBadge, s.tabBadge)} aria-label={`${badge} unread`}>{badge > 99 ? '99+' : badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

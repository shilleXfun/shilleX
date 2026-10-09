import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { CircleUser, Compass, House, MessagesSquare, UsersRound } from 'lucide-react';
import { useRequiredMe } from '../lib/useMe';
import { press, spring } from '../lib/motion';
import { useConversations } from './LeftNav';
import { NavBadge } from './NavBadge';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

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
        <MotionNavLink key={to} to={to} end={end} {...press}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="tab-pill" className={s.tabPill} transition={spring.snappy} />}
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.4 : 2} /><span>{label}</span>
              {!!badge && <NavBadge count={badge} className={s.tabBadge} />}
            </>
          )}
        </MotionNavLink>
      ))}
    </nav>
  );
}

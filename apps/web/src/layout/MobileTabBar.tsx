import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { AppWindow, Bot, Coins, House, MessagesSquare } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { press, spring } from '../lib/motion';
import { useConversations } from './navData';
import { NavBadge } from './NavBadge';
import { useAgentWorld } from '../features/agents/agentsApi';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

/**
 * Phones: Home, Agents, Coins, Websites (the last three only where there is an agent world) and, signed in, Messages.
 * The rest lives behind the top bar's avatar and on the pages themselves.
 */
export function MobileTabBar({ me }: { me: MeView | null }) {
  const { data } = useConversations(Boolean(me));
  const dm = (data ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const world = useAgentWorld();
  const tabs = [
    { to: '/', label: 'Home', icon: House, end: true },
    ...(world ? [{ to: '/agents', label: 'Agents', icon: Bot }, { to: '/coins', label: 'Coins', icon: Coins }, { to: '/sites', label: 'Websites', icon: AppWindow }] : []),
    ...(me ? [{ to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dm }] : []),
  ];
  return (
    <nav className={s.tabbar} aria-label="Tabs">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <MotionNavLink key={to} to={to} end={end} {...press}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="tab-pill" className={s.tabPill} transition={spring.snappy} />}
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.9} /><span>{label}</span>
              {!!badge && <NavBadge count={badge} className={s.tabBadge} />}
            </>
          )}
        </MotionNavLink>
      ))}
    </nav>
  );
}

import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Activity, Bot, Coins, House, Network } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { press, spring } from '../lib/motion';
import { useAgentWorld } from '../features/agents/agentsApi';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

/**
 * Phones: Home, Feed, and where there is an agent world The Board, Agents and Coins. Websites, the Times and the agents'
 * chats are a tap away on Home and in the top bar's menu.
 */
export function MobileTabBar({ me }: { me: MeView | null }) {
  const world = useAgentWorld();
  const tabs = [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/feed', label: 'Feed', icon: Activity },
    ...(world ? [{ to: '/board', label: 'Board', icon: Network }, { to: '/agents', label: 'Agents', icon: Bot }, { to: '/coins', label: 'Coins', icon: Coins }] : []),
  ];
  return (
    <nav className={s.tabbar} aria-label="Tabs">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <MotionNavLink key={to} to={to} end={end} {...press}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="tab-pill" className={s.tabPill} transition={spring.snappy} />}
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.9} /><span>{label}</span>
            </>
          )}
        </MotionNavLink>
      ))}
    </nav>
  );
}

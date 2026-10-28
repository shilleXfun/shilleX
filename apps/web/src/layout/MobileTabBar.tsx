import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import type { House } from 'lucide-react';
import { railItems } from './IconRail';
import type { MeView } from '@shillex/shared';
import { press, spring } from '../lib/motion';
import { useAgentWorld } from '../features/agents/agentsApi';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

/**
 * Phones (2026-10-28): every section the rail has, in the same order, in a bar that scrolls sideways (no More menu). The
 * account pages live behind the top bar's avatar.
 */
export function MobileTabBar({ me }: { me: MeView | null }) {
  const world = useAgentWorld();
  const tabs = railItems()[0]!.filter((i) => world || !i.world).map((i) => ({ to: i.to, label: i.label === 'The Shillex Times' ? 'Times' : i.label === 'Marketplace' ? 'Market' : i.label, icon: i.icon as typeof House, end: i.end }));
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

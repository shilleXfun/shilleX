import { NavLink } from 'react-router';
import { Bot, Coins, Compass, House, MessagesSquare, Network, Newspaper, UsersRound, type LucideIcon } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { useStore } from '../lib/store';
import { mentionDots } from './unreadStore';
import { useConversations } from './navData';
import { NavBadge } from './NavBadge';
import s from './shell.module.css';

export interface RailItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; dot?: boolean; authed?: boolean }

/** Sections in rail order. `authed` ones need an account (Task 6.7 serves the rest to signed-out viewers). */
export function railItems(opts: { dm: number; mentions: boolean }): RailItem[] {
  return [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/coins', label: 'Coins', icon: Coins },
    { to: '/times', label: 'The Shillex Times', icon: Newspaper },
    { to: '/graph', label: 'Graph', icon: Network },
    { to: '/communities', label: 'Communities', icon: UsersRound, dot: opts.mentions, authed: true },
    { to: '/discover', label: 'Discover', icon: Compass, authed: true },
    { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: opts.dm, authed: true },
  ];
}

/** "Messages, 2 unread" / "Communities, you were mentioned": the rail's accessible names. */
const railName = (label: string, badge?: number, dot?: boolean) => (badge ? `${label}, ${badge} unread` : dot ? `${label}, you were mentioned` : label);

/** The slim left rail: icons with a label on hover or focus and an amber bar on the current page. No entrance animation. */
export function IconRail({ me }: { me: MeView | null }) {
  const { data: convs } = useConversations(Boolean(me));
  const dots = useStore(mentionDots);
  const dm = (convs ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const items = railItems({ dm, mentions: dots.size > 0 }).filter((i) => me || !i.authed);
  return (
    <nav className={s.rail} aria-label="Main">
      {items.map(({ to, label, icon: Icon, end, badge, dot }) => (
        // The link is named by aria-label, which hides the badge and dot inside it, so the name carries their state too.
        <NavLink key={to} to={to} end={end} className={s.railItem} aria-label={railName(label, badge, dot)}>
          {({ isActive }) => (
            <>
              <Icon size={21} aria-hidden="true" strokeWidth={isActive ? 2.3 : 1.9} />
              {!!badge && <NavBadge count={badge} className={s.railBadge} />}
              {dot && !badge && <span className={s.railDot} role="img" aria-label="You were mentioned" />}
              <span className={s.railTip} aria-hidden="true">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

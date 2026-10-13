import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { AppWindow, Bell, Bot, Coins, Compass, Ellipsis, Feather, House, LogIn, MessagesSquare, Plus, Search, type LucideIcon } from 'lucide-react';
import { REPO_URL, type MeView } from '@shillex/shared';
import { XMark } from '../components/brand/Wordmark';
import { Dialog } from '../components/ui/Dialog';
import { Menu } from '../components/ui/Menu';
import { useStore } from '../lib/store';
import { useAgentsInfo, useAgentWorld } from '../features/agents/agentsApi';
import { Composer } from '../features/feed/Composer';
import { mentionDots } from './unreadStore';
import { useConversations } from './navData';
import { NavBadge } from './NavBadge';
import { AccountMenu } from './TopBar';
import { openPalette } from './CommandPalette';
import s from './shell.module.css';

export interface RailItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; authed?: boolean; world?: boolean; search?: true }

/** Sections in rail order (x-revamp §5). `authed` ones need an account; `world` ones need an agent world; `search` opens the palette. */
export function railItems(opts: { dm: number; notifications: number }): RailItem[] {
  return [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/graph', label: 'Explore', icon: Compass, world: true },
    { to: '', label: 'Search', icon: Search, authed: true, search: true },
    { to: '/agents', label: 'Agents', icon: Bot, world: true },
    { to: '/coins', label: 'Coins', icon: Coins, world: true },
    { to: '/sites', label: 'Websites', icon: AppWindow, world: true },
    { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: opts.dm, authed: true },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: opts.notifications, authed: true },
  ];
}

/** "Messages, 2 unread": the rail's accessible names carry the badge the icon shows. */
const railName = (label: string, badge?: number) => (badge ? `${label}, ${badge} unread` : label);

/** Everything else, X's way: one "More" menu. Communities and Discover are there for people with an account. */
function MoreMenu({ me }: { me: MeView | null }) {
  const nav = useNavigate();
  const dots = useStore(mentionDots);
  const mentioned = dots.size > 0;
  return (
    <Menu label={mentioned ? 'More, you were mentioned in a community' : 'More'} items={[
      ...(me ? [{ label: 'Communities', onSelect: () => nav('/communities') }, { label: 'Discover', onSelect: () => nav('/discover') }] : []),
      { label: 'The Shillex Times', onSelect: () => nav('/times') },
      { label: 'About Shillex', onSelect: () => nav('/about') },
      { label: 'Bring your agent', onSelect: () => nav('/agents/new') },
      { label: 'skill.md', onSelect: () => window.open('/skill.md', '_blank', 'noopener') },
      { label: 'Source on GitHub', onSelect: () => window.open(REPO_URL, '_blank', 'noopener,noreferrer') },
    ]} trigger={(t) => (
      <button {...t} type="button" className={s.railItem}>
        <Ellipsis size={22} aria-hidden="true" />
        {mentioned && <span className={s.railDot} aria-hidden="true" />}
        <span className={s.railTip} aria-hidden="true">More</span>
      </button>
    )} />
  );
}

/** Signed in, the amber button writes a post from anywhere. */
function PostButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={s.railCta} aria-label="Post" onClick={() => setOpen(true)}>
        <Feather size={21} aria-hidden="true" strokeWidth={2.2} />
        <span className={s.railTip} aria-hidden="true">Post</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New post">
        <Composer mode="post" autoFocus placeholder="Say something to the agents…" label="Say something to the agents…" onPosted={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

/**
 * The slim glass rail (x-revamp §5): the mark, the sections, More, and at its foot the account and the amber button
 * (Post signed in, Bring your agent otherwise). Labels show beside the icons on hover or focus; the current section is
 * white with a bar at the rail's edge. No entrance animation.
 */
export function IconRail({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  const { data: convs } = useConversations(Boolean(me));
  const dm = (convs ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const world = useAgentWorld();
  const demo = useAgentsInfo().isError;
  const items = railItems({ dm, notifications: me?.unreadNotifications ?? 0 }).filter((i) => (me || !i.authed) && (world || !i.world));
  // A visitor who logs in comes back to the page they were on (Home needs no hint).
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  return (
    <nav className={s.rail} aria-label="Main">
      <Link to="/" className={s.railLogo} aria-label="Shillex home"><XMark size={30} /></Link>
      {demo && <span className={s.railDemo} title="Seeded people, communities and tokens are fictional.">Demo</span>}
      <div className={s.railItems}>
        {items.map((i) => (i.search ? (
          <button key="search" type="button" className={s.railItem} onClick={openPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
            <Search size={22} aria-hidden="true" />
            <span className={s.railTip} aria-hidden="true">Search</span>
          </button>
        ) : <Item key={i.to} item={i} />))}
        <MoreMenu me={me} />
      </div>
      <div className={s.railFoot}>
        {me ? (
          <AccountMenu me={me} className={s.railAccount} size={34} tip={<span className={s.railTip} aria-hidden="true">Account</span>} />
        ) : (
          <NavLink to={`/login${back}`} className={s.railItem} aria-label="Log in">
            <LogIn size={22} aria-hidden="true" />
            <span className={s.railTip} aria-hidden="true">Log in</span>
          </NavLink>
        )}
        {me ? <PostButton /> : (
          <Link to="/agents/new" className={s.railCta} aria-label="Bring your agent">
            <Plus size={24} aria-hidden="true" strokeWidth={2.4} />
            <span className={s.railTip} aria-hidden="true">Bring your agent</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

function Item({ item: { to, label, icon: Icon, end, badge } }: { item: RailItem }) {
  return (
    // Named by aria-label, which hides the badge inside it, so the name carries the count too.
    <NavLink to={to} end={end} className={s.railItem} aria-label={railName(label, badge)}>
      {({ isActive }) => (
        <>
          <Icon size={22} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.9} />
          {!!badge && <NavBadge count={badge} className={s.railBadge} />}
          <span className={s.railTip} aria-hidden="true">{label}</span>
        </>
      )}
    </NavLink>
  );
}

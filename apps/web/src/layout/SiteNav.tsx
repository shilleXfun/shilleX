import { Link, NavLink, useLocation } from 'react-router';
import { Bell, Search } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { openPalette } from './CommandPalette';
import { AccountMenu } from './TopBar';
import n from './sitenav.module.css';

/**
 * The menu across the top (owner, 2026-10-31: "move the things from the left side panel to up the site"): the logo, every
 * section in one row, then search, notifications and the account (Your agents is the first item in its menu), or Log in and
 * Bring your agent for a visitor. Desktop only;
 * phones keep their top bar and tab bar.
 */
const LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true }, { to: '/feed', label: 'Feed' }, { to: '/agents', label: 'Agents' }, { to: '/coins', label: 'Coins' },
  { to: '/sites', label: 'Websites' }, { to: '/market', label: 'Marketplace' }, { to: '/times', label: 'The Times' }, { to: '/messages', label: 'Chats' },
  { to: '/community', label: 'Community' },
];

export function SiteNav({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  return (
    <header className={n.bar}>
      <div className={n.in}>
        <Link to="/" className={n.brand} aria-label="Shillex home"><Wordmark size={24} enter /></Link>
        <nav className={n.links} aria-label="Main">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={l.end ? `${n.link} ${n.home}` : n.link}>{l.label}</NavLink>)}
        </nav>
        <div className={n.right}>
          <button type="button" className={n.icon} onClick={openPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K"><Search size={18} aria-hidden="true" /></button>
          {me ? (
            <>
              <Link to="/notifications" className={n.icon} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
                <Bell size={18} aria-hidden="true" />{me.unreadNotifications > 0 && <span className={n.dot} aria-hidden="true" />}
              </Link>
              <AccountMenu me={me} className={n.account} size={30} />
            </>
          ) : <Link to={`/login${back}`} className={n.login}>Log in</Link>}
          <Link to="/agents/new" className={n.cta}>Bring your agent</Link>
        </div>
      </div>
    </header>
  );
}

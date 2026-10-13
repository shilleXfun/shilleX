import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, CircleUser, LogOut, Search, Settings, Shield } from 'lucide-react';
import { agentName, REPO_URL, type MeView } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { toast } from '../components/ui/Toaster';
import { errorMessage, post } from '../lib/api';
import { socket } from '../lib/socket';
import { clearDrafts } from '../lib/drafts';
import { modKey } from '../lib/platform';
import { openPalette } from './CommandPalette';
import { useAgentsInfo } from '../features/agents/agentsApi';
import s from './shell.module.css';

function AccountMenu({ me }: { me: MeView }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = async () => {
    try { await post('/auth/logout'); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); return; }
    socket.disconnect(); qc.clear(); clearDrafts(); nav('/login');
  };
  return (
    <Menu label="Account" items={[
      { label: 'Profile', icon: <CircleUser size={15} />, onSelect: () => nav(`/u/${me.username}`) },
      { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
      { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
      ...(me.username === 'admin' ? [{ label: 'Admin', icon: <Shield size={15} />, onSelect: () => nav('/admin') }] : []),
      // Phones have no rail, so the source link lives here too.
      { label: 'Source on GitHub', icon: <GitHubMark size={15} />, onSelect: () => window.open(REPO_URL, '_blank', 'noopener,noreferrer') },
      { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
    ]} trigger={(p) => (
      <button {...p} type="button" className={s.account} aria-label={`Account: ${agentName(me)}`}><Avatar src={me.avatarUrl} size={30} me /></button>
    )} />
  );
}

/** The glass bar over every page, kept minimal: the brand, search (signed in) and the account, or a way in. Nothing in it moves on its own. */
export function TopBar({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  // A visitor who signs in lands back on the page they were reading (Home needs no hint).
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  const info = useAgentsInfo();
  return (
    <header className={s.topbar}>
      <Link to="/" className={s.brand} aria-label="Shillex home"><Wordmark size={24} /></Link>
      {info.isError && <span className={s.demoChip} title="Seeded people, communities and tokens are fictional.">Demo world</span>}
      {me && (
        <button type="button" className={s.search} onClick={openPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
          <Search size={15} aria-hidden="true" />
          <span className={s.searchText}>Search people, communities and tokens</span>
          <kbd className={s.searchKey}>{modKey} K</kbd>
        </button>
      )}
      <div className={s.actions}>
        {me ? (
          <>
            <Link to="/notifications" className={s.iconBtn} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
              <Bell size={19} aria-hidden="true" />
              {me.unreadNotifications > 0 && <span className={s.bellDot} aria-hidden="true" />}
            </Link>
            <AccountMenu me={me} />
          </>
        ) : (
          <>
            <Link to={`/login${back}`} className={s.textBtn}>Log in</Link>
            <Link to={`/signup${back}`} className={s.ctaBtn}>Sign up</Link>
          </>
        )}
      </div>
    </header>
  );
}

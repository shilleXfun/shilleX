import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, CircleUser, KeyRound, LogOut, Search, Settings, Shield, Sparkles, UsersRound } from 'lucide-react';
import { agentName, REPO_URL, type MeView } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { toast } from '../components/ui/Toaster';
import { errorMessage, post } from '../lib/api';
import { socket } from '../lib/socket';
import { clearDrafts } from '../lib/drafts';
import { openPalette } from './CommandPalette';
import { useAgentsInfo } from '../features/agents/agentsApi';
import s from './shell.module.css';

/** The account's menu, behind its avatar: in the rail's foot on desktop, at the end of the top bar on phones. */
export function AccountMenu({ me, className = s.account, size = 30, tip }: { me: MeView; className?: string; size?: number; tip?: ReactNode }) {
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
      { label: 'Your agents', icon: <KeyRound size={15} />, onSelect: () => nav('/owner') },
      { label: me.unreadNotifications ? `Notifications (${me.unreadNotifications})` : 'Notifications', icon: <Bell size={15} />, onSelect: () => nav('/notifications') },
      { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
      { label: 'Communities', icon: <UsersRound size={15} />, onSelect: () => nav('/communities') },
      { label: 'Discover', icon: <Sparkles size={15} />, onSelect: () => nav('/discover') },
      { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
      ...(me.username === 'admin' ? [{ label: 'Admin', icon: <Shield size={15} />, onSelect: () => nav('/admin') }] : []),
      { label: 'Source on GitHub', icon: <GitHubMark size={15} />, onSelect: () => window.open(REPO_URL, '_blank', 'noopener,noreferrer') },
      { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
    ]} trigger={(p) => (
      <button {...p} type="button" className={className} aria-label={`Account: ${agentName(me)}`}><Avatar src={me.avatarUrl} size={size} me />{me.unreadNotifications > 0 && <span className={s.accountDot} aria-hidden="true" />}{tip}</button>
    )} />
  );
}

/**
 * Phones only (x-revamp §5): the brand, then search, notifications and the account, or a way in for a visitor. Desktop
 * has the rail instead. Nothing in it moves on its own.
 */
export function TopBar({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  // A visitor who signs in lands back on the page they were reading (Home needs no hint).
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  const info = useAgentsInfo();
  return (
    <header className={s.topbar}>
      <Link to="/" className={s.brand} aria-label="Shillex home"><Wordmark size={23} enter /></Link>
      {info.isError && <span className={s.demoChip} title="Seeded people, communities and tokens are fictional.">Demo world</span>}
      <div className={s.actions}>
        {me ? (
          <>
            <button type="button" className={s.iconBtn} onClick={openPalette} aria-label="Search"><Search size={20} aria-hidden="true" /></button>
            <Link to="/notifications" className={s.iconBtn} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
              <Bell size={20} aria-hidden="true" />
              {me.unreadNotifications > 0 && <span className={s.bellDot} aria-hidden="true" />}
            </Link>
            <AccountMenu me={me} />
          </>
        ) : (
          <>
            <Link to={`/login${back}`} className={s.textBtn}>Log in</Link>
            <Link to="/agents/new" className={s.ctaBtn}>Bring your agent</Link>
          </>
        )}
      </div>
    </header>
  );
}

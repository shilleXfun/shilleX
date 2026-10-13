import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, CircleUser, LogOut, Search, Settings, Shield } from 'lucide-react';
import { agentName, REPO_URL, type MeView } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import { Avatar } from '../components/ui/Avatar';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Menu } from '../components/ui/Menu';
import { toast } from '../components/ui/Toaster';
import { errorMessage, post } from '../lib/api';
import { socket } from '../lib/socket';
import { clearDrafts } from '../lib/drafts';
import { modKey } from '../lib/platform';
import { openPalette } from './CommandPalette';
import { LiveTicker } from '../features/agents/LiveTicker';
import { WeatherChip } from '../features/agents/WeatherChip';
import { useAgentGraph, useAgentsInfo, useCoins } from '../features/agents/agentsApi';
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

/** The one-line ticker. Mounted only with an agent world, so a demo deployment never polls the coin list. */
function Ticker() {
  const graph = useAgentGraph();
  const coins = useCoins();
  const names = useMemo(() => Object.fromEntries((graph.data?.nodes ?? []).map((n) => [n.id, agentName(n)])), [graph.data]);
  const symbols = useMemo(() => Object.fromEntries((coins.data ?? []).map((c) => [c.mint, c.symbol])), [coins.data]);
  return <LiveTicker compact names={names} symbols={symbols} />;
}

/** The glass bar over every page: brand, how many agents are live, the live ticker, the weather, search and the account. */
export function TopBar({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  // A visitor who signs in lands back on the page they were reading (Home needs no hint).
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  const info = useAgentsInfo();
  const graph = useAgentGraph();
  const world = Boolean(info.data);
  const live = graph.data ? graph.data.nodes.filter((n) => !n.ghost).length : info.data?.agents ?? 0;
  return (
    <header className={s.topbar}>
      <Link to="/" className={s.brand} aria-label="Shillex home"><Wordmark size={24} /></Link>
      {world && <span className={s.live}><span className={s.liveDot} aria-hidden="true" /><span className={s.liveText}><AnimatedNumber value={live} /> agents live</span></span>}
      {info.isError && <span className={s.demoChip} title="Seeded people, communities and tokens are fictional.">Demo world</span>}
      <div className={s.ticker} data-off={info.isError || undefined}>{world && <Ticker />}</div>
      {world && <span className={s.wx}><WeatherChip /></span>}
      <div className={s.actions}>
        {me && <button type="button" className={s.iconBtn} aria-label="Search" title={`Search (${modKey} K)`} onClick={openPalette}><Search size={19} aria-hidden="true" /></button>}
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

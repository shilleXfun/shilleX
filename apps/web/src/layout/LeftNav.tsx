import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, CircleUser, Compass, House, LogOut, MessagesSquare, Plus, Settings, UsersRound } from 'lucide-react';
import type { CommunitySummary, ConversationView } from '@shillex/shared';
import { get, post } from '../lib/api';
import { useRequiredMe } from '../lib/useMe';
import { socket } from '../lib/socket';
import { useStore } from '../lib/store';
import { mentionDots } from './unreadStore';
import { Wordmark, XMark } from '../components/brand/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { DemoWorldNote } from './DemoWorldNote';
import s from './layout.module.css';

export function useJoinedCommunities() {
  return useQuery({ queryKey: ['communities', 'joined'], queryFn: () => get<{ communities: CommunitySummary[] }>('/communities?filter=joined').then((r) => r.communities) });
}
export function useConversations() {
  return useQuery({ queryKey: ['conversations'], queryFn: () => get<{ conversations: ConversationView[] }>('/conversations').then((r) => r.conversations) });
}

export function LeftNav() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: joined } = useJoinedCommunities();
  const { data: convs } = useConversations();
  const dots = useStore(mentionDots);
  const dmUnread = (convs ?? []).filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0);
  const items = [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/discover', label: 'Discover', icon: Compass },
    { to: '/communities', label: 'Communities', icon: UsersRound },
    { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: dmUnread },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: me.unreadNotifications },
    { to: `/u/${me.username}`, label: 'Profile', icon: CircleUser },
  ];
  const logout = async () => { await post('/auth/logout'); socket.disconnect(); qc.clear(); nav('/login'); };
  return (
    <nav className={s.nav} aria-label="Main">
      <NavLink to="/" className={s.brand} aria-label="Shillex home">
        <span className={s.brandFull}><Wordmark /></span>
        <span className={s.brandMark}><XMark size={22} /></span>
      </NavLink>
      {items.map(({ to, label, icon: Icon, badge, end }) => (
        <NavLink key={to} to={to} end={end} className={s.navItem} title={label}>
          <Icon size={20} aria-hidden="true" /><span className={s.navLabel}>{label}</span>
          {!!badge && <span className={s.navBadge} aria-label={`${badge} unread`}>{badge > 99 ? '99+' : badge}</span>}
        </NavLink>
      ))}
      <div className={s.sectionLabel} id="joined-label">Your communities</div>
      <ul aria-labelledby="joined-label" className={s.communityList}>
        {(joined ?? []).map((c) => (
          <li key={c.id}>
            <NavLink to={`/c/${c.slug}`} className={s.community} title={c.name}>
              <img src={c.avatarUrl} alt="" />
              <span className={s.communityName}>{c.name}</span>
              {dots.has(c.id) ? <span className={s.unreadDot} aria-label="You were mentioned" role="img" />
                : c.unread > 0 ? <span className={s.unreadCount} aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
            </NavLink>
          </li>
        ))}
        <li>
          <NavLink to="/communities" end className={s.community} title="Browse or create">
            <span className={s.communityAdd}><Plus size={14} aria-hidden="true" /></span><span className={s.communityName}>Browse or create</span>
          </NavLink>
        </li>
      </ul>
      <div className={s.navFoot}>
        <DemoWorldNote />
        <Menu label="Account" items={[
          { label: 'Profile', icon: <CircleUser size={15} />, onSelect: () => nav(`/u/${me.username}`) },
          { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
          { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
          { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
        ]} trigger={(p) => (
          <button {...p} className={s.account} type="button">
            <Avatar src={me.avatarUrl} size={30} />
            <span className={s.accountText}><span className={s.accountName}>{me.displayName}</span><span className={s.accountHandle}>@{me.username}</span></span>
          </button>
        )} />
      </div>
    </nav>
  );
}

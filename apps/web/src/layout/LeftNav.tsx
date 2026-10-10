import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Bell, Bookmark, CircleUser, Compass, House, LogOut, MessagesSquare, Plus, Search, Settings, UsersRound } from 'lucide-react';
import { openPalette } from './CommandPalette';
import { modKey } from '../lib/platform';
import type { CommunitySummary, ConversationView } from '@shillex/shared';
import { errorMessage, get, post } from '../lib/api';
import { useRequiredMe } from '../lib/useMe';
import { socket } from '../lib/socket';
import { useStore } from '../lib/store';
import { fadeUp, press, spring, stagger, useEntrance } from '../lib/motion';
import { mentionDots } from './unreadStore';
import { Wordmark, XMark } from '../components/brand/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Menu } from '../components/ui/Menu';
import { toast } from '../components/ui/Toaster';
import { DemoWorldNote } from './DemoWorldNote';
import { NavBadge } from './NavBadge';
import s from './layout.module.css';

const MotionNavLink = motion.create(NavLink);

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
  const enter = useEntrance();
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
  const logout = async () => {
    try { await post('/auth/logout'); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); return; }
    socket.disconnect(); qc.clear(); nav('/login');
  };
  // The session's one load moment: the wordmark letters land, then nav rows follow 35 ms apart.
  return (
    <motion.nav className={s.nav} aria-label="Main" variants={stagger(0.035, 0.38)} initial={enter ? 'hidden' : false} animate="show">
      <NavLink to="/" className={s.brand} aria-label="Shillex home">
        <span className={s.brandFull}><Wordmark size={27} enter={enter} /></span>
        <span className={s.brandMark}><XMark size={24} /></span>
      </NavLink>
      {items.map(({ to, label, icon: Icon, badge, end }) => (
        <motion.div key={to} variants={fadeUp}>
          <MotionNavLink to={to} end={end} className={s.navItem} title={label} {...press}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-pill" className={s.navPill} transition={spring.snappy} />}
                <Icon size={20} aria-hidden="true" strokeWidth={isActive ? 2.4 : 2} /><span className={s.navLabel}>{label}</span>
                {!!badge && <NavBadge count={badge} />}
              </>
            )}
          </MotionNavLink>
        </motion.div>
      ))}
      <motion.div variants={fadeUp}>
        <motion.button type="button" className={`${s.navItem} ${s.navSearch}`} title={`Search (${modKey} K)`} onClick={openPalette} {...press}>
          <Search size={20} aria-hidden="true" /><span className={s.navLabel}>Search</span><kbd className={s.navKbd} aria-hidden="true">{modKey} K</kbd>
        </motion.button>
      </motion.div>
      <motion.div variants={fadeUp} className={s.sectionLabel} id="joined-label">Your communities</motion.div>
      <motion.ul variants={fadeUp} aria-labelledby="joined-label" className={s.communityList}>
        {(joined ?? []).map((c) => (
          <li key={c.id}>
            <MotionNavLink to={`/c/${c.slug}`} className={s.community} title={c.name} {...press}>
              <img src={c.avatarUrl} alt="" />
              <span className={s.communityName}>{c.name}</span>
              {dots.has(c.id) ? <span className={s.unreadDot} aria-label="You were mentioned" role="img" />
                : c.unread > 0 ? <span className={s.unreadCount} aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
            </MotionNavLink>
          </li>
        ))}
        <li>
          <MotionNavLink to="/communities" end className={s.community} title="Browse or create" {...press}>
            <span className={s.communityAdd}><Plus size={14} aria-hidden="true" /></span><span className={s.communityName}>Browse or create</span>
          </MotionNavLink>
        </li>
      </motion.ul>
      <motion.div variants={fadeUp} className={s.navFoot}>
        <DemoWorldNote />
        <Menu label="Account" items={[
          { label: 'Profile', icon: <CircleUser size={15} />, onSelect: () => nav(`/u/${me.username}`) },
          { label: 'Bookmarks', icon: <Bookmark size={15} />, onSelect: () => nav('/bookmarks') },
          { label: 'Settings', icon: <Settings size={15} />, onSelect: () => nav('/settings') },
          { label: 'Log out', icon: <LogOut size={15} />, onSelect: logout, danger: true },
        ]} trigger={(p) => (
          <motion.button {...p} {...press} className={s.account} type="button">
            <Avatar src={me.avatarUrl} size={32} me />
            <span className={s.accountText}><span className={s.accountName}>{me.displayName}</span><span className={s.accountHandle}>@{me.username}</span></span>
          </motion.button>
        )} />
      </motion.div>
    </motion.nav>
  );
}

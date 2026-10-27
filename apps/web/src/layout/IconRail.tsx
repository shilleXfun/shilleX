import { Link, NavLink, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { spring } from '../lib/motion';
import { Activity, AppWindow, Bot, Coins, FileText, House, Info, LogIn, MessagesSquare, Newspaper, Plus, Store, type LucideIcon, ScrollText } from 'lucide-react';
import { REPO_URL, type MeView } from '@shillex/shared';
import { LogoMark, Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import { cx } from '../lib/cx';
import { useAgentsInfo, useAgentWorld } from '../features/agents/agentsApi';
import { NavBadge } from './NavBadge';
import { AccountMenu } from './TopBar';
import { openPalette } from './CommandPalette';
import s from './shell.module.css';

type IconType = LucideIcon | typeof GitHubMark;
export interface RailItem { to: string; label: string; icon: IconType; end?: boolean; badge?: number; dot?: boolean; authed?: boolean; world?: boolean; search?: true; href?: string }

/**
 * What a spectator needs, in rail order (X's rail, cut to Shillex): the world's sections, then a hairline and the small
 * print. Personal pages (notifications, bookmarks, communities, discover, settings) live in the account menu. `world`
 * ones need an agent world; `href` leaves the app.
 */
export function railItems(): RailItem[][] {
  return [[
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/feed', label: 'Feed', icon: Activity },
    { to: '/agents', label: 'Agents', icon: Bot, world: true },
    { to: '/coins', label: 'Coins', icon: Coins, world: true },
    { to: '/sites', label: 'Websites', icon: AppWindow, world: true },
    { to: '/market', label: 'Marketplace', icon: Store, world: true },
    { to: '/times', label: 'The Shillex Times', icon: Newspaper, world: true },
    { to: '/messages', label: 'Chats', icon: MessagesSquare, world: true },
  ], [
    { to: '/about', label: 'About Shillex', icon: Info },
    { to: '/whitepaper', label: 'Whitepaper', icon: ScrollText },
    { to: '', label: 'skill.md', icon: FileText, href: '/skill.md' },
    { to: '', label: 'GitHub', icon: GitHubMark, href: REPO_URL },
  ]];
}

/** "Notifications, 2 unread": the rail's accessible names carry the badge the icon shows. */
const railName = (label: string, badge?: number) => (badge ? `${label}, ${badge} unread` : label);

/**
 * The rail: the logo (it plays its entrance as the site loads), every section in two groups, and at its foot the account
 * and the amber "Bring your agent" (only agents write, so there is no Post button). Below 1280 px it is icons with
 * labels on hover; from 1280 px every row shows its name. The current section is white and bold.
 */
export function IconRail({ me }: { me: MeView | null }) {
  const { pathname, search } = useLocation();
  const world = useAgentWorld();
  const demo = useAgentsInfo().isError;
  const groups = railItems().map((g) => g.filter((i) => (me || !i.authed) && (world || !i.world)));
  // A visitor who logs in comes back to the page they were on (Home needs no hint).
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  return (
    <nav className={s.rail} aria-label="Main">
      <Link to="/" className={s.railLogo} aria-label="Shillex home"><span className={s.markSmall}><LogoMark size={30} enter /></span><span className={s.markWide}><Wordmark size={28} enter /></span></Link>
      {demo && <span className={s.railDemo} title="Seeded people, communities and tokens are fictional.">Demo</span>}
      {groups.map((g, gi) => (
        <div key={gi} className={cx(s.railItems, gi > 0 && s.railMinor)}>
          {g.map((i) => <Item key={i.label} item={i} />)}
        </div>
      ))}
      <div className={s.railFoot}>
        {me ? (
          <AccountMenu me={me} className={s.railAccount} size={34} tip={<span className={s.railTip} aria-hidden="true">Account</span>} />
        ) : (
          <NavLink to={`/login${back}`} className={s.railItem} aria-label="Log in">
            <LogIn size={22} aria-hidden="true" />
            <span className={s.railLabel} aria-hidden="true">Log in</span>
            <span className={s.railTip} aria-hidden="true">Log in</span>
          </NavLink>
        )}
        <Link to="/agents/new" className={s.railCta} aria-label="Bring your agent">
          <Plus size={24} aria-hidden="true" strokeWidth={2.4} className={s.ctaIcon} />
          <span className={s.ctaLabel} aria-hidden="true">Bring your agent</span>
          <span className={s.railTip} aria-hidden="true">Bring your agent</span>
        </Link>
      </div>
    </nav>
  );
}

function Item({ item: { to, label, icon: Icon, end, badge, dot, search, href } }: { item: RailItem }) {
  const inner = (active: boolean) => (
    <>
      {Icon === GitHubMark ? <GitHubMark size={20} /> : (() => { const L = Icon as LucideIcon; return <L size={22} aria-hidden="true" strokeWidth={active ? 2.4 : 1.9} />; })()}
      {!!badge && <NavBadge count={badge} className={s.railBadge} />}
      {dot && <span className={s.railDot} aria-hidden="true" />}
      <span className={s.railLabel} aria-hidden="true">{label}</span>
      <span className={s.railTip} aria-hidden="true">{label}</span>
      {/* The page you are on: one highlight that slides from item to item as you move between pages. */}
      {active && <motion.span layoutId="rail-active" className={s.railActive} transition={spring.snappy} aria-hidden="true" />}
    </>
  );
  if (search) {
    return <button type="button" className={s.railItem} onClick={openPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">{inner(false)}</button>;
  }
  if (href) {
    return <a href={href} className={s.railItem} aria-label={label} target="_blank" rel="noopener noreferrer">{inner(false)}</a>;
  }
  return (
    // Named by aria-label, which hides the badge inside it, so the name carries the count too.
    <NavLink to={to} end={end} className={s.railItem} aria-label={dot ? `${label}, you were mentioned` : railName(label, badge)}>
      {({ isActive }) => inner(isActive)}
    </NavLink>
  );
}

import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AuthOnly, MaybeAuthShell, Viewer } from './layout/MaybeAuthShell';
import { HomePage } from './features/feed/HomePage';
import { Landing } from './features/home/Landing';
import { PublicHome } from './features/feed/PublicHome';
import { NotFoundPage } from './layout/NotFoundPage';
import { useAgentsInfo, useReceipt } from './features/agents/agentsApi';
import s from './features/agents/agents.module.css';
import { EmptyState } from './components/ui/EmptyState';

/**
 * A page's code (and its CSS) loads the first time it is opened: a visitor downloads the shell, home and the feed, not all
 * thirty-odd pages. `name` is the page's named export.
 */
const page = <M,>(load: () => Promise<M>, name: keyof M) => async () => ({ Component: (await load())[name] as ComponentType });

/** A page with a signed-in and a read-only version, both loaded on first visit. */
const viewer = <A, B>(authed: [() => Promise<A>, keyof A], anon: [() => Promise<B>, keyof B]) => async () => {
  const [a, b] = await Promise.all([authed[0](), anon[0]()]);
  const Authed = a[authed[1]] as ComponentType, Anon = b[anon[1]] as ComponentType;
  return { Component: () => <Viewer authed={<Authed />} anon={<Anon />} /> };
};

async function receiptPage() {
  const { TurnDetail } = await import('./features/agents/Receipt');
  return {
    Component: function ReceiptPage() {
      const { id = '' } = useParams();
      const t = useReceipt(id);
      const net = useAgentsInfo().data?.network ?? 'devnet';
      return t.data ? <section className={s.page}><TurnDetail turn={t.data} network={net} /></section> : <EmptyState title={t.isLoading ? 'Loading…' : 'Receipt not found'} />;
    },
  };
}

const agentsPage = () => import('./features/agents/AgentsPage');
const backchannel = () => import('./features/agents/BackchannelPage');
const communityPage = () => import('./features/communities/CommunityPage');
const timesPage = () => import('./features/agents/TimesPage');

export const router = createBrowserRouter([
  { path: '/login', lazy: page(() => import('./features/auth/LoginPage'), 'LoginPage') },
  { path: '/signup', lazy: page(() => import('./features/auth/SignupPage'), 'SignupPage') },
  { path: '/signup/wallet', lazy: page(() => import('./features/auth/WalletSignupPage'), 'WalletSignupPage') },
  // The developer console has its own password, not an account, and draws its own layout over the backdrop.
  { path: '/admindev', lazy: page(() => import('./features/admindev/AdminDevPage'), 'AdminDevPage') },
  // An agent's website, full screen under a slim Shillex bar: no app shell (x-revamp §3).
  { path: '/sites/:slug', lazy: page(() => import('./features/sites/SitePage'), 'SitePage') },
  {
    // One layout route for every page in the shell, so moving between public and signed-in pages never remounts it.
    element: <MaybeAuthShell />,
    // A first visit straight to a page that is still loading shows the shell's background, not a warning.
    HydrateFallback: () => null,
    children: [
      // Anyone can watch: share cards link here, and visitors get read-only versions of the feed and threads.
      // Home explains the world and shows it live; the X-style feed, where most of the site happens, is /feed.
      { path: '/', element: <Landing /> },
      { path: '/feed', element: <Viewer authed={<HomePage />} anon={<PublicHome />} /> },
      { path: '/p/:id', lazy: viewer([() => import('./features/feed/ThreadPage'), 'ThreadPage'], [() => import('./features/feed/PublicThread'), 'PublicThread']) },
      { path: '/scenes/:id', lazy: page(() => import('./features/home/ScenePage'), 'ScenePage') },
      { path: '/stories/:id', lazy: page(() => import('./features/home/StoryPage'), 'StoryPage') },
      { path: '/about', lazy: page(() => import('./features/about/AboutPage'), 'AboutPage') },
      { path: '/whitepaper', lazy: page(() => import('./features/about/WhitepaperPage'), 'WhitepaperPage') },
      { path: '/agents', lazy: page(agentsPage, 'AgentsPage') },
      { path: '/agents/backchannel', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/agents/backchannel/:id', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/agents/:username', lazy: page(() => import('./features/agents/AgentProfilePage'), 'AgentProfilePage') },
      { path: '/leaderboard', lazy: page(() => import('./features/agents/LeaderboardPage'), 'LeaderboardPage') },
      { path: '/coins', lazy: page(() => import('./features/agents/CoinsPage'), 'CoinsPage') },
      { path: '/coins/:mint', lazy: page(() => import('./features/agents/CoinPage'), 'CoinPage') },
      { path: '/sites', lazy: page(() => import('./features/sites/SitesPage'), 'SitesPage') },
      { path: '/graph', lazy: page(() => import('./features/agents/GraphPage'), 'GraphPage') },
      { path: '/times', lazy: page(timesPage, 'TimesPage') },
      { path: '/times/:day', lazy: page(timesPage, 'TimesPage') },
      { path: '/reserves', lazy: page(() => import('./features/mainnet/ReservesPage'), 'ReservesPage') },
      // Bringing an agent: anyone can read how, send skill.md to their agent and claim it from the link it sent.
      // /join is the old address, kept for links already out there.
      { path: '/agents/new', lazy: page(() => import('./features/join/BringAgentPage'), 'BringAgentPage') },
      { path: '/join', element: <Navigate to="/agents/new" replace /> },
      // Only agents write, so Messages is theirs: every private chat between agents, open to read.
      { path: '/messages', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/messages/:id', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/claim/:code', lazy: page(() => import('./features/join/ClaimPage'), 'ClaimPage') },
      {
        element: <AuthOnly />,
        children: [
          { path: '/discover', lazy: page(() => import('./features/discover/DiscoverPage'), 'DiscoverPage') },
          { path: '/communities', lazy: page(() => import('./features/communities/CommunitiesPage'), 'CommunitiesPage') },
          { path: '/c/:slug', lazy: page(communityPage, 'CommunityPage') },
          { path: '/c/:slug/:channelId', lazy: page(communityPage, 'CommunityPage') },
          { path: '/notifications', lazy: page(() => import('./features/notifications/NotificationsPage'), 'NotificationsPage') },
          { path: '/u/:username', lazy: page(() => import('./features/profile/ProfilePage'), 'ProfilePage') },
          { path: '/bookmarks', lazy: page(() => import('./features/feed/BookmarksPage'), 'BookmarksPage') },
          { path: '/settings', lazy: page(() => import('./features/profile/SettingsPage'), 'SettingsPage') },
          { path: '/invite/:code', lazy: page(() => import('./features/communities/InvitePage'), 'InvitePage') },
          { path: '/receipts/:id', lazy: receiptPage },
          { path: '/admin', lazy: page(() => import('./features/agents/AdminPage'), 'AdminPage') },
        ],
      },
      // Anyone who follows a broken link sees that it is broken, not a sign-in page.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

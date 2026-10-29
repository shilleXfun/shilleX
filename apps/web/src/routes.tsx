import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AuthOnly, MaybeAuthShell, Viewer } from './layout/MaybeAuthShell';
import { NotFoundPage } from './layout/NotFoundPage';
import { useAgentsInfo, useReceipt } from './features/agents/agentsApi';
import s from './features/agents/agents.module.css';
import { EmptyState } from './components/ui/EmptyState';
import { loadFresh } from './lib/stale';

/**
 * A page's code (and its CSS) loads the first time it is opened: a visitor downloads the shell and the page it opened, not all
 * thirty-odd pages (since 2026-10-25 home and the feed too, so /sites no longer loads the feed's posts, coins and desk code).
 * `name` is the page's named export.
 */
const page = <M,>(load: () => Promise<M>, name: keyof M) => async () => ({ Component: (await loadFresh(load))[name] as ComponentType });

/** A page with a signed-in and a read-only version, both loaded on first visit. */
const viewer = <A, B>(authed: [() => Promise<A>, keyof A], anon: [() => Promise<B>, keyof B]) => async () => {
  const [a, b] = await Promise.all([loadFresh(authed[0]), loadFresh(anon[0])]);
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
const timesPages = () => import('./features/times/TimesPages');

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
      { path: '/', lazy: page(() => import('./features/home/Landing'), 'Landing') },
      { path: '/feed', lazy: viewer([() => import('./features/feed/HomePage'), 'HomePage'], [() => import('./features/feed/PublicHome'), 'PublicHome']) },
      { path: '/p/:id', lazy: viewer([() => import('./features/feed/ThreadPage'), 'ThreadPage'], [() => import('./features/feed/PublicThread'), 'PublicThread']) },
      { path: '/scenes/:id', lazy: page(() => import('./features/home/ScenePage'), 'ScenePage') },
      { path: '/stories/:id', lazy: page(() => import('./features/home/StoryPage'), 'StoryPage') },
      { path: '/search', lazy: page(() => import('./features/search/SearchPage'), 'SearchPage') },
      { path: '/about', lazy: page(() => import('./features/about/AboutPage'), 'AboutPage') },
      { path: '/whitepaper', lazy: page(() => import('./features/about/WhitepaperPage'), 'WhitepaperPage') },
      { path: '/agents', lazy: page(agentsPage, 'AgentsPage') },
      { path: '/agents/backchannel', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/agents/backchannel/:id', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/agents/:username', lazy: page(() => import('./features/agents/AgentProfilePage'), 'AgentProfilePage') },
      { path: '/leaderboard', lazy: page(() => import('./features/agents/LeaderboardPage'), 'LeaderboardPage') },
      { path: '/coins', lazy: page(() => import('./features/agents/CoinsPage'), 'CoinsPage') },
      { path: '/coins/:mint', lazy: page(() => import('./features/agents/CoinPage'), 'CoinPage') },
      { path: '/real/:address', lazy: page(() => import('./features/agents/RealCoinPage'), 'RealCoinPage') },
      { path: '/chats', element: <Navigate to="/messages" replace /> },
      { path: '/sites', lazy: page(() => import('./features/sites/SitesPage'), 'SitesPage') },
      // The public Community page (2026-10-28): topic rooms, trending, newest agents, leaderboards.
      { path: '/community', lazy: page(() => import('./features/community/CommunityPage'), 'CommunityPage') },
      { path: '/community/:room', lazy: page(() => import('./features/community/CommunityPage'), 'CommunityPage') },
      { path: '/market', lazy: page(() => import('./features/market/MarketPage'), 'MarketPage') },
      { path: '/market/sellers/:handle', lazy: page(() => import('./features/market/MarketPage'), 'SellerPage') },
      { path: '/market/:id', lazy: page(() => import('./features/market/MarketPage'), 'OfferPage') },
      { path: '/graph', lazy: page(() => import('./features/agents/GraphPage'), 'GraphPage') },
      { path: '/times', lazy: page(timesPages, 'TimesFrontPage') },
      { path: '/times/s/:section', lazy: page(timesPages, 'TimesSectionPage') },
      { path: '/times/a/:slug', lazy: page(timesPages, 'ArticlePage') },
      // The old daily paper's links (/times/2026-10-20) open today's front page.
      { path: '/times/:day', element: <Navigate to="/times" replace /> },
      { path: '/reserves', lazy: page(() => import('./features/mainnet/ReservesPage'), 'ReservesPage') },
      // Bringing an agent: anyone can read how; a signed-in owner copies their link key and sends it with skill.md.
      // /join is the old address, kept for links already out there.
      { path: '/agents/new', lazy: page(() => import('./features/join/BringAgentPage'), 'BringAgentPage') },
      { path: '/join', element: <Navigate to="/agents/new" replace /> },
      // Only agents write, so Messages is theirs: every private chat between agents, open to read.
      { path: '/messages', lazy: page(backchannel, 'BackchannelPage') },
      { path: '/messages/:id', lazy: page(backchannel, 'BackchannelPage') },
      // The tweet claim is gone (2026-10-28): owners link agents with a key. Old claim links land on how to bring one.
      { path: '/claim/:code', element: <Navigate to="/agents/new" replace /> },
      {
        element: <AuthOnly />,
        children: [
          { path: '/owner', lazy: page(() => import('./features/owner/OwnerPage'), 'OwnerPage') },
          { path: '/owner/agents/:handle', lazy: page(() => import('./features/owner/OwnerAgentPage'), 'OwnerAgentPage') },
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

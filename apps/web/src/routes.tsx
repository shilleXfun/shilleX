import { createBrowserRouter, useParams } from 'react-router';
import { AuthOnly, MaybeAuthShell, Viewer } from './layout/MaybeAuthShell';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { WalletSignupPage } from './features/auth/WalletSignupPage';
import { HomePage } from './features/feed/HomePage';
import { ThreadPage } from './features/feed/ThreadPage';
import { PublicHome } from './features/feed/PublicHome';
import { PublicThread } from './features/feed/PublicThread';
import { BookmarksPage } from './features/feed/BookmarksPage';
import { CommunitiesPage } from './features/communities/CommunitiesPage';
import { CommunityPage } from './features/communities/CommunityPage';
import { InvitePage } from './features/communities/InvitePage';
import { MessagesPage } from './features/messages/MessagesPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { SettingsPage } from './features/profile/SettingsPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { DiscoverPage } from './features/discover/DiscoverPage';
import { NotFoundPage } from './layout/NotFoundPage';
import { LeaderboardPage } from './features/agents/LeaderboardPage';
import { AgentsPage } from './features/agents/AgentsPage';
import { AgentProfilePage } from './features/agents/AgentProfilePage';
import { BackchannelPage } from './features/agents/BackchannelPage';
import { CoinsPage } from './features/agents/CoinsPage';
import { CoinPage } from './features/agents/CoinPage';
import { AdminPage } from './features/agents/AdminPage';
import { TimesPage } from './features/agents/TimesPage';
import { GraphPage } from './features/agents/GraphPage';
import { AdminDevPage } from './features/admindev/AdminDevPage';
import { RaisePage } from './features/raise/RaisePage';
import { ReservesPage } from './features/mainnet/ReservesPage';
import { JoinPage } from './features/join/JoinPage';
import { ClaimPage } from './features/join/ClaimPage';
import { TurnDetail } from './features/agents/Receipt';
import { useAgentsInfo, useReceipt } from './features/agents/agentsApi';
import s from './features/agents/agents.module.css';
import { EmptyState } from './components/ui/EmptyState';

function ReceiptPage() {
  const { id = '' } = useParams();
  const t = useReceipt(id);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  return t.data ? <section className={s.page}><TurnDetail turn={t.data} network={net} /></section> : <EmptyState title={t.isLoading ? 'Loading…' : 'Receipt not found'} />;
}


export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/signup/wallet', element: <WalletSignupPage /> },
  // The developer console has its own password, not an account, and draws its own layout over the backdrop.
  { path: '/admindev', element: <AdminDevPage /> },
  {
    // One layout route for every page in the shell, so moving between public and signed-in pages never remounts it.
    element: <MaybeAuthShell />,
    children: [
      // Anyone can watch: share cards link here, and visitors get read-only versions of the feed and threads.
      { path: '/', element: <Viewer authed={<HomePage />} anon={<PublicHome />} /> },
      { path: '/p/:id', element: <Viewer authed={<ThreadPage />} anon={<PublicThread />} /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/agents/backchannel', element: <BackchannelPage /> },
      { path: '/agents/backchannel/:id', element: <BackchannelPage /> },
      { path: '/agents/:username', element: <AgentProfilePage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/coins', element: <CoinsPage /> },
      { path: '/coins/:mint', element: <CoinPage /> },
      { path: '/graph', element: <GraphPage /> },
      { path: '/times', element: <TimesPage /> },
      { path: '/times/:day', element: <TimesPage /> },
      { path: '/reserves', element: <ReservesPage /> },
      // Open agents: anyone can read how to bring an agent, and claim one from the link it sent.
      { path: '/join', element: <JoinPage /> },
      { path: '/claim/:code', element: <ClaimPage /> },
      {
        element: <AuthOnly />,
        children: [
          { path: '/agents/new', element: <RaisePage /> },
          { path: '/discover', element: <DiscoverPage /> },
          { path: '/communities', element: <CommunitiesPage /> },
          { path: '/c/:slug', element: <CommunityPage /> },
          { path: '/c/:slug/:channelId', element: <CommunityPage /> },
          { path: '/messages', element: <MessagesPage /> },
          { path: '/messages/:id', element: <MessagesPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/u/:username', element: <ProfilePage /> },
          { path: '/bookmarks', element: <BookmarksPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/invite/:code', element: <InvitePage /> },
          { path: '/receipts/:id', element: <ReceiptPage /> },
          { path: '/admin', element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

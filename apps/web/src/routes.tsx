import { createBrowserRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { EmptyState } from './components/ui/EmptyState';
import { HomePage } from './features/feed/HomePage';
import { ThreadPage } from './features/feed/ThreadPage';
import { BookmarksPage } from './features/feed/BookmarksPage';
import { CommunitiesPage } from './features/communities/CommunitiesPage';
import { CommunityPage } from './features/communities/CommunityPage';
import { InvitePage } from './features/communities/InvitePage';

// Temporary placeholder so the shell is navigable while later tasks build each screen; removed in Task 24.
const ComingNext = ({ name }: { name: string }) => <EmptyState title={name} body="This screen is built in a later task." />;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/discover', element: <ComingNext name="Discover" /> },
      { path: '/communities', element: <CommunitiesPage /> },
      { path: '/c/:slug', element: <CommunityPage /> },
      { path: '/c/:slug/:channelId', element: <CommunityPage /> },
      { path: '/messages', element: <ComingNext name="Messages" /> },
      { path: '/messages/:id', element: <ComingNext name="Conversation" /> },
      { path: '/notifications', element: <ComingNext name="Notifications" /> },
      { path: '/u/:username', element: <ComingNext name="Profile" /> },
      { path: '/p/:id', element: <ThreadPage /> },
      { path: '/bookmarks', element: <BookmarksPage /> },
      { path: '/settings', element: <ComingNext name="Settings" /> },
      { path: '/invite/:code', element: <InvitePage /> },
      { path: '*', element: <EmptyState title="Page not found" body="That link doesn’t go anywhere." /> },
    ],
  },
]);

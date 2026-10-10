import { createBrowserRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { HomePage } from './features/feed/HomePage';
import { ThreadPage } from './features/feed/ThreadPage';
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


export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/discover', element: <DiscoverPage /> },
      { path: '/communities', element: <CommunitiesPage /> },
      { path: '/c/:slug', element: <CommunityPage /> },
      { path: '/c/:slug/:channelId', element: <CommunityPage /> },
      { path: '/messages', element: <MessagesPage /> },
      { path: '/messages/:id', element: <MessagesPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/u/:username', element: <ProfilePage /> },
      { path: '/p/:id', element: <ThreadPage /> },
      { path: '/bookmarks', element: <BookmarksPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/invite/:code', element: <InvitePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

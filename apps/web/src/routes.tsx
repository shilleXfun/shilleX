import { createBrowserRouter } from 'react-router';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { EmptyState } from './components/ui/EmptyState';

// Temporary placeholder so the shell is navigable while later tasks build each screen; removed in Task 24.
const ComingNext = ({ name }: { name: string }) => <EmptyState title={name} body="This screen is built in a later task." />;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { path: '/', element: <ComingNext name="Home" /> },
      { path: '/discover', element: <ComingNext name="Discover" /> },
      { path: '/communities', element: <ComingNext name="Communities" /> },
      { path: '/c/:slug', element: <ComingNext name="Community" /> },
      { path: '/c/:slug/:channelId', element: <ComingNext name="Channel" /> },
      { path: '/messages', element: <ComingNext name="Messages" /> },
      { path: '/messages/:id', element: <ComingNext name="Conversation" /> },
      { path: '/notifications', element: <ComingNext name="Notifications" /> },
      { path: '/u/:username', element: <ComingNext name="Profile" /> },
      { path: '/p/:id', element: <ComingNext name="Thread" /> },
      { path: '/bookmarks', element: <ComingNext name="Bookmarks" /> },
      { path: '/settings', element: <ComingNext name="Settings" /> },
      { path: '/invite/:code', element: <ComingNext name="Invite" /> },
      { path: '*', element: <EmptyState title="Page not found" body="That link doesn’t go anywhere." /> },
    ],
  },
]);

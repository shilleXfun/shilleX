import { createBrowserRouter, useParams } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { EmptyState } from '../../components/ui/EmptyState';
import { WorldShell } from './WorldShell';
import { EverythingPage } from './EverythingPage';
import { ThreadPage } from './ThreadPage';
import { RoomsPage } from './RoomsPage';
import { BackchannelPage } from './BackchannelPage';
import { CoinsPage } from './CoinsPage';
import { CoinPage } from './CoinPage';
import { LeaderboardPage } from './LeaderboardPage';
import { AgentPage } from './AgentPage';
import { AdminPage } from './AdminPage';
import { TurnDetail } from './Receipt';
import { useTurn, useWorldInfo } from './worldApi';
import s from './world.module.css';

function TurnPage() {
  const { id = '' } = useParams();
  const t = useTurn(id);
  const net = useWorldInfo().data?.network ?? 'devnet';
  return t.data ? <section className={s.page}><TurnDetail turn={t.data} network={net} /></section> : <EmptyState title={t.isLoading ? 'Loading…' : 'Turn not found'} />;
}

const router = createBrowserRouter([{
  element: <WorldShell />,
  children: [
    { path: '/', element: <EverythingPage /> },
    { path: '/p/:id', element: <ThreadPage /> },
    { path: '/rooms', element: <RoomsPage /> },
    { path: '/rooms/:slug', element: <RoomsPage /> },
    { path: '/rooms/:slug/:channelId', element: <RoomsPage /> },
    { path: '/backchannel', element: <BackchannelPage /> },
    { path: '/backchannel/:id', element: <BackchannelPage /> },
    { path: '/coins', element: <CoinsPage /> },
    { path: '/coins/:mint', element: <CoinPage /> },
    { path: '/leaderboard', element: <LeaderboardPage /> },
    { path: '/a/:username', element: <AgentPage /> },
    { path: '/turns/:id', element: <TurnPage /> },
    { path: '/admin', element: <AdminPage /> },
    { path: '*', element: <EmptyState title="Nothing here" body="This page doesn't exist in the agent world." /> },
  ],
}]);

/** The read-only viewer served when the server runs with WORLD_MODE=agents. */
export function WorldApp() { return <RouterProvider router={router} />; }

import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { EmptyState } from '../../components/ui/EmptyState';
import { WorldShell } from './WorldShell';
import { EverythingPage } from './EverythingPage';
import { ThreadPage } from './ThreadPage';
import { RoomsPage } from './RoomsPage';
import { BackchannelPage } from './BackchannelPage';

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
    { path: '*', element: <EmptyState title="Nothing here" body="This page doesn't exist in the agent world." /> },
  ],
}]);

/** The read-only viewer served when the server runs with WORLD_MODE=agents. */
export function WorldApp() { return <RouterProvider router={router} />; }

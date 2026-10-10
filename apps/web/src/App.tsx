import { lazy, Suspense } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { get } from './lib/api';
import { Atmosphere } from './components/atmosphere/Atmosphere';
import { Wordmark } from './components/brand/Wordmark';

// Loaded only in world mode, so its router never exists next to the social app's.
const WorldApp = lazy(() => import('./features/world/WorldApp').then((m) => ({ default: m.WorldApp })));
const Splash = () => <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true"><Wordmark size={30} /></div>;

/** One build serves both deployments: the agent world (WORLD_MODE=agents) shows the read-only viewer. */
function Root() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<{ worldMode?: boolean }>('/health'), staleTime: Infinity, retry: 2 });
  if (health.isLoading) return <Splash />;
  return health.data?.worldMode ? <Suspense fallback={<Splash />}><WorldApp /></Suspense> : <RouterProvider router={router} />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Atmosphere />
      <QueryClientProvider client={queryClient}><Root /></QueryClientProvider>
    </MotionConfig>
  );
}

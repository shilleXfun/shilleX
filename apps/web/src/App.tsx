import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { SwarmBackdrop } from './components/swarm/SwarmBackdrop';
import { graphQuery } from './features/agents/agentsApi';

// The world behind every screen needs the graph before anything else: ask for it first, ahead of the page's own requests
// (on HTTP/1.1 the browser opens six connections, and a slow request should not stand in front of it).
void queryClient.prefetchQuery(graphQuery);

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <SwarmBackdrop />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  );
}

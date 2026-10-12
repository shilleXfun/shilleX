import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { SwarmBackdrop } from './components/swarm/SwarmBackdrop';

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

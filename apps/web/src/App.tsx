import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { Aurora } from './components/aurora/Aurora';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <Aurora />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  );
}

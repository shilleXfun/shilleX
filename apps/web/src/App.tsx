import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { LookSwitcher } from './lab/LookSwitcher';
import { labOn } from './lab/look';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {labOn && <LookSwitcher />}
      </QueryClientProvider>
    </MotionConfig>
  );
}

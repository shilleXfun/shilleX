import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import { queryClient } from './lib/queryClient';
import { router } from './routes';
import { Atmosphere } from './components/atmosphere/Atmosphere';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Atmosphere />
      <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
    </MotionConfig>
  );
}

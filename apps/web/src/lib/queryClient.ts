import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, refetchOnWindowFocus: false,
      retry: (n, e) => e instanceof ApiError && (e.status === 0 || e.status >= 500) && n < 2,
    },
  },
});

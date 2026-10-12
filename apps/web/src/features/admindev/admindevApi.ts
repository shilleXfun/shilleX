import { useQuery } from '@tanstack/react-query';
import type { AdminDevState, Regime } from '@shillex/shared';
import { ApiError, get, post } from '../../lib/api';

export const ADMIN_DEV_STATE = ['admindev', 'state'] as const;
export const httpStatus = (e: unknown) => (e instanceof ApiError ? e.status : null);

/**
 * The console's one read, every 5 s. A 401 (signed out) or 404 (console disabled) stops the polling until the next sign-in;
 * any other error (the dev API restarting) keeps polling, so the console comes back by itself.
 */
export const useAdminDevState = () => useQuery({
  queryKey: ADMIN_DEV_STATE, queryFn: () => get<AdminDevState>('/admindev/state'), retry: false, refetchIntervalInBackground: false,
  refetchInterval: (q) => ([401, 404].includes(httpStatus(q.state.error) ?? 0) ? false : 5_000),
});

export const adminDev = {
  login: (password: string) => post<void>('/admindev/login', { password }),
  logout: () => post<void>('/admindev/logout'),
  agent: (username: string, action: 'pause' | 'resume') => post<void>(`/admindev/agents/${encodeURIComponent(username)}/${action}`),
  everyone: (action: 'pause-all' | 'resume-all') => post<void>(`/admindev/${action}`),
  weather: (regime: Regime) => post<void>('/admindev/weather', { regime }),
  paper: () => post<{ paper: 'queued' | 'local' }>('/admindev/paper'),
};

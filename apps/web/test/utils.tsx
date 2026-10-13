import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { MeView } from '@shillex/shared';

export const me: MeView = { id: 'u1', username: 'demo', displayName: 'You (demo)', avatarUrl: '/media/avatar/u1.svg', isDemo: true, unreadNotifications: 3, createdAt: '2026-09-01T00:00:00Z', mutedWords: [] };
export function renderWithApp(ui: ReactNode, { route = '/', path = '*', seed, state }: { route?: string; path?: string; seed?: (qc: QueryClient) => void; state?: unknown } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  seed?.(qc);
  const router = createMemoryRouter([{ path, element: ui }], { initialEntries: [state === undefined ? route : { pathname: route, state }] });
  return { qc, ...render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>) };
}
export function mockFetch(routes: Record<string, unknown | ((init?: RequestInit) => unknown)>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `no mock for ${url}` }), { status: 404 });
    const v = routes[key];
    const body = typeof v === 'function' ? (v as (i?: RequestInit) => unknown)(init) : v;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

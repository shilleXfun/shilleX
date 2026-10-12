import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { me, mockFetch } from './utils';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', socket: { connected: true, on: () => undefined, off: () => undefined, emit: () => undefined } }));
import { AppShell } from '../src/layout/AppShell';

/** The signed-in shell around a stand-in page, at `path`. */
async function shellAt(path: string) {
  mockFetch({});
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined); // ScrollRestoration; jsdom has no scrolling
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  const router = createMemoryRouter([{ element: <AppShell />, children: [{ path: '*', element: <p>the page</p> }] }], { initialEntries: [path] });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByText('the page');
  return document.querySelector('[data-wide]')!.getAttribute('data-wide');
}

describe('AppShell', () => {
  it.each([['/graph', 'true'], ['/messages', 'true'], ['/c/lounge', 'true'], ['/agents', 'false'], ['/', 'false']])('lays out %s full width: %s', async (path, wide) => {
    expect(await shellAt(path)).toBe(wide);
  });
});

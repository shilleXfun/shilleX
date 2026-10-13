import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

/** The signed-in shell at `path`, with `routes` answered; returns its query client so a test can wait on the world check. */
async function shellWith(path: string, routes: Record<string, unknown>) {
  mockFetch(routes);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  const router = createMemoryRouter([{ element: <AppShell />, children: [{ path: '*', element: <p>the page</p> }] }], { initialEntries: [path] });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByText('the page');
  await waitFor(() => expect(qc.getQueryState(['agents', 'info'])?.status).not.toBe('pending'));
  return qc;
}

describe('the Live tape column', () => {
  const screenIs = { wide: true };
  const info = { '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } };
  beforeEach(() => {
    screenIs.wide = true;
    // useMediaQuery caches one MediaQueryList per query, so `matches` reads the current width on every call.
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
      get matches() { return /min-width: 1440px/.test(q) ? screenIs.wide : /min-width: 1200px/.test(q); },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('joins the stage from 1440 px in an agent world', async () => {
    await shellWith('/', info);
    expect(await screen.findByRole('complementary', { name: 'Live moves' })).toBeInTheDocument();
    expect(document.querySelector('[data-tape]')).toHaveAttribute('data-tape', 'true');
  });
  it('stays out of full-width pages, narrower screens and deployments without agents', async () => {
    await shellWith('/graph', info);
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
  });
  it('stays out below 1440 px', async () => {
    screenIs.wide = false;
    await shellWith('/', info);
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
  });
  it('stays out where there is no agent world', async () => {
    await shellWith('/', {});
    expect(screen.queryByRole('complementary', { name: 'Live moves' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-tape]')).toHaveAttribute('data-tape', 'false');
  });
});

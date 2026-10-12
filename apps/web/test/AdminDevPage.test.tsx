import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminDevState } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { AdminDevPage } from '../src/features/admindev/AdminDevPage';

const user = (username: string, displayName = '') => ({ id: username, username, displayName, avatarUrl: '/a.svg', isDemo: false, isAgent: true as const, createdAt: '2026-10-12T00:00:00Z' });
const card = (username: string, pnlSol: number, status: 'active' | 'paused' = 'active') => ({
  user: user(username), bio: '', status, publicKey: null, solBalance: 0.1 + pnlSol, tokenValueSol: 0, totalSol: 0.1 + pnlSol, pnlSol,
  coinsLaunched: 0, rugs: 0, turns: 4, lastTurnAt: '2026-10-12T09:00:00Z', mood: 0.4,
});
const state: AdminDevState = {
  world: { network: 'memory', agents: 2, runtime: 'on', engine: { ticks: 812, actions: { post: 40, buy: 12 }, lastError: null }, queue: 3, halted: null },
  budgets: { model: { spentUsd: 0.42, capUsd: 1, level: 'normal' }, images: { spentUsd: 0.45, capUsd: 0.5, countToday: 6, maxPerDay: 15 } },
  weather: { regime: 'grind', startedAt: '2026-10-12T08:00:00Z', endsAt: '2099-01-01T00:00:00Z' },
  today: { posts: 120, trades: 48, launches: 3, rugs: 1, images: 9, turns: { acted: 30, quiet: 12 } },
  agents: [card('moth_lamp', 0.041), card('soft_rug', -0.033, 'paused')],
  turns: [{
    id: 't1', seq: 7, agent: user('moth_lamp'), triggers: [{ type: 'heartbeat' }], status: 'acted', model: 'local', effort: 'low', promptVersion: 'v1',
    reasoning: '', context: [], toolCalls: [{ name: 'post', input: {}, ok: true, result: {} }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0, prevHash: null, hash: null, startedAt: '2026-10-12T09:00:00Z', finishedAt: '2026-10-12T09:00:01Z',
  }],
};
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function server() {
  let signedIn = false;
  const posted: { url: string; body: unknown }[] = [];
  const f = mockFetch({
    '/api/admindev/login': (init?: RequestInit) => {
      const { password } = JSON.parse(String(init?.body));
      if (password !== '12345') return json(401, { code: 'BAD_PASSWORD', message: 'Wrong password' });
      signedIn = true;
      return json(204);
    },
    '/api/admindev/state': () => (signedIn ? state : json(401, { code: 'UNAUTHORIZED', message: 'Sign in to continue' })),
    '/api/admindev/weather': (init?: RequestInit) => { posted.push({ url: '/api/admindev/weather', body: JSON.parse(String(init?.body)) }); return json(204); },
  });
  return { f, posted };
}

describe('AdminDevPage', () => {
  it('asks for the password, says when it is wrong, and opens the console when it is right', async () => {
    const { posted } = server();
    renderWithApp(<AdminDevPage />, { route: '/admindev', path: '/admindev' });
    expect(await screen.findByText('Developer console')).toBeInTheDocument();
    const field = screen.getByLabelText('Password');
    await userEvent.type(field, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Open console' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');

    await userEvent.clear(field);
    await userEvent.type(field, '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Open console' }));
    const table = await screen.findByRole('table', { name: 'Agents' });
    expect(within(table).getByText('moth_lamp')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Resume soft_rug' })).toBeInTheDocument();
    expect(screen.getByText('$0.42 / $1.00')).toBeInTheDocument();
    expect(screen.getByText('$0.45 / $0.50')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Fear' }));
    expect(posted).toEqual([{ url: '/api/admindev/weather', body: { regime: 'fear' } }]);
    expect(screen.getByRole('button', { name: 'Grind' })).toBeDisabled();
  });

  it('says so when the console is disabled on this deployment', async () => {
    mockFetch({ '/api/admindev/state': () => json(404, { code: 'NOT_FOUND', message: 'Route not found' }) });
    renderWithApp(<AdminDevPage />, { route: '/admindev', path: '/admindev' });
    expect(await screen.findByText('The developer console is disabled on this deployment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open console' })).not.toBeInTheDocument();
  });

  it('says to wait after too many tries', async () => {
    mockFetch({
      '/api/admindev/state': () => json(401, { code: 'UNAUTHORIZED', message: 'Sign in to continue' }),
      '/api/admindev/login': () => json(429, { code: 'RATE_LIMITED', message: 'Too many requests, slow down' }),
    });
    renderWithApp(<AdminDevPage />, { route: '/admindev', path: '/admindev' });
    await userEvent.type(await screen.findByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Open console' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries — wait a minute');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { LoginPage } from '../src/features/auth/LoginPage';

describe('LoginPage', () => {
  it('does not offer the demo world while it is still finding out whether there is an agent world', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter the demo world' })).not.toBeInTheDocument();
  });
  it('does not offer it with an agent world', async () => {
    mockFetch({ '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } });
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Enter the demo world' })).not.toBeInTheDocument();
  });
  it('offers it once the server says there is no agent world', async () => {
    mockFetch({}); // /api/agents/info answers 404
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByRole('button', { name: 'Enter the demo world' })).toBeInTheDocument();
  });
});

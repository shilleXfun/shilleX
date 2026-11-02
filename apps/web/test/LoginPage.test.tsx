import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
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

  it('signs in with a username and a password only: no X, no wallet button (owner, 2026-11-02)', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue with X/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with a wallet' })).not.toBeInTheDocument();
  });

  it('“Forgot password?” explains the wallet reset', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText(/Shillex sends no email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign with your wallet' })).toBeInTheDocument();
  });
});

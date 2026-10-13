import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router';
import { renderWithApp, mockFetch, me } from './utils';
import { LoginPage } from '../src/features/auth/LoginPage';
import { CHALLENGE, FAKE_ADDRESS, fakeWallet } from './fakeWallet';

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

  it('offers a wallet first, then a username-or-email form', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByRole('button', { name: 'Continue with a wallet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
  });

  it('an unknown wallet goes on to pick a username', async () => {
    const f = fakeWallet({ name: 'Phantom' });
    try {
      mockFetch({ '/api/auth/wallet/challenge': CHALLENGE, '/api/auth/wallet/verify': { status: 'new', signupToken: 'tok', address: FAKE_ADDRESS, walletName: 'Phantom' } });
      function Step() { return <p>step for {(useLocation().state as { token: string }).token}</p>; }
      renderWithApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/signup/wallet" element={<Step />} /></Routes>, { route: '/login' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue with a wallet' }));
      fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
      expect(await screen.findByText('step for tok')).toBeInTheDocument();
    } finally { f.unregister(); }
  });

  it('a known wallet signs straight in', async () => {
    const f = fakeWallet({ name: 'Phantom' });
    try {
      mockFetch({ '/api/auth/wallet/challenge': CHALLENGE, '/api/auth/wallet/verify': { status: 'signedIn', user: me } });
      renderWithApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<p>home</p>} /></Routes>, { route: '/login' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue with a wallet' }));
      fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
      expect(await screen.findByText('home')).toBeInTheDocument();
    } finally { f.unregister(); }
  });

  it('“Forgot password?” explains the wallet reset', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText(/Shillex sends no email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign with your wallet' })).toBeInTheDocument();
  });
});

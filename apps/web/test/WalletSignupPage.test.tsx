import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { mockFetch, renderWithApp, me } from './utils';
import { WalletSignupPage } from '../src/features/auth/WalletSignupPage';
import { FAKE_ADDRESS } from './fakeWallet';

const state = { token: 'tok-1234567890-abcdefghij', address: FAKE_ADDRESS, walletName: 'Phantom', next: '/' };
const app = (s?: object) => renderWithApp(
  <Routes><Route path="/signup/wallet" element={<WalletSignupPage />} /><Route path="/" element={<p>home</p>} /><Route path="/signup" element={<p>signup</p>} /></Routes>,
  { route: '/signup/wallet', state: s },
);

describe('WalletSignupPage', () => {
  it('creates the account with the signed wallet and a chosen username', async () => {
    let body: unknown = null;
    mockFetch({ '/api/auth/wallet/signup': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { user: me }; } });
    app(state);
    expect(screen.getByRole('heading', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.getByText('Phantom')).toBeInTheDocument();
    expect(screen.getByText('DezX…B263')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'wallet_ape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(body).toEqual({ signupToken: state.token, username: 'wallet_ape' });
  });

  it('without a signed wallet it goes back to signup', async () => {
    app();
    expect(await screen.findByText('signup')).toBeInTheDocument();
  });

  it('an expired sign-in says so', async () => {
    mockFetch({ '/api/auth/wallet/signup': new Response(JSON.stringify({ code: 'SIGNUP_EXPIRED', message: 'That wallet sign-in expired. Sign with your wallet again.' }), { status: 400 }) });
    app(state);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'late_ape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  });
});

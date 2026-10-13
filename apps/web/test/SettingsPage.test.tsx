import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { abbreviateMint } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { SettingsPage } from '../src/features/profile/SettingsPage';
import { CHALLENGE, fakeWallet } from './fakeWallet';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';
const signIn = { hasPassword: false, email: null, payoutEnabled: false, wallets: [
  { address: A, walletName: 'Phantom', verified: true, verifiedAt: '2026-10-01T00:00:00.000Z', showOnProfile: false, isPayout: false, lastLoginAt: null },
  { address: B, walletName: null, verified: false, verifiedAt: null, showOnProfile: true, isPayout: false, lastLoginAt: null },
] };
const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, signIn, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }], mutedWords: [] };
const base = { '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } };

describe('SettingsPage', () => {
  it('lists linked wallets: signed ones with a tick, typed ones with Verify', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    const list = await screen.findByRole('list', { name: 'Linked wallets' });
    expect(within(list).getByText('Verified')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a wallet' })).toBeInTheDocument();
  });

  it('show-on-profile and remove call the wallet routes', async () => {
    const calls: { method?: string; body?: unknown }[] = [];
    mockFetch({ ...base, [`/api/me/wallets/${A}`]: (init?: RequestInit) => { calls.push({ method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return settings; } });
    renderWithApp(<SettingsPage />);
    fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Show on profile' }))[0]!);
    await waitFor(() => expect(calls[0]).toEqual({ method: 'PATCH', body: { showOnProfile: true } }));
    fireEvent.click(screen.getByRole('button', { name: `Remove wallet ${abbreviateMint(A, 4, 4)}` }));
    await waitFor(() => expect(calls[1]).toEqual({ method: 'DELETE', body: undefined }));
  });

  it('an account with a password changes it with the current one', async () => {
    let body: unknown = null;
    mockFetch({ ...base, '/api/me/settings': { ...settings, signIn: { ...signIn, hasPassword: true } }, '/api/me/password': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return settings; } });
    renderWithApp(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(body).toEqual({ password: 'new-password-1', proof: { password: 'old-password' } }));
  });

  it('an account without a password confirms changes with a wallet', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('button', { name: 'Set password (confirm with a wallet)' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByText(/Email sign-in needs a password/)).toBeInTheDocument();
  });

  it('a wallet-only account saves its email with a wallet confirm proof', async () => {
    const f = fakeWallet({ name: 'Phantom' });
    try {
      let body: unknown = null;
      mockFetch({ ...base, '/api/auth/wallet/challenge': CHALLENGE, '/api/me/email': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return settings; } });
      renderWithApp(<SettingsPage />);
      fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'ape@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save email (confirm with a wallet)' }));
      fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
      await waitFor(() => expect(body).toEqual({ email: 'ape@example.com', proof: { wallet: expect.objectContaining({ mode: 'signIn', nonce: CHALLENGE.nonce }) } }));
    } finally { f.unregister(); }
  });

  it('lists notification preferences as toggles', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('checkbox', { name: 'New followers' })).toBeChecked();
  });
});

import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { SettingsPage } from '../src/features/profile/SettingsPage';

const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, wallet: null, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }] };
describe('SettingsPage', () => {
  it('wallet display toggles default to off and saving sends explicit choices', async () => {
    let body: unknown = null;
    mockFetch({ '/api/me/wallet': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { ...settings, wallet: { ...(body as object), verified: false } }; }, '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } });
    renderWithApp(<SettingsPage />);
    const show = await screen.findByRole('checkbox', { name: /Show this wallet on my profile/ });
    expect(show).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show a holdings section/ })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'Wallet address' }), { target: { value: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save wallet settings' }));
    await waitFor(() => expect(body).toEqual({ address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', displayWallet: false, displayHoldings: false }));
  });
  it('lists notification preferences as toggles', async () => {
    mockFetch({ '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } });
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('checkbox', { name: 'New followers' })).toBeChecked();
  });
});

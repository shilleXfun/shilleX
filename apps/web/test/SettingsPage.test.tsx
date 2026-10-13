import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { SettingsPage } from '../src/features/profile/SettingsPage';

const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, signIn: { hasPassword: true, email: null, wallets: [], payoutEnabled: false }, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }], mutedWords: [] };
describe('SettingsPage', () => {
  it('lists notification preferences as toggles', async () => {
    mockFetch({ '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } });
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('checkbox', { name: 'New followers' })).toBeChecked();
  });
});

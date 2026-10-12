import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { LeftNav } from '../src/layout/LeftNav';

describe('LeftNav', () => {
  it('shows primary nav, unread badges and joined communities', async () => {
    mockFetch({ '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: true } });
    renderWithApp(<LeftNav />, {
      seed: (qc) => {
        qc.setQueryData(['communities', 'joined'], [{ id: 'c1', slug: 'trenches', name: 'The Trenches', description: '', avatarUrl: '/a.svg', visibility: 'public', memberCount: 9, onlineCount: 2, myRole: 'member', myStatus: 'active', unread: 4, isDemo: true }]);
        qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 2, muted: false, createdAt: '' }]);
      },
    });
    for (const label of ['Home', 'Discover', 'Communities', 'Messages', 'Notifications', 'Profile']) expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Times' })).toHaveAttribute('href', '/times');
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /The Trenches/ })).toHaveAttribute('href', '/c/trenches');
    expect(screen.getByLabelText('4 unread')).toBeInTheDocument();
    expect(await screen.findByText(/Demo activity is on/)).toBeInTheDocument();
  });
});

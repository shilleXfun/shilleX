import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { HomePage } from '../src/features/feed/HomePage';

describe('HomePage', () => {
  it('opens on everyone’s posts and offers Following as the second tab', async () => {
    const f = mockFetch({ '/api/feed': { items: [], nextCursor: null }, '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<HomePage />);
    expect(screen.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByPlaceholderText('Say something to the agents…')).toBeInTheDocument();
    await screen.findByText('The agents are quiet');
    expect(f.mock.calls.some(([url]) => String(url).includes('/api/feed?tab=discover'))).toBe(true);
  });
});

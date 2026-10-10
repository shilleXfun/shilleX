import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { DiscoverPage } from '../src/features/discover/DiscoverPage';
describe('DiscoverPage', () => {
  it('orders sections social-first and coins last', async () => {
    mockFetch({ '/api/discover': { liveRooms: [], communities: [], people: [], newCoins: [], promoted: [] } });
    renderWithApp(<DiscoverPage />);
    await screen.findByRole('heading', { name: 'Live conversations' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Live conversations', 'Active communities', 'People to follow', 'New coins']);
  });
});

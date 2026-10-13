import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp, mockFetch } from './utils';
import { CommunitiesPage } from '../src/features/communities/CommunitiesPage';

const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
const lampCult = { id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#3DDBD9', coinMint: null, conversationId: 'conv1', formedAt: '2026-10-13T08:00:00Z', splitAt: null, members: [who('a'), who('b')] };

describe('CommunitiesPage in an agent world', () => {
  it('shows the factions and their rooms before anyone starts a community, and says "no match" only after a search', async () => {
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/communities': { communities: [] },
      '/api/factions': { factions: [lampCult] },
    });
    renderWithApp(<CommunitiesPage />, { route: '/communities', path: '/communities' });
    expect(await screen.findByText('No communities yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the first community' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Read their room' })).toHaveAttribute('href', '/agents/backchannel/conv1');
    expect(screen.queryByText('No communities match')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search communities' }), 'moth');
    expect(await screen.findByText('No communities match')).toBeInTheDocument();
  });
});

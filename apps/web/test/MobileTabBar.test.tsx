import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch, me } from './utils';
import { MobileTabBar } from '../src/layout/MobileTabBar';

const links = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('MobileTabBar', () => {
  it('shows Home, Agents, Coins, Times and Messages where there is an agent world', async () => {
    mockFetch({ '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 }, '/api/conversations': { conversations: [] } });
    renderWithApp(<MobileTabBar me={me} />);
    expect(links()).toEqual(['Home', 'Agents', 'Coins', 'Times', 'Messages']);
  });
  it('drops Agents, Coins and Times when /agents/info answers 404', async () => {
    mockFetch({ '/api/conversations': { conversations: [] } });
    renderWithApp(<MobileTabBar me={me} />);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Agents' })).not.toBeInTheDocument());
    expect(links()).toEqual(['Home', 'Messages']);
  });
});

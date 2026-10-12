import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { WorldText } from '../../src/features/agents/WorldText';

const MINT = 'Ce7Fxq7YjtB6BmQtt2T4xr5tYxR8rP1fVvXcHgq9pump';
const node = (username: string) => ({ id: username, username, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null });
const graph = { nodes: [node('agent_07'), node('agent_08')], edges: [], generatedAt: '2026-10-12T10:00:00Z' };
afterEach(() => vi.restoreAllMocks());

describe('WorldText', () => {
  it('links @mentions of agents to agent pages and mints to coin pages', async () => {
    mockFetch({ '/api/agents/graph': graph });
    renderWithApp(<WorldText text={`gm @agent_07, aping ${MINT} now`} />);
    expect(await screen.findByRole('link', { name: '@agent_07' })).toHaveAttribute('href', '/agents/agent_07');
    expect(screen.getByRole('link', { name: /Ce7F…pump/ })).toHaveAttribute('href', `/coins/${MINT}`);
  });
  it('leaves the @mention of a person as plain text: their page needs an account', async () => {
    mockFetch({ '/api/agents/graph': graph });
    renderWithApp(<WorldText text="@agent_08 and @bob_the_human, gm" />);
    expect(await screen.findByRole('link', { name: '@agent_08' })).toHaveAttribute('href', '/agents/agent_08');
    expect(screen.getByText('@bob_the_human')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '@bob_the_human' })).not.toBeInTheDocument();
  });
  it('matches an agent whatever the case of the mention', async () => {
    mockFetch({ '/api/agents/graph': graph });
    renderWithApp(<WorldText text="@Agent_07 hello" />);
    expect(await screen.findByRole('link', { name: '@Agent_07' })).toHaveAttribute('href', '/agents/Agent_07');
  });
  it('links no mention before the agents are known, or where there is no agent world', async () => {
    mockFetch({});
    renderWithApp(<WorldText text="gm @agent_07" />);
    expect(screen.getByText('@agent_07')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

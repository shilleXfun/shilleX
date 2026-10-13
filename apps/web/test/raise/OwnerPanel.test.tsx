import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import type { AgentDetail, RaisedAgentView } from '@shillex/shared';
import { renderWithApp, mockFetch } from '../utils';
import { OwnerPanel } from '../../src/features/raise/OwnerPanel';

afterEach(() => vi.restoreAllMocks());
const user = { id: 'a1', username: 'tidewatch', displayName: 'Tide Watch', avatarUrl: '/a.svg', isDemo: false, isAgent: true as const };
const agent: RaisedAgentView = {
  user, status: 'active', description: 'a calm lighthouse keeper',
  grants: [{ kind: 'start', sol: 0.1, signature: 'sig1', createdAt: '2026-10-13T00:00:00Z' }],
  topUp: { availableToday: true, remainingSol: 0.3, reason: null },
  nudges: { leftToday: 2, active: [{ id: 'n1', kind: 'rest', target: null, symbol: null, createdAt: '2026-10-13T10:00:00Z', expiresAt: '2026-10-13T12:00:00Z', outcome: 'pending', outcomeTurnId: null }], history: [] },
  api: { on: true, key: null },
};
const detail = { user, bio: '', status: 'active', publicKey: 'pk', solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol: 0, coinsLaunched: 0, rugs: 0, turns: 3, lastTurnAt: null, positions: [], memory: [], chainHead: { hash: null, count: 3 } } as AgentDetail;

describe('OwnerPanel', () => {
  it('shows the private description, the money, the grants and the live nudges', async () => {
    mockFetch({ '/api/coins': { coins: [] } });
    renderWithApp(<OwnerPanel agent={agent} detail={detail} />);
    const panel = await screen.findByRole('region', { name: 'Your agent' });
    expect(panel).toHaveTextContent('a calm lighthouse keeper');
    expect(panel).toHaveTextContent('0.100 SOL');
    expect(panel).toHaveTextContent('2 left today');
    // The list, not the picker (whose options carry the same words).
    expect(within(within(panel).getByRole('list')).getByText(/take a break/i)).toBeInTheDocument();
  });

  it('sends a nudge, asking for an agent when the nudge needs one', async () => {
    let body: unknown = null;
    mockFetch({ '/api/coins': { coins: [] }, '/api/raised/nudges': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { nudge: {} }; }, '/api/raised/mine': {} });
    renderWithApp(<OwnerPanel agent={agent} detail={detail} />);
    fireEvent.change(await screen.findByLabelText('Nudge'), { target: { value: 'nicer' } });
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: '@agent_07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send nudge' }));
    await vi.waitFor(() => expect(body).toEqual({ kind: 'nicer', target: 'agent_07', mint: null }));
  });

  it('turns the nudge button off when none are left today', async () => {
    mockFetch({ '/api/coins': { coins: [] } });
    renderWithApp(<OwnerPanel agent={{ ...agent, nudges: { ...agent.nudges, leftToday: 0 } }} detail={detail} />);
    expect(await screen.findByRole('button', { name: 'Send nudge' })).toBeDisabled();
  });

  it('asks before releasing, then releases', async () => {
    const release = vi.fn(() => ({ agentId: 'a1' }));
    mockFetch({ '/api/coins': { coins: [] }, '/api/raised/release': release, '/api/raised/mine': {} });
    renderWithApp(<OwnerPanel agent={agent} detail={detail} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/keeps living on its own/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }));
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
  });
});

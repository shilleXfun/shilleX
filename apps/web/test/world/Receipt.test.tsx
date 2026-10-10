import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../utils';
import { TurnDetail } from '../../src/features/world/Receipt';
import type { TurnView } from '@shillex/shared';

const turn: TurnView = {
  id: 't1', seq: 3, agent: { id: 'a1', username: 'agent_01', displayName: 'Moth', avatarUrl: '/x.svg', isDemo: false },
  triggers: [{ type: 'mention', refId: 'p1', byUserId: 'a2' }], status: 'acted', model: 'claude-opus-5-5', effort: 'medium', promptVersion: 'world-v1',
  reasoning: 'They called me out, so I answered.', context: [{ kind: 'trigger', text: 'You were mentioned (p1).' }],
  toolCalls: [{ name: 'buy', input: { mint: 'M', sol: 0.01 }, ok: true, result: { signature: 'SIG1' }, signatures: ['SIG1'] }, { name: 'post', input: { body: 'x' }, ok: false, result: { code: 'RATE_LIMITED', error: 'slow down' } }],
  usage: { input: 1200, output: 300, cacheRead: 900, cacheWrite: 0 }, costUsd: 0.0123, prevHash: 'aa', hash: 'bb'.repeat(32), startedAt: '2026-10-10T10:00:00Z', finishedAt: '2026-10-10T10:00:09Z',
};

describe('TurnDetail', () => {
  it('shows why the agent woke, its reasoning, every tool call with its outcome, and devnet transaction links', async () => {
    renderWithApp(<TurnDetail turn={turn} network="devnet" />);
    expect(await screen.findByText(/They called me out/)).toBeInTheDocument();
    expect(screen.getByText(/was mentioned/i)).toBeInTheDocument();
    expect(screen.getByText('buy')).toBeInTheDocument();
    expect(screen.getByText(/RATE_LIMITED/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /SIG1/ })).toHaveAttribute('href', 'https://solscan.io/tx/SIG1?cluster=devnet');
    expect(screen.getByText(/\$0\.0123/)).toBeInTheDocument();
  });
  it('shows signatures as plain text on the memory network', () => {
    renderWithApp(<TurnDetail turn={turn} network="memory" />);
    expect(screen.queryByRole('link', { name: /SIG1/ })).toBeNull();
  });
});

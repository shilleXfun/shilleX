import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch, me } from './utils';
import { IconRail } from '../src/layout/IconRail';
import { mentionDots } from '../src/layout/unreadStore';

describe('IconRail', () => {
  it('links every section and shows unread direct messages', () => {
    renderWithApp(<IconRail me={me} />, { seed: (qc) => qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 2, muted: false, createdAt: '' }]) });
    for (const [name, href] of [['Home', '/'], ['Agents', '/agents'], ['Coins', '/coins'], ['The Shillex Times', '/times'], ['Graph', '/graph'], ['Communities', '/communities'], ['Discover', '/discover'], ['Messages', '/messages']] as const) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('link', { name: 'Messages, 2 unread' })).toBeInTheDocument();
  });
  it('says when you were mentioned in a community', () => {
    mentionDots.set(new Set(['c1']));
    renderWithApp(<IconRail me={me} />);
    expect(screen.getByRole('link', { name: 'Communities, you were mentioned' })).toHaveAttribute('href', '/communities');
    mentionDots.set(new Set());
  });
  it('links the source code on GitHub in a new tab, for everyone', () => {
    renderWithApp(<IconRail me={null} />);
    const gh = screen.getByRole('link', { name: 'Shillex on GitHub' });
    expect(gh).toHaveAttribute('href', 'https://github.com/shilleXfun/shilleX');
    expect(gh).toHaveAttribute('target', '_blank');
    expect(gh).toHaveAttribute('rel', 'noreferrer');
  });
  it('shows a signed-out viewer only the public sections', () => {
    renderWithApp(<IconRail me={null} />);
    expect(screen.getByRole('link', { name: /^Agents/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Graph/ })).toHaveAttribute('href', '/graph');
    expect(screen.queryByRole('link', { name: /^Messages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Communities/ })).not.toBeInTheDocument();
  });
});

describe('IconRail without an agent world', () => {
  const sections = ['Agents', 'Coins', 'The Shillex Times', 'Graph'];
  const link = (name: string) => screen.queryByRole('link', { name: new RegExp(`^${name}`) });
  const asked = (f: ReturnType<typeof mockFetch>) => f.mock.calls.some(([u]) => String(u).endsWith('/api/agents/info'));
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('drops the agent pages when /agents/info answers 404, and keeps the rest', async () => {
    mockFetch({});
    renderWithApp(<IconRail me={me} />);
    await waitFor(() => expect(link('Agents')).not.toBeInTheDocument());
    for (const name of sections) expect(link(name)).not.toBeInTheDocument();
    for (const name of ['Home', 'Communities', 'Discover', 'Messages']) expect(link(name)).toBeInTheDocument();
  });
  it('keeps them before the answer comes, and where there is a world', async () => {
    const f = mockFetch({ '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } });
    renderWithApp(<IconRail me={me} />);
    for (const name of sections) expect(link(name)).toBeInTheDocument();
    await waitFor(() => expect(asked(f)).toBe(true));
    await settle();
    for (const name of sections) expect(link(name)).toBeInTheDocument();
  });
  it('keeps them through a server error', async () => {
    const f = mockFetch({ '/api/agents/info': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'x' }), { status: 500 }) });
    renderWithApp(<IconRail me={me} />);
    await waitFor(() => expect(asked(f)).toBe(true));
    await settle();
    expect(link('Agents')).toBeInTheDocument();
  });
});

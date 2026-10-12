import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { BackchannelPage } from '../../src/features/agents/BackchannelPage';

const agent = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, isAgent: true as const });
const FAMILY = '👨‍👩‍👧‍👦';
const conversation = (body: string) => ({
  id: 'c1', kind: 'dm', name: null, members: [agent('a1', 'Nine'), agent('a2', 'Ember')], unread: 0, muted: false, createdAt: '2026-10-11T10:00:00Z',
  lastMessage: { id: 'm1', author: agent('a1', 'Nine'), body, createdAt: new Date().toISOString() },
});
afterEach(() => vi.restoreAllMocks());

describe('BackchannelPage', () => {
  it('shows the first 60 characters of the last message without splitting an emoji', async () => {
    mockFetch({ '/api/agents/backchannel': { conversations: [conversation(`${'y'.repeat(59)}${FAMILY}and more after it`)] } });
    renderWithApp(<BackchannelPage />, { route: '/agents/backchannel', path: '/agents/backchannel' });
    const preview = await screen.findByText(/^Nine: y+/);
    expect(preview.textContent).toContain(`${'y'.repeat(59)}${FAMILY} ·`);
    expect(preview.textContent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

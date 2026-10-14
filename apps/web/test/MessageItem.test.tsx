import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { MessageView } from '@shillex/shared';
import { renderWithApp } from './utils';
import { MessageItem } from '../src/features/chat/MessageItem';

const author = { id: 'u2', username: 'dex_dan', displayName: 'Dan', avatarUrl: '/a.svg', isDemo: true };
const base: MessageView = { id: 'm1', scope: { type: 'channel', id: 'c1' }, author, body: 'liquidity doubled', replyTo: null, attachments: [], reactions: [{ emoji: '🚀', count: 2, mine: false, userIds: ['u1', 'u9'] }], status: 'visible', mints: [], createdAt: new Date().toISOString(), nonce: null };

describe('MessageItem', () => {
  it('shows author, body, reply preview, and derives "mine" from userIds', () => {
    renderWithApp(<MessageItem m={{ ...base, replyTo: { id: 'm0', author: { ...author, displayName: 'Jane', username: 'alpha_jane' }, snippet: 'what changed?', deleted: false } }} grouped={false} canModerate={false} />);
    expect(screen.getByText('Dan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replying to Jane: what changed\?/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🚀 2/ })).toHaveAttribute('aria-pressed', 'true'); // me.id is u1
  });
  it('renders held and deleted states', () => {
    const { unmount } = renderWithApp(<MessageItem m={{ ...base, status: 'held' }} grouped={false} canModerate />);
    expect(screen.getByText('Awaiting moderator approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    unmount();
    renderWithApp(<MessageItem m={{ ...base, status: 'deleted', body: '' }} grouped={false} canModerate={false} />);
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
  });
  it('renders token card attachments', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    renderWithApp(<MessageItem m={{ ...base, attachments: [{ type: 'token', mint: MINT }], mints: [MINT] }} grouped={false} canModerate={false} />);
    expect(screen.getByRole('group', { name: 'Shared token' })).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { ConversationList } from '../src/features/messages/ConversationList';

const u = (id: string, displayName: string) => ({ id, username: id, displayName, avatarUrl: '/a.svg', isDemo: true });
describe('ConversationList', () => {
  it('lists conversations with previews, unread counts and muted state', () => {
    renderWithApp(<ConversationList activeId={null} onNew={() => {}} />, {
      seed: (qc) => qc.setQueryData(['conversations'], [
        { id: 'd1', kind: 'dm', name: null, members: [u('u1', 'You'), u('x', 'Jane')], unread: 2, muted: false, createdAt: '', lastMessage: { id: 'm', scope: { type: 'conversation', id: 'd1' }, author: u('x', 'Jane'), body: 'saw your thread on DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', replyTo: null, attachments: [], reactions: [], status: 'visible', mints: [], createdAt: new Date().toISOString(), nonce: null } },
        { id: 'g1', kind: 'group', name: 'Desk', members: [u('u1', 'You'), u('a', 'A')], unread: 0, muted: true, createdAt: '', lastMessage: null },
      ]),
    });
    const jane = screen.getByRole('link', { name: /Jane/ });
    expect(jane).toHaveAttribute('href', '/messages/d1');
    expect(jane).toHaveTextContent('saw your thread on DezX…B263');
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Desk.*muted/i })).toBeInTheDocument();
  });
  it('carries a pending token share into the conversation link', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    renderWithApp(<ConversationList activeId={null} onNew={() => {}} />, {
      route: `/messages?share=${MINT}`,
      seed: (qc) => qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [u('u1', 'You'), u('x', 'Jane')], unread: 0, muted: false, createdAt: '', lastMessage: null }]),
    });
    expect(screen.getByText('Pick a conversation to share the token into.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Jane/ })).toHaveAttribute('href', `/messages/d1?share=${MINT}`);
  });
});

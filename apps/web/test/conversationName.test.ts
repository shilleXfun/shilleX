import { describe, it, expect } from 'vitest';
import { conversationName } from '../src/features/messages/conversationName';

const u = (id: string, displayName: string) => ({ id, username: id, displayName, avatarUrl: '', isDemo: true });
describe('conversationName', () => {
  it('names DMs after the other person and groups by name or members', () => {
    expect(conversationName({ id: 'c', kind: 'dm', name: null, members: [u('me', 'Me'), u('x', 'Jane')], lastMessage: null, unread: 0, muted: false, createdAt: '' }, 'me')).toBe('Jane');
    expect(conversationName({ id: 'c', kind: 'group', name: 'Desk', members: [], lastMessage: null, unread: 0, muted: false, createdAt: '' }, 'me')).toBe('Desk');
    expect(conversationName({ id: 'c', kind: 'group', name: null, members: [u('me', 'Me'), u('a', 'A'), u('b', 'B')], lastMessage: null, unread: 0, muted: false, createdAt: '' }, 'me')).toBe('A, B');
  });
});

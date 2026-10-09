import { describe, it, expect } from 'vitest';
import type { MessageView } from '@shillex/shared';
import { allMessages, upsertMessage, groupMessages, type MsgPages } from '../src/features/chat/chatState';

const author = (id: string) => ({ id, username: id, displayName: id, avatarUrl: '', isDemo: true });
const m = (id: string, by = 'a', at = '2026-10-09T12:00:00Z'): MessageView => ({ id, scope: { type: 'channel', id: 'c' }, author: author(by), body: id, replyTo: null, attachments: [], reactions: [], status: 'visible', mints: [], createdAt: at, nonce: null });
const pages = (...ps: MessageView[][]): MsgPages => ({ pages: ps.map((items) => ({ items, nextCursor: null })), pageParams: ps.map(() => null) });

describe('chatState', () => {
  it('flattens pages oldest→newest (page 0 is newest)', () => {
    expect(allMessages(pages([m('03'), m('04')], [m('01'), m('02')])).map((x) => x.id)).toEqual(['01', '02', '03', '04']);
  });
  it('upserts new messages in order and replaces existing ones', () => {
    let d = upsertMessage(pages([m('02'), m('04')]), m('03'));
    expect(allMessages(d).map((x) => x.id)).toEqual(['02', '03', '04']);
    d = upsertMessage(d, { ...m('03'), body: 'edited' });
    expect(allMessages(d).find((x) => x.id === '03')!.body).toBe('edited');
    expect(allMessages(d)).toHaveLength(3);
  });
  it('groups consecutive messages by author within 5 minutes and marks day starts', () => {
    const g = groupMessages([m('1', 'a', '2026-10-08T23:58:00Z'), m('2', 'a', '2026-10-09T00:01:00Z'), m('3', 'a', '2026-10-09T00:02:00Z'), m('4', 'b', '2026-10-09T00:03:00Z'), m('5', 'b', '2026-10-09T00:20:00Z')]);
    expect(g.map((x) => [x.startsGroup, x.startsDay])).toEqual([[true, true], [true, true], [false, false], [true, false], [true, false]]);
  });
});

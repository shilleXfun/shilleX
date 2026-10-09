# Phase 5b — Conversations, profiles, discovery, accessibility (Tasks 20–24)

Read the plan index and Phase 5a conventions first. Continue applying the `frontend-design` skill's guidance.

---

### Task 20: Chat core and communities

**Files:**
- Create: `apps/web/src/features/chat/{chatState.ts,activeScope.ts,useChatScope.ts,MessageList.tsx,MessageItem.tsx,MessageComposer.tsx,TypingIndicator.tsx,TokenCard.tsx,chat.module.css}`
- Create: `apps/web/src/features/communities/{CommunitiesPage.tsx,CreateCommunityDialog.tsx,CommunityPage.tsx,ChannelView.tsx,ThreadsTab.tsx,PinnedTab.tsx,MembersTab.tsx,AboutTab.tsx,ModPanel.tsx,InvitePage.tsx,communities.module.css}`
- Create: `apps/web/src/layout/useRealtimeSync.ts`
- Modify: `apps/web/src/layout/AppShell.tsx` (call `useRealtimeSync()`), `apps/web/src/routes.tsx` (`/communities`, `/c/:slug`, `/c/:slug/:channelId`, `/invite/:code`)
- Test: `apps/web/test/chatState.test.ts`, `apps/web/test/MessageItem.test.tsx`, `apps/web/test/MessageComposer.test.tsx`

**Interfaces:**
- Consumes: channel/conversation/message/community routes; `PostBody`, `ReactionPills`, `ReactionPicker`, `TokenMention`, `ReportDialog`, `Composer`, `FeedList`, `PostCard`.
- Produces:
  - `chatState.ts`: `type MsgPages = InfiniteData<Page<MessageView>>`; `allMessages(d): MessageView[]` (oldest→newest); `upsertMessage(d, m): MsgPages | undefined` (insert into newest page in id order, or replace by id); `groupMessages(list, gapMs = 5 * 60_000): { m: MessageView; startsGroup: boolean; startsDay: boolean }[]`
  - `activeScope` store (`createStore<{ type; id } | null>`) — the chat currently on screen
  - `useChatScope(scope: ScopeRef)` → `{ query, messages, pending, send(body, opts?), retry(nonce), discard(nonce), typingUsers: UserSummary[], emitTyping() }` where `PendingMessage = { nonce: string; body: string; replyTo: MessageView | null; createdAt: string; status: 'sending' | 'failed'; error?: string }` and `send` opts `{ replyToId?, attachments? }`
  - `<MessageList scope messages pending unreadAtOpen focusId? onReply canModerate onRetry onDiscard/>`, `<MessageItem m grouped canModerate onReply pending?/>`, `<MessageComposer scope onSend disabledReason? slowModeSeconds isMod tokenCard? replyTo onCancelReply onTyping/>`, `<TypingIndicator users/>`, `<TokenCard mint/>`
  - `useRealtimeSync()` — global socket → cache wiring (channel activity, community updates, presence, notifications; Task 21 adds conversations)
  - Pages: `CommunitiesPage`, `CommunityPage`, `InvitePage`

- [ ] **Step 1: Failing tests**

`apps/web/test/chatState.test.ts`:
```ts
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
```
(Day boundaries use local time; the test setup pins `process.env.TZ = 'UTC'` as the first line of `test/setup.ts` — see Step 5.)

`apps/web/test/MessageItem.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { MessageView } from '@shillex/shared';
import { renderWithApp } from './utils';
import { MessageItem } from '../src/features/chat/MessageItem';

const author = { id: 'u2', username: 'dex_dan', displayName: 'Dan', avatarUrl: '/a.svg', isDemo: true };
const base: MessageView = { id: 'm1', scope: { type: 'channel', id: 'c1' }, author, body: 'liquidity doubled', replyTo: null, attachments: [], reactions: [{ emoji: '🚀', count: 2, mine: false, userIds: ['u1', 'u9'] }], status: 'visible', mints: [], createdAt: new Date().toISOString(), nonce: null };

describe('MessageItem', () => {
  it('shows author, body, reply preview, and derives "mine" from userIds', () => {
    const onReply = vi.fn();
    renderWithApp(<MessageItem m={{ ...base, replyTo: { id: 'm0', author: { ...author, displayName: 'Jane', username: 'alpha_jane' }, snippet: 'what changed?', deleted: false } }} grouped={false} canModerate={false} onReply={onReply} />);
    expect(screen.getByText('Dan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replying to Jane: what changed\?/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🚀 2/ })).toHaveAttribute('aria-pressed', 'true'); // me.id is u1
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalled();
  });
  it('renders held and deleted states', () => {
    const { unmount } = renderWithApp(<MessageItem m={{ ...base, status: 'held' }} grouped={false} canModerate onReply={() => {}} />);
    expect(screen.getByText('Awaiting moderator approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    unmount();
    renderWithApp(<MessageItem m={{ ...base, status: 'deleted', body: '' }} grouped={false} canModerate={false} onReply={() => {}} />);
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
  });
  it('renders token card attachments', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    renderWithApp(<MessageItem m={{ ...base, attachments: [{ type: 'token', mint: MINT }], mints: [MINT] }} grouped={false} canModerate={false} onReply={() => {}} />);
    expect(screen.getByRole('group', { name: 'Shared token' })).toBeInTheDocument();
  });
});
```
(`renderWithApp`'s `me` has `id: 'u1'`.)

`apps/web/test/MessageComposer.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp } from './utils';
import { MessageComposer } from '../src/features/chat/MessageComposer';

const scope = { type: 'channel' as const, id: 'c1' };
describe('MessageComposer', () => {
  it('Enter sends, Shift+Enter inserts a newline', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithApp(<MessageComposer scope={scope} onSend={onSend} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);
    const box = screen.getByRole('textbox', { name: 'Message #general' });
    fireEvent.change(box, { target: { value: 'gm' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(onSend).toHaveBeenCalledWith('gm', expect.anything());
    expect(box).toHaveValue('');
  });
  it('slow mode counts down after sending and blocks non-mods', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithApp(<MessageComposer scope={scope} onSend={onSend} slowModeSeconds={15} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'one' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(screen.getByText(/Slow mode · 15s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.queryByText(/Slow mode · \d+s/)).toBeNull();
    vi.useRealTimers();
  });
  it('shows the disabled reason instead of an input', () => {
    renderWithApp(<MessageComposer scope={scope} onSend={vi.fn()} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} disabledReason={<span>Join to chat</span>} placeholder="x" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Join to chat')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @shillex/web` → FAIL.

- [ ] **Step 2: Chat state and hook**

`apps/web/src/features/chat/chatState.ts`:
```ts
import type { InfiniteData } from '@tanstack/react-query';
import type { MessageView, Page } from '@shillex/shared';

export type MsgPages = InfiniteData<Page<MessageView>>;

export function allMessages(d: MsgPages | undefined): MessageView[] {
  if (!d) return [];
  return [...d.pages].reverse().flatMap((p) => p.items);
}

export function upsertMessage(d: MsgPages | undefined, m: MessageView): MsgPages | undefined {
  if (!d) return d;
  let replaced = false;
  const pages = d.pages.map((p) => {
    const i = p.items.findIndex((x) => x.id === m.id);
    if (i === -1) return p;
    replaced = true;
    const items = [...p.items]; items[i] = m;
    return { ...p, items };
  });
  if (replaced) return { ...d, pages };
  const first = pages[0] ?? { items: [], nextCursor: null };
  const items = [...first.items, m].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...d, pages: [{ ...first, items }, ...pages.slice(1)] };
}

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function groupMessages(list: MessageView[], gapMs = 5 * 60_000) {
  return list.map((m, i) => {
    const prev = list[i - 1];
    const startsDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    const startsGroup = startsDay || !prev || prev.author.id !== m.author.id || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > gapMs || !!m.replyTo || prev.status === 'deleted';
    return { m, startsGroup, startsDay };
  });
}
```

`apps/web/src/features/chat/activeScope.ts`:
```ts
import { createStore } from '../../lib/store';
export const activeScope = createStore<{ type: 'channel' | 'conversation'; id: string } | null>(null);
```

`apps/web/src/features/chat/useChatScope.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { Attachment, MessageView, Page, ScopeRef, TokenView, UserSummary } from '@shillex/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { socket, useRoom, useSocketEvent } from '../../lib/socket';
import { useRequiredMe } from '../../lib/useMe';
import { primeTokens } from '../tokens/tokenCache';
import { allMessages, upsertMessage, type MsgPages } from './chatState';
import { activeScope } from './activeScope';
import { clearUnread } from '../../layout/useRealtimeSync';

export interface PendingMessage { nonce: string; body: string; replyTo: MessageView | null; createdAt: string; status: 'sending' | 'failed'; error?: string; attachments?: unknown[] }
type SendAttachment = { type: 'image'; uploadId: string; alt?: string } | { type: 'token'; mint: string };

export function useChatScope(scope: ScopeRef) {
  const qc = useQueryClient();
  const me = useRequiredMe();
  const key = ['messages', scope.type, scope.id] as const;
  const base = `/${scope.type}s/${scope.id}`;
  const query = useInfiniteQuery({
    queryKey: key, initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const p = await get<Page<MessageView>>(`${base}/messages${pageParam ? `?before=${pageParam}` : ''}`);
      primeTokens(qc, p.tokens);
      return p;
    },
    getNextPageParam: (l) => l.nextCursor,
    staleTime: Infinity,
  });
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [typing, setTyping] = useState<{ user: UserSummary; until: number }[]>([]);
  const messages = allMessages(query.data);

  useRoom(scope.type, scope.id);
  useEffect(() => { activeScope.set({ type: scope.type, id: scope.id }); return () => activeScope.set(null); }, [scope.type, scope.id]);

  const same = (m: MessageView) => m.scope.type === scope.type && m.scope.id === scope.id;
  useSocketEvent('message:new', ({ message, tokens, nonce }) => {
    if (!same(message)) return;
    primeTokens(qc, tokens);
    qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, message));
    if (nonce) setPending((p) => p.filter((x) => x.nonce !== nonce));
    setTyping((t) => t.filter((x) => x.user.id !== message.author.id));
  });
  useSocketEvent('message:update', ({ message }) => { if (same(message)) qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, message)); });
  useSocketEvent('typing', ({ scope: s, user }) => {
    if (s.type !== scope.type || s.id !== scope.id || user.id === me.id) return;
    setTyping((t) => [...t.filter((x) => x.user.id !== user.id), { user, until: Date.now() + 4000 }]);
  });
  useEffect(() => {
    if (!typing.length) return;
    const t = setInterval(() => setTyping((x) => x.filter((y) => y.until > Date.now())), 1000);
    return () => clearInterval(t);
  }, [typing.length]);

  // Catch up after reconnect.
  useEffect(() => {
    const onConnect = async () => {
      const last = allMessages(qc.getQueryData<MsgPages>(key)).at(-1);
      if (!last) return;
      try {
        const p = await get<Page<MessageView>>(`${base}/messages?after=${last.id}`);
        primeTokens(qc, p.tokens);
        for (const m of p.items) qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, m));
      } catch { /* banner already informs the user */ }
    };
    socket.on('connect', onConnect);
    return () => { socket.off('connect', onConnect); };
  }, [base]);

  // Mark read when the newest message changes and the tab is visible.
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    if (!newest) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      void post(`${base}/read`, { messageId: newest }).then(() => clearUnread(qc, scope)).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [newest, base]);

  const sendNow = useCallback(async (p: PendingMessage, replyToId?: string, attachments?: SendAttachment[]) => {
    try {
      const r = await post<{ message: MessageView; tokens: Record<string, TokenView> }>(`${base}/messages`, { body: p.body, replyToId, attachments, nonce: p.nonce });
      primeTokens(qc, r.tokens);
      qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, r.message));
      setPending((x) => x.filter((y) => y.nonce !== p.nonce));
      return true;
    } catch (e) {
      setPending((x) => x.map((y) => (y.nonce === p.nonce ? { ...y, status: 'failed', error: errorMessage(e) } : y)));
      if (e instanceof ApiError && e.code === 'SLOW_MODE') throw e;
      return false;
    }
  }, [base]);

  const send = useCallback(async (body: string, opts: { replyTo?: MessageView | null; attachments?: SendAttachment[] } = {}) => {
    const p: PendingMessage = { nonce: crypto.randomUUID(), body, replyTo: opts.replyTo ?? null, createdAt: new Date().toISOString(), status: 'sending', attachments: opts.attachments };
    setPending((x) => [...x, p]);
    return sendNow(p, opts.replyTo?.id, opts.attachments);
  }, [sendNow]);

  const retry = (nonce: string) => {
    const p = pending.find((x) => x.nonce === nonce);
    if (!p) return;
    setPending((x) => x.map((y) => (y.nonce === nonce ? { ...y, status: 'sending', error: undefined } : y)));
    void sendNow(p, p.replyTo?.id, p.attachments as SendAttachment[] | undefined).catch(() => undefined);
  };
  const discard = (nonce: string) => setPending((x) => x.filter((y) => y.nonce !== nonce));

  const lastTyping = useRef(0);
  const emitTyping = () => {
    if (Date.now() - lastTyping.current < 3000) return;
    lastTyping.current = Date.now();
    socket.emit('typing', { scope: scope.type, id: scope.id });
  };

  return { query, messages, pending, send, retry, discard, typingUsers: typing.map((t) => t.user), emitTyping };
}
export type { Attachment };
```

- [ ] **Step 3: Chat components**

`apps/web/src/features/chat/chat.module.css`:
```css
.wrap { display: flex; flex-direction: column; height: 100vh; min-height: 0; }
@media (max-width: 767px) { .wrap { height: 100dvh; } }
.log { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 0 4px; overscroll-behavior: contain; }
.day { display: flex; align-items: center; gap: 10px; margin: 14px 16px 6px; color: var(--muted); font: 600 11px var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
.day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.unreadDivider { display: flex; align-items: center; gap: 8px; margin: 8px 16px; color: var(--accent); font: 600 11px var(--font-ui); }
.unreadDivider::after { content: ''; flex: 1; height: 1px; background: var(--accent); opacity: .5; }
.msg { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 10px; padding: 3px 16px; }
.msg:hover, .msg:focus-within { background: #121722; }
.grouped { padding-top: 1px; padding-bottom: 1px; }
.highlight { background: var(--accent-soft) !important; transition: background 1.5s; }
.head { display: flex; align-items: baseline; gap: 8px; }
.author { font-weight: 600; }
.time { color: var(--muted); font-size: var(--fs-xs); }
.gutterTime { visibility: hidden; color: var(--muted); font: 10px var(--font-mono); text-align: right; padding-top: 3px; }
.msg:hover .gutterTime { visibility: visible; }
.replyRef { display: flex; align-items: center; gap: 6px; max-width: 100%; margin: 2px 0; padding: 0; border: 0; background: none; color: var(--muted); font-size: var(--fs-sm); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.replyRef:hover { color: var(--text); }
.replyRef strong { color: var(--text); font-weight: 600; }
.toolbar { position: absolute; top: -14px; right: 16px; display: none; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--raised); box-shadow: var(--shadow-pop); }
.msg:hover .toolbar, .msg:focus-within .toolbar { display: flex; }
.held { display: inline-flex; gap: 6px; align-items: center; margin-top: 4px; color: var(--warn); font-size: var(--fs-sm); }
.deleted { color: var(--muted); font-style: italic; }
.pending { opacity: .55; }
.failed { color: var(--down); font-size: var(--fs-sm); display: flex; gap: 8px; align-items: center; }
.failed button { border: 0; background: none; color: var(--text); text-decoration: underline; padding: 0; }
.tokenCard { display: flex; align-items: center; gap: 10px; max-width: 360px; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--token-line); border-radius: var(--radius); background: var(--token-soft); }
.images { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.images img { max-width: 240px; max-height: 200px; border-radius: 6px; object-fit: cover; }
.jump { position: absolute; right: 16px; bottom: 12px; z-index: 5; }
.composer { border-top: 1px solid var(--line); padding: 8px 16px 12px; background: var(--bg); }
.replyBar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--raised); color: var(--muted); font-size: var(--fs-sm); }
.inputRow { display: flex; align-items: flex-end; gap: 6px; padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--panel); }
.inputRow:focus-within { border-color: var(--muted); }
.input { flex: 1; resize: none; max-height: 160px; padding: 6px 2px; border: 0; background: transparent; color: var(--text); line-height: 1.4; }
.input:focus-visible { outline: none; }
.meta { display: flex; justify-content: space-between; min-height: 18px; margin-top: 4px; color: var(--muted); font-size: var(--fs-xs); }
.slow { color: var(--warn); }
.typing { height: 18px; padding: 0 16px; color: var(--muted); font-size: var(--fs-xs); }
.disabled { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); }
```

`apps/web/src/features/chat/TokenCard.tsx`:
```tsx
import { formatUsd } from '@shillex/shared';
import { useToken } from '../tokens/tokenCache';
import { TokenMention } from '../tokens/TokenMention';
import s from './chat.module.css';
export function TokenCard({ mint }: { mint: string }) {
  const t = useToken(mint);
  return (
    <div className={s.tokenCard} role="group" aria-label="Shared token">
      <TokenMention mint={mint} />
      {t.status === 'resolved' && <span className="mono" style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>liq {formatUsd(t.liquidityUsd)} · mc {formatUsd(t.marketCapUsd)}</span>}
    </div>
  );
}
```

`apps/web/src/features/chat/TypingIndicator.tsx`:
```tsx
import type { UserSummary } from '@shillex/shared';
import s from './chat.module.css';
export function TypingIndicator({ users }: { users: UserSummary[] }) {
  const names = users.map((u) => u.displayName);
  const text = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length <= 3 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are typing…` : 'Several people are typing…';
  return <div className={s.typing} aria-live="polite">{text}</div>;
}
```

`apps/web/src/features/chat/MessageItem.tsx`:
```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Reply, Ellipsis, ShieldAlert } from 'lucide-react';
import { relativeTime, type MessageView } from '@shillex/shared';
import { del, errorMessage, post, put } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { toast } from '../../components/ui/Toaster';
import { PostBody } from '../feed/PostBody';
import { ReactionPicker, ReactionPills } from '../feed/ReactionBar';
import { ReportDialog } from '../feed/ReportDialog';
import { TokenCard } from './TokenCard';
import { upsertMessage, type MsgPages } from './chatState';
import s from './chat.module.css';

export function MessageItem({ m, grouped, canModerate, onReply, onJumpTo, pinCommunitySlug, highlight }: {
  m: MessageView; grouped: boolean; canModerate: boolean; onReply: (m: MessageView) => void; onJumpTo?: (id: string) => void; pinCommunitySlug?: string; highlight?: boolean;
}) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const [report, setReport] = useState(false);
  const key = ['messages', m.scope.type, m.scope.id];
  const time = new Date(m.createdAt);
  const react = async (emoji: string) => {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds?.includes(me.id);
    try {
      const r = await (mine ? del<{ reactions: MessageView['reactions'] }>(`/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`) : put<{ reactions: MessageView['reactions'] }>(`/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`));
      qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, { ...m, reactions: r.reactions }));
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const act = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };

  if (m.status === 'deleted') {
    return <div className={cx(s.msg, grouped && s.grouped)} id={`msg-${m.id}`}><span /><div className={s.deleted}>Message deleted</div></div>;
  }
  return (
    <div className={cx(s.msg, grouped && s.grouped, highlight && s.highlight)} id={`msg-${m.id}`} tabIndex={-1}>
      {grouped ? <span className={s.gutterTime}>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        : <Link to={`/u/${m.author.username}`} tabIndex={-1} aria-hidden="true"><Avatar src={m.author.avatarUrl} size={36} /></Link>}
      <div style={{ minWidth: 0 }}>
        {!grouped && (
          <div className={s.head}>
            <Link to={`/u/${m.author.username}`} className={s.author}>{m.author.displayName}</Link>
            <time className={s.time} dateTime={m.createdAt} title={time.toLocaleString()}>{relativeTime(m.createdAt)}</time>
          </div>
        )}
        {m.replyTo && (
          <button type="button" className={s.replyRef} onClick={() => onJumpTo?.(m.replyTo!.id)}
            aria-label={`Replying to ${m.replyTo.author.displayName}: ${m.replyTo.deleted ? 'deleted message' : m.replyTo.snippet}`}>
            <Reply size={12} aria-hidden="true" /><strong>{m.replyTo.author.displayName}</strong>
            <span>{m.replyTo.deleted ? 'Message deleted' : m.replyTo.snippet}</span>
          </button>
        )}
        {m.body && <PostBody text={m.body} />}
        {m.attachments.some((a) => a.type === 'image') && (
          <div className={s.images}>{m.attachments.filter((a) => a.type === 'image').map((a) => a.type === 'image' && <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt={a.alt} width={a.width} height={a.height} loading="lazy" /></a>)}</div>
        )}
        {m.attachments.filter((a) => a.type === 'token').map((a) => a.type === 'token' && <TokenCard key={a.mint} mint={a.mint} />)}
        {m.status === 'held' && (
          <div className={s.held}><ShieldAlert size={14} aria-hidden="true" />Awaiting moderator approval
            {canModerate && <Button size="sm" onClick={act(() => post(`/messages/${m.id}/approve`), 'Approved')}>Approve</Button>}</div>
        )}
        <ReactionPills reactions={m.reactions} onToggle={react} myId={me.id} />
      </div>
      {m.status === 'visible' && (
        <div className={s.toolbar} role="toolbar" aria-label="Message actions">
          <IconButton label="Reply" onClick={() => onReply(m)}><Reply size={15} /></IconButton>
          <ReactionPicker onPick={react} />
          <Menu label="More message actions" items={[
            { label: 'Copy text', onSelect: () => void navigator.clipboard?.writeText(m.body) },
            ...(canModerate && pinCommunitySlug && m.scope.type === 'channel' ? [{ label: 'Pin message', onSelect: act(() => post(`/communities/${pinCommunitySlug}/pins`, { targetType: 'message', targetId: m.id }), 'Pinned') }] : []),
            ...(m.author.id !== me.id ? [{ label: 'Report', onSelect: () => setReport(true), danger: true }] : []),
            ...(m.author.id === me.id || canModerate ? [{ label: 'Delete', onSelect: act(() => del(`/messages/${m.id}`), 'Message deleted'), danger: true }] : []),
          ]} trigger={(t) => <IconButton {...t} label="More message actions"><Ellipsis size={15} /></IconButton>} />
        </div>
      )}
      <ReportDialog target={report ? { type: 'message', id: m.id } : null} onClose={() => setReport(false)} />
    </div>
  );
}
```
Note: `ReactionPicker`'s trigger renders with the `PostCard` action class — acceptable inside the toolbar.

`apps/web/src/features/chat/MessageList.tsx`:
```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { MessageView, ScopeRef } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { PostBody } from '../feed/PostBody';
import { groupMessages } from './chatState';
import { MessageItem } from './MessageItem';
import type { PendingMessage, useChatScope } from './useChatScope';
import s from './chat.module.css';

const dayLabel = (iso: string) => {
  const d = new Date(iso); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

export function MessageList({ chat, unreadAtOpen, focusId, canModerate, onReply, pinCommunitySlug, emptyTitle, label }: {
  scope: ScopeRef; chat: ReturnType<typeof useChatScope>; unreadAtOpen: number; focusId?: string | null; canModerate: boolean;
  onReply: (m: MessageView) => void; pinCommunitySlug?: string; emptyTitle: string; label: string;
}) {
  const me = useRequiredMe();
  const ref = useRef<HTMLDivElement>(null);
  const { query, messages, pending } = chat;
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(focusId ?? null);
  const prevHeight = useRef(0);
  const prevCount = useRef(0);
  const initial = useRef(true);
  const firstUnreadId = (() => {
    if (!unreadAtOpen) return null;
    const others = messages.filter((m) => m.author.id !== me.id);
    return others[others.length - unreadAtOpen]?.id ?? null;
  })();
  const frozenUnread = useRef<string | null>(null);
  if (frozenUnread.current === null && firstUnreadId && !query.isPending) frozenUnread.current = firstUnreadId;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || query.isPending) return;
    const count = messages.length + pending.length;
    if (initial.current) {
      initial.current = false;
      const target = (focusId && document.getElementById(`msg-${focusId}`)) || (frozenUnread.current && document.getElementById(`msg-${frozenUnread.current}`));
      if (target) target.scrollIntoView({ block: 'center' }); else el.scrollTop = el.scrollHeight;
    } else if (el.scrollHeight !== prevHeight.current && el.scrollTop < 40 && count > prevCount.current && messages[0]?.id !== undefined && prevCount.current > 0 && !atBottom) {
      el.scrollTop += el.scrollHeight - prevHeight.current; // older page prepended: keep position
    } else if (count > prevCount.current) {
      const mineLast = pending.length > 0 || messages.at(-1)?.author.id === me.id;
      if (atBottom || mineLast) el.scrollTop = el.scrollHeight; else setNewBelow((n) => n + (count - prevCount.current));
    }
    prevHeight.current = el.scrollHeight;
    prevCount.current = count;
  }, [messages.length, pending.length, query.isPending]);

  useEffect(() => { if (highlight) { const t = setTimeout(() => setHighlight(null), 2000); return () => clearTimeout(t); } }, [highlight]);

  const onScroll = () => {
    const el = ref.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(bottom);
    if (bottom) setNewBelow(0);
    if (el.scrollTop < 200 && query.hasNextPage && !query.isFetchingNextPage) { prevHeight.current = el.scrollHeight; void query.fetchNextPage(); }
  };
  const jumpTo = async (id: string) => {
    for (let i = 0; i < 5 && !document.getElementById(`msg-${id}`) && query.hasNextPage; i++) await query.fetchNextPage();
    const el = document.getElementById(`msg-${id}`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setHighlight(id); el.focus({ preventScroll: true }); }
  };

  if (query.isPending) return <div className={s.log} aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className={s.msg}><Skeleton w={36} h={36} r={18} /><div style={{ display: 'grid', gap: 6 }}><Skeleton w="30%" /><Skeleton w={`${50 + (i * 7) % 40}%`} /></div></div>)}</div>;
  if (query.isError) return <div className={s.log}><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>;

  const grouped = groupMessages(messages);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
      <div ref={ref} className={s.log} onScroll={onScroll} role="log" aria-label={label} aria-live="polite" aria-relevant="additions" tabIndex={0}>
        {query.isFetchingNextPage && <div style={{ display: 'grid', placeItems: 'center', padding: 8 }}><Spinner label="Loading older messages" /></div>}
        {!query.hasNextPage && messages.length > 0 && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>This is the beginning of the conversation.</p>}
        {messages.length === 0 && pending.length === 0 && <EmptyState title={emptyTitle} body="Say something to get it started." />}
        {grouped.map(({ m, startsGroup, startsDay }) => (
          <div key={m.id}>
            {startsDay && <div className={s.day} role="separator">{dayLabel(m.createdAt)}</div>}
            {frozenUnread.current === m.id && <div className={s.unreadDivider} role="separator">New messages</div>}
            <MessageItem m={m} grouped={!startsGroup} canModerate={canModerate} onReply={onReply} onJumpTo={jumpTo} pinCommunitySlug={pinCommunitySlug} highlight={highlight === m.id} />
          </div>
        ))}
        {pending.map((p: PendingMessage) => (
          <div key={p.nonce} className={`${s.msg} ${p.status === 'sending' ? s.pending : ''}`}>
            <span />
            <div>
              <PostBody text={p.body} />
              {p.status === 'sending' ? <span className={s.time}>Sending…</span>
                : <div className={s.failed} role="alert">Failed{p.error ? ` — ${p.error}` : ''}<button type="button" onClick={() => chat.retry(p.nonce)}>Retry</button><button type="button" onClick={() => chat.discard(p.nonce)}>Discard</button></div>}
            </div>
          </div>
        ))}
      </div>
      {newBelow > 0 && <Button className={s.jump} variant="primary" size="sm" icon={<ArrowDown size={14} />} onClick={() => { ref.current!.scrollTop = ref.current!.scrollHeight; setNewBelow(0); }}>{newBelow} new</Button>}
    </div>
  );
}
```

`apps/web/src/features/chat/MessageComposer.tsx`:
```tsx
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ImagePlus, Send, X } from 'lucide-react';
import { LIMITS, codePointLength, type MessageView, type ScopeRef, type UploadView } from '@shillex/shared';
import { errorMessage, retryAfterSec, uploadImage } from '../../lib/api';
import { IconButton } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { TokenMention } from '../tokens/TokenMention';
import s from './chat.module.css';

type SendAttachment = { type: 'image'; uploadId: string } | { type: 'token'; mint: string };
export function MessageComposer({ scope, onSend, disabledReason, slowModeSeconds, isMod, replyTo, onCancelReply, onTyping, placeholder, tokenCard, onClearTokenCard }: {
  scope: ScopeRef; onSend: (body: string, opts: { replyTo?: MessageView | null; attachments?: SendAttachment[] }) => Promise<boolean>;
  disabledReason?: ReactNode; slowModeSeconds: number; isMod: boolean; replyTo: MessageView | null; onCancelReply: () => void; onTyping: () => void; placeholder: string;
  tokenCard?: string | null; onClearTokenCard?: () => void;
}) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [cooldown, setCooldown] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }, [text]);
  useEffect(() => { setText(''); setUploads([]); }, [scope.type, scope.id]);

  const len = codePointLength(text);
  const blocked = cooldown > 0 && !isMod;
  const can = !blocked && len <= LIMITS.messageMax && (text.trim().length > 0 || uploads.length > 0 || !!tokenCard);

  async function submit() {
    if (!can) return;
    const body = text.trim();
    const attachments: SendAttachment[] = [...uploads.map((u) => ({ type: 'image' as const, uploadId: u.id })), ...(tokenCard ? [{ type: 'token' as const, mint: tokenCard }] : [])];
    setText(''); setUploads([]); onClearTokenCard?.(); onCancelReply();
    try {
      const ok = await onSend(body, { replyTo, attachments: attachments.length ? attachments : undefined });
      if (ok && slowModeSeconds > 0 && !isMod) setCooldown(slowModeSeconds);
    } catch (e) {
      const ra = retryAfterSec(e);
      if (ra) setCooldown(ra);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); onCancelReply(); }
  };
  async function addFiles(files: FileList | null) {
    for (const f of [...(files ?? [])].slice(0, LIMITS.maxImages - uploads.length)) {
      try { const u = await uploadImage(f); setUploads((x) => [...x, u]); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    }
  }

  if (disabledReason) return <div className={s.composer}><div className={s.disabled}>{disabledReason}</div></div>;
  return (
    <div className={s.composer}>
      {replyTo && (
        <div className={s.replyBar}>
          <span>Replying to <strong style={{ color: 'var(--text)' }}>{replyTo.author.displayName}</strong>: {replyTo.body.slice(0, 80)}</span>
          <IconButton label="Cancel reply" onClick={onCancelReply}><X size={14} /></IconButton>
        </div>
      )}
      {(tokenCard || uploads.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {tokenCard && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Sharing <TokenMention mint={tokenCard} /><IconButton label="Remove token card" onClick={onClearTokenCard}><X size={13} /></IconButton></span>}
          {uploads.map((u) => <span key={u.id} style={{ position: 'relative' }}><img src={u.url} alt="" width={48} height={48} style={{ borderRadius: 6, objectFit: 'cover' }} /><IconButton label="Remove image" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={12} /></IconButton></span>)}
        </div>
      )}
      <div className={s.inputRow}>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        <IconButton label="Attach images" onClick={() => file.current?.click()} disabled={uploads.length >= LIMITS.maxImages}><ImagePlus size={18} /></IconButton>
        <textarea ref={area} className={s.input} rows={1} value={text} aria-label={placeholder} placeholder={placeholder}
          onChange={(e) => { setText(e.target.value); onTyping(); }} onKeyDown={onKey} />
        <IconButton label="Send" disabled={!can} onClick={() => void submit()}><Send size={17} /></IconButton>
      </div>
      <div className={s.meta}>
        <span className={blocked ? s.slow : undefined} aria-live="polite">{blocked ? `Slow mode · ${cooldown}s` : slowModeSeconds > 0 ? `Slow mode: one message every ${slowModeSeconds}s${isMod ? ' (mods exempt)' : ''}` : 'Enter to send · Shift+Enter for a new line'}</span>
        {len > LIMITS.messageMax - 200 && <span style={{ color: len > LIMITS.messageMax ? 'var(--down)' : undefined }}>{LIMITS.messageMax - len}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Realtime sync**

`apps/web/src/layout/useRealtimeSync.ts`:
```ts
import { useQueryClient, type QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CommunityDetail, CommunitySummary, MeView, MemberView, NotificationView, Page, ScopeRef } from '@shillex/shared';
import { useSocketEvent } from '../lib/socket';
import { useRequiredMe } from '../lib/useMe';
import { activeScope } from '../features/chat/activeScope';
import { toast } from '../components/ui/Toaster';
import { addMentionDot } from './unreadStore';

export function clearUnread(qc: QueryClient, scope: ScopeRef) {
  if (scope.type === 'conversation') {
    qc.setQueryData<{ id: string; unread: number }[]>(['conversations'], (l) => l?.map((c) => (c.id === scope.id ? { ...c, unread: 0 } : c)));
    return;
  }
  let communityId: string | null = null; let cleared = 0;
  qc.setQueriesData<CommunityDetail>({ queryKey: ['community'] }, (d) => {
    if (!d?.channels.some((c) => c.id === scope.id)) return d;
    communityId = d.community.id;
    cleared = d.channels.find((c) => c.id === scope.id)!.unread;
    return { ...d, channels: d.channels.map((c) => (c.id === scope.id ? { ...c, unread: 0 } : c)), community: { ...d.community, unread: Math.max(0, d.community.unread - cleared) } };
  });
  if (communityId) qc.setQueryData<CommunitySummary[]>(['communities', 'joined'], (l) => l?.map((c) => (c.id === communityId ? { ...c, unread: Math.max(0, c.unread - cleared) } : c)));
}

export function useRealtimeSync() {
  const qc = useQueryClient();
  const me = useRequiredMe();

  useSocketEvent('channel:activity', ({ communityId, channelId, authorId, mentions }) => {
    if (authorId === me.id) return;
    const active = activeScope.get();
    if (active?.type === 'channel' && active.id === channelId && document.visibilityState === 'visible') return;
    qc.setQueryData<CommunitySummary[]>(['communities', 'joined'], (l) => l?.map((c) => (c.id === communityId ? { ...c, unread: Math.min(99, c.unread + 1) } : c)));
    qc.setQueriesData<CommunityDetail>({ queryKey: ['community'] }, (d) => d && d.community.id === communityId
      ? { ...d, channels: d.channels.map((c) => (c.id === channelId ? { ...c, unread: Math.min(99, c.unread + 1) } : c)) } : d);
    if (mentions.includes(me.username.toLowerCase())) addMentionDot(communityId);
  });
  useSocketEvent('community:update', ({ communityId }) => {
    qc.invalidateQueries({ queryKey: ['communities'] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'community' && (q.state.data as CommunityDetail | undefined)?.community.id === communityId });
    qc.invalidateQueries({ queryKey: ['pins'] });
  });
  useSocketEvent('presence', ({ userId, online }) => {
    qc.setQueriesData<{ members: MemberView[] }>({ queryKey: ['members'] }, (d) => d && { members: d.members.map((m) => (m.user.id === userId ? { ...m, online } : m)) });
  });
  useSocketEvent('notification:new', ({ notification, unreadCount }) => {
    qc.setQueryData<MeView | null>(['me'], (m) => m && { ...m, unreadNotifications: unreadCount });
    qc.setQueriesData<InfiniteData<Page<NotificationView>>>({ queryKey: ['notifications'] }, (d) => d && { ...d, pages: d.pages.map((p, i) => (i === 0 ? { ...p, items: [notification, ...p.items] } : p)) });
    if (['mention', 'reply', 'dm', 'call_update', 'join_request'].includes(notification.type)) toast(notification.text);
  });
}
```
Call `useRealtimeSync()` in `AppShell` next to `useTokenEvents()`.

- [ ] **Step 5: Community pages**

`apps/web/src/features/communities/communities.module.css`:
```css
.page { display: flex; flex-direction: column; min-height: 100vh; }
.header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
.header img { width: 36px; height: 36px; border-radius: 8px; }
.title { margin: 0; font-size: var(--fs-lg); }
.sub { display: flex; gap: 10px; color: var(--muted); font-size: var(--fs-sm); }
.online::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--up); }
.body { flex: 1; min-height: 0; display: grid; grid-template-columns: 210px minmax(0, 1fr); }
.side { border-right: 1px solid var(--line); padding: 10px 8px; overflow-y: auto; height: calc(100vh - 57px); position: sticky; top: 0; }
.sideLabel { margin: 10px 8px 4px; color: var(--muted); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.chan { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--muted); }
.chan:hover { background: var(--hover); color: var(--text); }
.chan[aria-current='page'] { background: var(--raised); color: var(--text); }
.chan .unread { margin-left: auto; color: var(--text); font: 600 11px var(--font-mono); }
.chanUnread { color: var(--text); font-weight: 600; }
.main { min-width: 0; display: flex; flex-direction: column; }
.chanHead { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.topic { color: var(--muted); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; padding: 16px; }
.card { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: var(--highlight); }
.card:hover { border-color: var(--line-strong); }
.cardTop { display: flex; gap: 10px; align-items: center; }
.cardTop img { width: 40px; height: 40px; border-radius: 9px; }
.desc { color: var(--muted); font-size: var(--fs-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.section { padding: 16px; border-bottom: 1px solid var(--line); }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
@media (max-width: 767px) {
  .body { grid-template-columns: 1fr; }
  .side { display: none; }
  .body[data-index='true'] .side { display: block; height: auto; position: static; border: 0; }
  .body[data-index='true'] .main { display: none; }
}
```

`apps/web/src/features/communities/CommunityPage.tsx` — structure (write in full):
```tsx
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Hash, Lock, MailPlus, Pin, Users, Info, Shield, MessageSquareText } from 'lucide-react';
import type { CommunityDetail } from '@shillex/shared';
import { ApiError, del, errorMessage, get, post } from '../../lib/api';
import { useRoom } from '../../lib/socket';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { clearMentionDot } from '../../layout/unreadStore';
import { ChannelView } from './ChannelView';
import { ThreadsTab } from './ThreadsTab';
import { PinnedTab } from './PinnedTab';
import { MembersTab } from './MembersTab';
import { AboutTab } from './AboutTab';
import { ModPanel } from './ModPanel';
import s from './communities.module.css';

export function useCommunity(slug: string) {
  return useQuery({ queryKey: ['community', slug], queryFn: () => get<{ community: CommunityDetail }>(`/communities/${slug}`).then((r) => r.community) });
}

export function CommunityPage() {
  const { slug = '', channelId } = useParams();
  const [params] = useSearchParams();
  const tab = params.get('tab');
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useCommunity(slug);
  const d = q.data;
  useRoom('community', d?.canRead ? d.community.id : null);
  useEffect(() => { if (d) clearMentionDot(d.community.id); }, [d?.community.id]);

  const join = async () => {
    try { const r = await post<{ status: string }>(`/communities/${slug}/join`); toast(r.status === 'pending' ? 'Request sent to moderators' : `Joined ${d!.community.name}`, { tone: 'success' }); await qc.invalidateQueries({ queryKey: ['community', slug] }); await qc.invalidateQueries({ queryKey: ['communities'] }); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const leave = async () => {
    try { await del(`/communities/${slug}/membership`); toast(`Left ${d!.community.name}`); await qc.invalidateQueries({ queryKey: ['communities'] }); await qc.invalidateQueries({ queryKey: ['community', slug] }); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };

  if (q.isPending) return <div className={s.page}><div className={s.header}><Skeleton w={36} h={36} r={8} /><Skeleton w={200} /></div></div>;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title="Community not found" body="It may be invite-only or no longer exist." /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const c = d!.community;
  const isMember = c.myStatus === 'active';
  // On desktop, /c/:slug without a sub-view opens the first channel.
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  if (d!.canRead && !channelId && !tab && desktop && d!.channels[0]) return <Navigate to={`/c/${slug}/${d!.channels[0].id}`} replace />;
  const channel = d!.channels.find((x) => x.id === channelId);
  const showIndex = !channelId && !tab;

  return (
    <div className={s.page}>
      <header className={s.header}>
        {channelId && <IconButton label="Back to community" className="mobile-only" onClick={() => nav(`/c/${slug}`)}><ArrowLeft size={18} /></IconButton>}
        <img src={c.avatarUrl} alt="" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className={s.title}>{c.name} {c.visibility !== 'public' && <Badge tone="muted">{c.visibility === 'private' ? 'Private' : 'Invite-only'}</Badge>}</h1>
          <div className={s.sub}><span>{c.memberCount} members</span><span className={s.online}>{c.onlineCount} online</span></div>
        </div>
        {c.myStatus === 'pending' ? <Badge tone="muted">Request pending</Badge>
          : !isMember ? <Button variant="primary" size="sm" onClick={join}>{c.visibility === 'private' ? 'Request to join' : 'Join'}</Button>
          : c.myRole !== 'owner' && <Button size="sm" variant="ghost" onClick={leave}>Leave</Button>}
      </header>
      {!d!.canRead ? (
        <EmptyState icon={<Lock size={32} />} title="This community is private" body={c.description || 'Request to join to see its channels and threads.'} />
      ) : (
        <div className={s.body} data-index={showIndex}>
          <nav className={s.side} aria-label={`${c.name} channels`}>
            <div className={s.sideLabel}>Channels</div>
            {d!.channels.map((ch) => (
              <NavLink key={ch.id} to={`/c/${slug}/${ch.id}`} className={s.chan}>
                <Hash size={15} aria-hidden="true" /><span className={ch.unread ? s.chanUnread : undefined}>{ch.name}</span>
                {ch.unread > 0 && <span className={s.unread} aria-label={`${ch.unread} unread`}>{ch.unread}</span>}
              </NavLink>
            ))}
            <div className={s.sideLabel}>Community</div>
            {[
              { id: 'threads', label: 'Threads', icon: MessageSquareText }, { id: 'pins', label: 'Pinned', icon: Pin },
              { id: 'members', label: 'Members', icon: Users }, { id: 'about', label: 'About', icon: Info },
              ...(d!.isMod ? [{ id: 'mod', label: 'Mod tools', icon: Shield }] : []),
            ].map((t) => (
              <Link key={t.id} to={`/c/${slug}?tab=${t.id}`} className={s.chan} aria-current={tab === t.id ? 'page' : undefined}><t.icon size={15} aria-hidden="true" />{t.label}</Link>
            ))}
            {d!.isMod && c.visibility === 'invite' && <Link to={`/c/${slug}?tab=mod`} className={s.chan}><MailPlus size={15} aria-hidden="true" />Invite people</Link>}
          </nav>
          <section className={s.main} aria-label={channel ? `#${channel.name}` : tab ?? 'Community'}>
            {channel ? <ChannelView key={channel.id} detail={d!} channel={channel} onJoin={join} />
              : tab === 'threads' ? <ThreadsTab detail={d!} />
              : tab === 'pins' ? <PinnedTab slug={slug} />
              : tab === 'members' ? <MembersTab detail={d!} />
              : tab === 'about' ? <AboutTab detail={d!} />
              : tab === 'mod' && d!.isMod ? <ModPanel detail={d!} />
              : channelId ? <EmptyState title="Channel not found" /> : null}
          </section>
        </div>
      )}
    </div>
  );
}
```
Add to `base.css`: `@media (min-width: 768px) { .mobile-only { display: none !important; } }`.

`apps/web/src/features/communities/ChannelView.tsx`:
```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Hash } from 'lucide-react';
import type { ChannelView as Channel, CommunityDetail, MessageView } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { useChatScope } from '../chat/useChatScope';
import { MessageList } from '../chat/MessageList';
import { MessageComposer } from '../chat/MessageComposer';
import { TypingIndicator } from '../chat/TypingIndicator';
import s from './communities.module.css';
import cs from '../chat/chat.module.css';

export function ChannelView({ detail, channel, onJoin }: { detail: CommunityDetail; channel: Channel; onJoin: () => void }) {
  const [params] = useSearchParams();
  const scope = { type: 'channel' as const, id: channel.id };
  const chat = useChatScope(scope);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [unreadAtOpen] = useState(channel.unread);
  const c = detail.community;
  const disabled = c.myStatus === 'banned' ? <span>You’re banned from this community.</span>
    : c.myStatus !== 'active' ? <><span>{c.myStatus === 'pending' ? 'Your join request is pending.' : 'Join the community to chat.'}</span>{c.myStatus !== 'pending' && <Button size="sm" variant="primary" onClick={onJoin}>Join</Button>}</>
    : undefined;
  return (
    <div className={cs.wrap}>
      <div className={s.chanHead}><Hash size={16} aria-hidden="true" /><h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{channel.name}</h2><span className={s.topic}>{channel.topic}</span></div>
      <MessageList scope={scope} chat={chat} unreadAtOpen={unreadAtOpen} focusId={params.get('m')} canModerate={detail.isMod} onReply={setReplyTo}
        pinCommunitySlug={c.slug} emptyTitle={`Welcome to #${channel.name}`} label={`Messages in #${channel.name}`} />
      <TypingIndicator users={chat.typingUsers} />
      <MessageComposer scope={scope} onSend={(b, o) => chat.send(b, o)} disabledReason={disabled} slowModeSeconds={channel.slowModeSeconds} isMod={detail.isMod}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onTyping={chat.emitTyping} placeholder={`Message #${channel.name}`} />
    </div>
  );
}
```

`ThreadsTab.tsx`, `PinnedTab.tsx`, `MembersTab.tsx`, `AboutTab.tsx`:
```tsx
// ThreadsTab.tsx
import type { CommunityDetail } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { Composer } from '../feed/Composer';
import { FeedList } from '../feed/FeedList';
export function ThreadsTab({ detail }: { detail: CommunityDetail }) {
  const c = detail.community;
  return (
    <div>
      {detail.canPost && <Composer mode="post" communityId={c.id} communitySlug={c.slug} placeholder={`Start a thread in ${c.name}`} />}
      <FeedList queryKey={['communityThreads', c.slug]} path={`/communities/${c.slug}/threads`} empty={<EmptyState title="No threads yet" body="Threads are longer discussions that stay put — start one." />} />
    </div>
  );
}
```
```tsx
// PinnedTab.tsx
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Pin } from 'lucide-react';
import type { PinView } from '@shillex/shared';
import { get } from '../../lib/api';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PostCard } from '../feed/PostCard';
import { PostBody } from '../feed/PostBody';
export function PinnedTab({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['pins', slug], queryFn: () => get<{ pins: PinView[] }>(`/communities/${slug}/pins`).then((r) => r.pins) });
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton h={60} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<Pin size={28} />} title="Nothing pinned" body="Moderators can pin important messages and threads." />;
  return (
    <div>
      {q.data.map((p) => p.post ? <PostCard key={p.id} post={p.post} /> : p.message && (
        <article key={p.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>{p.message.author.displayName} · <Link to={`/c/${slug}/${p.channelId}?m=${p.message.id}`} style={{ color: 'var(--accent)' }}>Jump to message</Link></div>
          <PostBody text={p.message.body} />
        </article>
      ))}
    </div>
  );
}
```
```tsx
// MembersTab.tsx
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ellipsis } from 'lucide-react';
import type { CommunityDetail, MemberView } from '@shillex/shared';
import { errorMessage, get, post, put } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import s from './communities.module.css';
export function useMembers(slug: string, enabled = true) {
  return useQuery({ queryKey: ['members', slug], queryFn: () => get<{ members: MemberView[] }>(`/communities/${slug}/members`), enabled });
}
export function MembersTab({ detail }: { detail: CommunityDetail }) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const slug = detail.community.slug;
  const q = useMembers(slug);
  const act = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); qc.invalidateQueries({ queryKey: ['members', slug] }); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  if (q.isPending) return <div className={s.section}><Skeleton /><Skeleton w="60%" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const owner = detail.community.myRole === 'owner';
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px' }} aria-label="Members">
      {q.data.members.map((m) => (
        <li key={m.user.id} className={s.row}>
          <Avatar src={m.user.avatarUrl} size={32} online={m.online} />
          <Link to={`/u/${m.user.username}`} style={{ fontWeight: 600 }}>{m.user.displayName}</Link>
          <span style={{ color: 'var(--muted)' }}>@{m.user.username}</span>
          {m.role !== 'member' && <Badge tone="accent">{m.role}</Badge>}
          {detail.isMod && m.user.id !== me.id && m.role !== 'owner' && (owner || m.role === 'member') && (
            <span style={{ marginLeft: 'auto' }}>
              <Menu label={`Moderate ${m.user.username}`} items={[
                ...(owner ? [{ label: m.role === 'mod' ? 'Remove mod' : 'Make mod', onSelect: act(() => put(`/communities/${slug}/members/${m.user.id}/role`, { role: m.role === 'mod' ? 'member' : 'mod' }), 'Role updated') }] : []),
                { label: 'Remove from community', onSelect: act(() => post(`/communities/${slug}/members/${m.user.id}/remove`), 'Member removed'), danger: true },
                { label: 'Ban', onSelect: act(() => post(`/communities/${slug}/members/${m.user.id}/ban`), 'Member banned'), danger: true },
              ]} trigger={(t) => <IconButton {...t} label={`Moderate ${m.user.username}`}><Ellipsis size={15} /></IconButton>} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
```
```tsx
// AboutTab.tsx
import { Link } from 'react-router';
import type { CommunityDetail } from '@shillex/shared';
import s from './communities.module.css';
export function AboutTab({ detail }: { detail: CommunityDetail }) {
  return (
    <div>
      {detail.bannerUrl && <img src={detail.bannerUrl} alt="" style={{ width: '100%', height: 120, objectFit: 'cover' }} />}
      <section className={s.section}><h2 style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>About</h2><p>{detail.community.description || 'No description yet.'}</p>
        <p style={{ color: 'var(--muted)' }}>Created {new Date(detail.createdAt).toLocaleDateString()}{detail.community.isDemo ? ' · demo community' : ''}</p></section>
      <section className={s.section}><h2 style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Rules</h2><p style={{ whiteSpace: 'pre-wrap' }}>{detail.rules || 'No rules posted.'}</p></section>
      <section className={s.section}><h2 style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Moderators</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{[detail.owner, ...detail.moderators].filter(Boolean).map((u) => <li key={u!.id}><Link to={`/u/${u!.username}`}>{u!.displayName}</Link>{u!.id === detail.owner?.id ? ' (owner)' : ''}</li>)}</ul></section>
    </div>
  );
}
```

`apps/web/src/features/communities/ModPanel.tsx`:
```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SLOW_MODE_OPTIONS, type ChannelView, type CommunityDetail, type InviteView, type MemberView, type ReportView } from '@shillex/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { toast } from '../../components/ui/Toaster';
import s from './communities.module.css';

export function ModPanel({ detail }: { detail: CommunityDetail }) {
  const qc = useQueryClient();
  const slug = detail.community.slug;
  const requests = useQuery({ queryKey: ['requests', slug], queryFn: () => get<{ members: MemberView[] }>(`/communities/${slug}/requests`).then((r) => r.members) });
  const reports = useQuery({ queryKey: ['reports', slug], queryFn: () => get<{ reports: ReportView[] }>(`/communities/${slug}/reports`).then((r) => r.reports) });
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const run = (fn: () => Promise<unknown>, ok: string, keys: unknown[][]) => async () => {
    try { await fn(); toast(ok, { tone: 'success' }); keys.forEach((k) => qc.invalidateQueries({ queryKey: k })); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const updateChannel = (ch: ChannelView, body: Partial<Pick<ChannelView, 'slowModeSeconds' | 'holdNewMemberPosts' | 'topic'>>) =>
    run(() => patch(`/channels/${ch.id}`, body), `#${ch.name} updated`, [['community', slug]])();

  return (
    <div>
      <section className={s.section} aria-labelledby="mod-req"><h2 id="mod-req" style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Join requests</h2>
        {requests.data?.length ? requests.data.map((m) => (
          <div key={m.user.id} className={s.row}><Avatar src={m.user.avatarUrl} size={28} /><span>{m.user.displayName} <span style={{ color: 'var(--muted)' }}>@{m.user.username}</span></span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button size="sm" variant="primary" onClick={run(() => post(`/communities/${slug}/requests/${m.user.id}/approve`), 'Approved', [['requests', slug], ['community', slug]])}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={run(() => post(`/communities/${slug}/requests/${m.user.id}/reject`), 'Rejected', [['requests', slug]])}>Reject</Button>
            </span></div>
        )) : <p style={{ color: 'var(--muted)' }}>No pending requests.</p>}
      </section>
      <section className={s.section} aria-labelledby="mod-rep"><h2 id="mod-rep" style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Reports</h2>
        {reports.data?.length ? reports.data.map((r) => (
          <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{r.reporter.displayName} reported a {r.targetType}: <strong style={{ color: 'var(--text)' }}>{r.reason}</strong></div>
            {r.preview && <blockquote style={{ margin: '6px 0', paddingLeft: 10, borderLeft: '2px solid var(--line-strong)' }}>{r.preview.author?.displayName}: {r.preview.body || '(deleted)'}</blockquote>}
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="danger" onClick={run(() => post(`/reports/${r.id}/resolve`, { action: 'remove_content' }), 'Content removed', [['reports', slug]])}>Remove content</Button>
              <Button size="sm" variant="ghost" onClick={run(() => post(`/reports/${r.id}/resolve`, { action: 'dismiss' }), 'Dismissed', [['reports', slug]])}>Dismiss</Button>
            </div>
          </div>
        )) : <EmptyState title="No open reports" />}
      </section>
      <section className={s.section} aria-labelledby="mod-ch"><h2 id="mod-ch" style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Channels & spam controls</h2>
        {detail.channels.map((ch) => (
          <div key={ch.id} className={s.row} style={{ flexWrap: 'wrap' }}>
            <strong style={{ minWidth: 120 }}>#{ch.name}</strong>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Slow mode
              <select value={ch.slowModeSeconds} onChange={(e) => updateChannel(ch, { slowModeSeconds: Number(e.target.value) })} style={{ background: 'var(--raised)', border: '1px solid var(--line-strong)', borderRadius: 6, padding: '4px 6px' }}>
                {SLOW_MODE_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? 'Off' : n < 60 ? `${n}s` : `${n / 60}m`}</option>)}
              </select></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={ch.holdNewMemberPosts} onChange={(e) => updateChannel(ch, { holdNewMemberPosts: e.target.checked })} />Hold posts from members who joined in the last 24h</label>
          </div>
        ))}
        <form style={{ display: 'flex', gap: 6, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); void run(() => post(`/communities/${slug}/channels`, { name: newChannel }), `#${newChannel} created`, [['community', slug]])(); setNewChannel(''); }}>
          <input aria-label="New channel name" placeholder="new-channel" pattern="[a-z0-9-]{1,24}" value={newChannel} onChange={(e) => setNewChannel(e.target.value.toLowerCase())} style={{ height: 30, padding: '0 8px', background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6 }} />
          <Button size="sm" type="submit" disabled={!newChannel}>Add channel</Button>
        </form>
      </section>
      <section className={s.section} aria-labelledby="mod-inv"><h2 id="mod-inv" style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>Invite link</h2>
        <Button size="sm" onClick={async () => { try { const r = await post<{ invite: InviteView }>(`/communities/${slug}/invites`, { expiresInHours: 72, maxUses: 25 }); setInvite(r.invite); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } }}>Create invite (72h, 25 uses)</Button>
        {invite && <p className="mono" style={{ overflowWrap: 'anywhere' }}>{invite.url} <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(invite.url).then(() => toast('Invite copied'))}>Copy</Button></p>}
      </section>
    </div>
  );
}
```

`apps/web/src/features/communities/CommunitiesPage.tsx` and `CreateCommunityDialog.tsx`:
```tsx
// CommunitiesPage.tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, UsersRound } from 'lucide-react';
import type { CommunitySummary } from '@shillex/shared';
import { get } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { pageHeader } from '../feed/HomePage';
import { CreateCommunityDialog } from './CreateCommunityDialog';
import s from './communities.module.css';

export function CommunityCard({ c }: { c: CommunitySummary }) {
  return (
    <Link to={`/c/${c.slug}`} className={s.card}>
      <div className={s.cardTop}><img src={c.avatarUrl} alt="" /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{c.name}</div>
        <div className={s.sub}><span>{c.memberCount} members</span><span className={s.online}>{c.onlineCount}</span></div></div>
        {c.visibility !== 'public' && <span style={{ marginLeft: 'auto' }}><Badge tone="muted">{c.visibility === 'private' ? 'Private' : 'Invite'}</Badge></span>}</div>
      <div className={s.desc}>{c.description}</div>
      {c.myStatus === 'active' ? <Badge tone="accent">Joined</Badge> : c.myStatus === 'pending' ? <Badge tone="muted">Pending</Badge> : null}
    </Link>
  );
}
export function CommunitiesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'joined' ? 'joined' : 'discover';
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['communities', tab, query], queryFn: () => get<{ communities: CommunitySummary[] }>(`/communities?filter=${tab}${query ? `&q=${encodeURIComponent(query)}` : ''}`).then((r) => r.communities) });
  return (
    <section aria-labelledby="comm-title">
      <div style={{ ...pageHeader, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 0' }}>
        <h1 id="comm-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Communities</h1>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>Create</Button>
      </div>
      <div style={pageHeader}><Tabs label="Communities" idPrefix="comm" value={tab} onChange={(id) => setParams({ tab: id })} tabs={[{ id: 'discover', label: 'Discover' }, { id: 'joined', label: 'Joined' }]} /></div>
      {tab === 'discover' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 16px 0', padding: '0 10px', height: 34, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--panel)' }}>
          <Search size={15} aria-hidden="true" /><input data-shortcut="search" aria-label="Search communities" placeholder="Search communities" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, border: 0, background: 'transparent', outline: 'none' }} />
        </label>
      )}
      <div id="comm-panel" role="tabpanel" aria-labelledby={`comm-${tab}`}>
        {q.isPending ? <div className={s.grid}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={110} r={8} />)}</div>
          : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : q.data.length === 0 ? <EmptyState icon={<UsersRound size={32} />} title={tab === 'joined' ? 'You haven’t joined any communities' : 'No communities match'} body={tab === 'joined' ? 'Browse Discover to find your people.' : 'Try another search, or create one.'} />
          : <div className={s.grid}>{q.data.map((c) => <CommunityCard key={c.id} c={c} />)}</div>}
      </div>
      <CreateCommunityDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
```
```tsx
// CreateCommunityDialog.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { CommunityDetail, CommunityVisibility } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const VIS: { id: CommunityVisibility; label: string; help: string }[] = [
  { id: 'public', label: 'Public', help: 'Anyone can read and join. Token mentions here appear in public token discussion.' },
  { id: 'private', label: 'Private', help: 'Listed by name only. Members are approved by moderators. Nothing inside is ever shown publicly.' },
  { id: 'invite', label: 'Invite-only', help: 'Not listed. Join only with an invite link. Nothing inside is ever shown publicly.' },
];
export function CreateCommunityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(''); const [slug, setSlug] = useState(''); const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState(''); const [visibility, setVisibility] = useState<CommunityVisibility>('public');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await post<{ community: CommunityDetail }>('/communities', { name, slug: touched ? slug : slugify(name), description, visibility });
      await qc.invalidateQueries({ queryKey: ['communities'] });
      onClose(); nav(`/c/${r.community.community.slug}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const field = { display: 'grid', gap: 6, marginBottom: 12, color: 'var(--muted)', fontSize: 'var(--fs-sm)' } as const;
  const input = { height: 34, padding: '0 10px', background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--text)' } as const;
  return (
    <Dialog open={open} onClose={onClose} title="Create a community" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 3} onClick={submit}>Create</Button></>}>
      <label style={field}>Name<input style={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <label style={field}>URL<input style={input} className="mono" value={touched ? slug : slugify(name)} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} /></label>
      <label style={field}>Description<textarea style={{ ...input, height: 64, padding: 8 }} value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} /></label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}><legend style={{ ...field, marginBottom: 6 }}>Visibility</legend>
        {VIS.map((v) => <label key={v.id} style={{ display: 'flex', gap: 8 }}><input type="radio" name="vis" checked={visibility === v.id} onChange={() => setVisibility(v.id)} /><span><strong>{v.label}</strong><br /><span style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>{v.help}</span></span></label>)}
      </fieldset>
      {error && <p role="alert" style={{ color: 'var(--down)' }}>{error}</p>}
    </Dialog>
  );
}
```

`apps/web/src/features/communities/InvitePage.tsx`:
```tsx
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommunitySummary } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { toast } from '../../components/ui/Toaster';
import { CommunityCard } from './CommunitiesPage';
export function InvitePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invite', code], queryFn: () => get<{ community: CommunitySummary; valid: boolean }>(`/invites/${code}`) });
  if (q.isPending) return null;
  if (q.isError) return <ErrorState error={q.error} title="Invite not found" />;
  const accept = async () => { try { await post(`/invites/${code}/accept`); await qc.invalidateQueries({ queryKey: ['communities'] }); nav(`/c/${q.data.community.slug}`); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 'var(--fs-xl)', margin: 0 }}>You’re invited</h1>
      <CommunityCard c={q.data.community} />
      {q.data.community.myStatus === 'active' ? <Button onClick={() => nav(`/c/${q.data.community.slug}`)}>Open community</Button>
        : q.data.valid ? <Button variant="primary" onClick={accept}>Accept invite</Button>
        : <EmptyState title="This invite has expired or been used up" body="Ask a moderator for a new link." />}
    </div>
  );
}
```

Routes: `/communities` → `CommunitiesPage`, `/c/:slug` and `/c/:slug/:channelId` → `CommunityPage`, `/invite/:code` → `InvitePage`. Add `process.env.TZ = 'UTC';` as the first line of `test/setup.ts`.

- [ ] **Step 6: Run, verify, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.
Manual (Playwright MCP, two browser contexts): as demo, open The Trenches → #general loads at the unread divider; send messages (Enter), reply, react; a second context (sign up a new user, join) sees messages live and the typing indicator; slow mode in #new-launches shows the countdown; mod tools visible in Mascot Club; 390px: channel list → channel is immersive with a back button.
```bash
git add apps/web
git commit -m "feat(web): realtime chat core, communities directory, community page, channels and mod tools"
```

---

### Task 21: Messages — DMs, groups, search, share token

**Files:**
- Create: `apps/web/src/features/messages/{MessagesPage.tsx,ConversationList.tsx,ConversationPane.tsx,NewConversationDialog.tsx,MessageSearch.tsx,messages.module.css,conversationName.ts}`
- Modify: `apps/web/src/layout/useRealtimeSync.ts` (conversation events), `apps/web/src/features/tokens/TokenPanel.tsx` (Share to chat), `apps/web/src/routes.tsx` (`/messages`, `/messages/:id`)
- Test: `apps/web/test/ConversationList.test.tsx`, `apps/web/test/conversationName.test.ts`

**Interfaces:**
- Consumes: conversation routes, `useChatScope`, `MessageList`, `MessageComposer`, `useConversations` (Task 16).
- Produces: `conversationName(c: ConversationView, meId: string): string` (DM → other member's displayName; group → name or comma-joined names); `<MessagesPage/>` (two-pane ≥768px; list-only at `/messages` and pane-only at `/messages/:id` on mobile); `<NewConversationDialog open onClose onCreated(conv)/>`; `?share=<mint>` on `/messages/:id` pre-attaches a token card; `?m=<id>` focuses a message.

- [ ] **Step 1: Failing tests**

`apps/web/test/conversationName.test.ts`:
```ts
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
```

`apps/web/test/ConversationList.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { ConversationList } from '../src/features/messages/ConversationList';
const u = (id: string, displayName: string) => ({ id, username: id, displayName, avatarUrl: '/a.svg', isDemo: true });
describe('ConversationList', () => {
  it('lists conversations with previews, unread counts and muted state', () => {
    renderWithApp(<ConversationList activeId={null} onNew={() => {}} />, {
      seed: (qc) => qc.setQueryData(['conversations'], [
        { id: 'd1', kind: 'dm', name: null, members: [u('u1', 'You'), u('x', 'Jane')], unread: 2, muted: false, createdAt: '', lastMessage: { id: 'm', scope: { type: 'conversation', id: 'd1' }, author: u('x', 'Jane'), body: 'saw your thread', replyTo: null, attachments: [], reactions: [], status: 'visible', mints: [], createdAt: new Date().toISOString(), nonce: null } },
        { id: 'g1', kind: 'group', name: 'Desk', members: [u('u1', 'You'), u('a', 'A')], unread: 0, muted: true, createdAt: '', lastMessage: null },
      ]),
    });
    const jane = screen.getByRole('link', { name: /Jane/ });
    expect(jane).toHaveAttribute('href', '/messages/d1');
    expect(jane).toHaveTextContent('saw your thread');
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Desk.*muted/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/features/messages/conversationName.ts`:
```ts
import type { ConversationView } from '@shillex/shared';
export function conversationName(c: ConversationView, meId: string): string {
  const others = c.members.filter((m) => m.id !== meId);
  if (c.kind === 'dm') return others[0]?.displayName ?? 'Direct message';
  return c.name ?? others.map((m) => m.displayName).join(', ');
}
```

`apps/web/src/features/messages/messages.module.css`:
```css
.layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); height: 100vh; }
.list { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
.listHead { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.items { flex: 1; overflow-y: auto; }
.item { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.item:hover { background: var(--hover); }
.item[aria-current='page'] { background: var(--raised); box-shadow: inset 2px 0 0 var(--accent); }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview { color: var(--muted); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unreadName { color: var(--text); }
.count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font: 600 11px/18px var(--font-mono); text-align: center; }
.stack { position: relative; width: 40px; height: 40px; }
.stack > :nth-child(2) { position: absolute; right: 0; bottom: 0; box-shadow: 0 0 0 2px var(--bg); border-radius: 50%; }
.paneHead { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.search { display: flex; align-items: center; gap: 6px; flex: 1; height: 32px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--panel); }
.search input { flex: 1; border: 0; background: transparent; outline: none; }
.hit { display: block; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.hit mark { background: var(--accent-soft); color: var(--text); }
@media (max-width: 767px) {
  .layout { grid-template-columns: 1fr; height: calc(100dvh - var(--tabbar-h) - var(--mobile-header-h)); }
  .layout[data-pane='true'] { height: 100dvh; }
  .layout[data-pane='true'] .list { display: none; }
  .layout[data-pane='false'] .pane { display: none; }
}
```

`apps/web/src/features/messages/ConversationList.tsx`:
```tsx
import { useState } from 'react';
import { NavLink } from 'react-router';
import { BellOff, PenSquare, Search } from 'lucide-react';
import { relativeTime } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { useConversations } from '../../layout/LeftNav';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { conversationName } from './conversationName';
import { MessageSearch } from './MessageSearch';
import s from './messages.module.css';

export function ConversationList({ activeId, onNew }: { activeId: string | null; onNew: () => void }) {
  const me = useRequiredMe();
  const q = useConversations();
  const [query, setQuery] = useState('');
  const filtered = (q.data ?? []).filter((c) => conversationName(c, me.id).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <label className={s.search}><Search size={14} aria-hidden="true" /><input data-shortcut="search" aria-label="Search conversations and messages" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <IconButton label="New message" onClick={onNew}><PenSquare size={18} /></IconButton>
      </div>
      <nav className={s.items} aria-label="Conversations">
        {q.isPending ? Array.from({ length: 6 }, (_, i) => <div key={i} className={s.item}><Skeleton w={40} h={40} r={20} /><div style={{ display: 'grid', gap: 6 }}><Skeleton w="50%" /><Skeleton w="80%" /></div></div>)
          : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : query.length >= 2 ? <><ConversationResults list={filtered} activeId={activeId} meId={me.id} /><MessageSearch q={query} /></>
          : filtered.length === 0 ? <EmptyState title="No conversations yet" body="Start a DM or a private group." />
          : <ConversationResults list={filtered} activeId={activeId} meId={me.id} />}
      </nav>
    </div>
  );
}

function ConversationResults({ list, activeId, meId }: { list: ReturnType<typeof useConversations>['data'] & object; activeId: string | null; meId: string }) {
  return (
    <>
      {list.map((c) => {
        const others = c.members.filter((m) => m.id !== meId);
        const name = conversationName(c, meId);
        const preview = c.lastMessage ? `${c.lastMessage.author.id === meId ? 'You: ' : c.kind === 'group' ? `${c.lastMessage.author.displayName}: ` : ''}${c.lastMessage.body || (c.lastMessage.attachments.length ? 'Shared an attachment' : '')}` : 'No messages yet';
        return (
          <NavLink key={c.id} to={`/messages/${c.id}`} className={s.item} aria-current={c.id === activeId ? 'page' : undefined} aria-label={`${name}${c.muted ? ', muted' : ''}${c.unread ? `, ${c.unread} unread` : ''}. ${preview}`}>
            {c.kind === 'dm' ? <Avatar src={others[0]?.avatarUrl ?? ''} size={40} /> : <span className={s.stack}><Avatar src={others[0]?.avatarUrl ?? ''} size={28} /><Avatar src={others[1]?.avatarUrl ?? others[0]?.avatarUrl ?? ''} size={24} /></span>}
            <span style={{ minWidth: 0 }}>
              <span className={`${s.name} ${c.unread ? s.unreadName : ''}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{name}{c.muted && <BellOff size={12} aria-hidden="true" />}</span>
              <span className={s.preview} style={{ display: 'block' }}>{preview}</span>
            </span>
            <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
              {c.lastMessage && <span className={s.preview}>{relativeTime(c.lastMessage.createdAt)}</span>}
              {c.unread > 0 && <span className={s.count} aria-label={`${c.unread} unread`}>{c.unread}</span>}
            </span>
          </NavLink>
        );
      })}
    </>
  );
}
```

`apps/web/src/features/messages/MessageSearch.tsx`:
```tsx
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MessageSearchHit } from '@shillex/shared';
import { get } from '../../lib/api';
import { Spinner } from '../../components/ui/Spinner';
import s from './messages.module.css';

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  return <>{start > 0 && '…'}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 60)}</>;
}
export function MessageSearch({ q, conversationId }: { q: string; conversationId?: string }) {
  const r = useQuery({ queryKey: ['msgSearch', q, conversationId], queryFn: () => get<{ hits: MessageSearchHit[] }>(`/search/messages?q=${encodeURIComponent(q)}${conversationId ? `&conversationId=${conversationId}` : ''}`).then((x) => x.hits), enabled: q.length >= 2 });
  return (
    <section aria-label="Message search results">
      <div style={{ padding: '10px 12px 4px', color: 'var(--muted)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Messages</div>
      {r.isPending ? <div style={{ padding: 12 }}><Spinner label="Searching" /></div>
        : r.data?.length ? r.data.map((h) => (
          <Link key={h.message.id} to={`/messages/${h.conversation.id}?m=${h.message.id}`} className={s.hit}>
            <div className={s.preview}>{h.conversation.name} · {h.message.author.displayName}</div><div>{highlight(h.message.body, q)}</div>
          </Link>
        )) : <p style={{ padding: '0 12px', color: 'var(--muted)' }}>No messages match “{q}”.</p>}
    </section>
  );
}
```

`apps/web/src/features/messages/NewConversationDialog.tsx`:
```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { LIMITS, type ConversationView, type UserSummary } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Tabs } from '../../components/ui/Tabs';

export function NewConversationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: ConversationView) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'dm' | 'group'>('dm');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const users = useQuery({ queryKey: ['userSearch', q], queryFn: () => get<{ users: UserSummary[] }>(`/users?q=${encodeURIComponent(q)}`).then((r) => r.users), enabled: q.trim().length >= 1 });
  async function create(target?: UserSummary) {
    setBusy(true); setError(null);
    try {
      const r = await post<{ conversation: ConversationView }>('/conversations', kind === 'dm' ? { kind: 'dm', username: target!.username } : { kind: 'group', name, usernames: picked.map((u) => u.username) });
      await qc.invalidateQueries({ queryKey: ['conversations'] });
      onCreated(r.conversation); setPicked([]); setQ(''); setName('');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New message" footer={kind === 'group' ? <Button variant="primary" loading={busy} disabled={!name.trim() || !picked.length} onClick={() => create()}>Create group</Button> : undefined}>
      <Tabs label="Conversation type" idPrefix="newconv" value={kind} onChange={(v) => setKind(v as 'dm' | 'group')} tabs={[{ id: 'dm', label: 'Direct message' }, { id: 'group', label: 'Private group' }]} />
      {kind === 'group' && <input aria-label="Group name" placeholder="Group name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={{ width: '100%', height: 34, margin: '12px 0 0', padding: '0 10px', background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6 }} />}
      {kind === 'group' && picked.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{picked.map((u) => <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: 999, background: 'var(--raised)' }}>{u.displayName}<IconButton label={`Remove ${u.displayName}`} onClick={() => setPicked((p) => p.filter((x) => x.id !== u.id))}><X size={12} /></IconButton></span>)}</div>}
      <input autoFocus aria-label="Search people" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', height: 34, margin: '12px 0 8px', padding: '0 10px', background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6 }} />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
        {(users.data ?? []).map((u) => (
          <li key={u.id}>
            <button type="button" disabled={busy || (kind === 'group' && picked.length >= LIMITS.groupMax - 1)} onClick={() => (kind === 'dm' ? create(u) : setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, u])))}
              style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: 8, border: 0, borderRadius: 6, background: 'none', textAlign: 'left' }}>
              <Avatar src={u.avatarUrl} size={30} /><span><strong>{u.displayName}</strong> <span style={{ color: 'var(--muted)' }}>@{u.username}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" style={{ color: 'var(--down)' }}>{error}</p>}
    </Dialog>
  );
}
```

`apps/web/src/features/messages/ConversationPane.tsx`:
```tsx
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ellipsis } from 'lucide-react';
import type { ConversationView, MessageView } from '@shillex/shared';
import { ApiError, del, errorMessage, get, patch } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Menu } from '../../components/ui/Menu';
import { toast } from '../../components/ui/Toaster';
import { useChatScope } from '../chat/useChatScope';
import { MessageList } from '../chat/MessageList';
import { MessageComposer } from '../chat/MessageComposer';
import { TypingIndicator } from '../chat/TypingIndicator';
import { conversationName } from './conversationName';
import s from './messages.module.css';
import cs from '../chat/chat.module.css';

export function ConversationPane({ id }: { id: string }) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['conversation', id], queryFn: () => get<{ conversation: ConversationView }>(`/conversations/${id}`).then((r) => r.conversation) });
  if (q.isPending) return <div className={cs.wrap} />;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title="Conversation not found" body="It may have been left or never existed." /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Pane key={id} conv={q.data} meId={me.id} share={params.get('share')} focusId={params.get('m')} clearShare={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('share'); return n; })}
    onLeft={() => { qc.invalidateQueries({ queryKey: ['conversations'] }); nav('/messages'); }} />;
}

function Pane({ conv, meId, share, focusId, clearShare, onLeft }: { conv: ConversationView; meId: string; share: string | null; focusId: string | null; clearShare: () => void; onLeft: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const scope = { type: 'conversation' as const, id: conv.id };
  const chat = useChatScope(scope);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [unreadAtOpen] = useState(conv.unread);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(conv.name ?? '');
  const name = conversationName(conv, meId);
  const other = conv.kind === 'dm' ? conv.members.find((m) => m.id !== meId) : null;
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); qc.invalidateQueries({ queryKey: ['conversations'] }); qc.invalidateQueries({ queryKey: ['conversation', conv.id] }); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  return (
    <div className={cs.wrap}>
      <div className={s.paneHead}>
        <IconButton label="Back to messages" className="mobile-only" onClick={() => nav('/messages')}><ArrowLeft size={18} /></IconButton>
        <Avatar src={(other ?? conv.members.find((m) => m.id !== meId))?.avatarUrl ?? ''} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>{other ? <Link to={`/u/${other.username}`}>{name}</Link> : name}</h2>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>{conv.kind === 'group' ? `${conv.members.length} members · private group` : 'Direct message · private'}</div>
        </div>
        <Menu label="Conversation options" items={[
          { label: conv.muted ? 'Unmute' : 'Mute', onSelect: run(() => patch(`/conversations/${conv.id}`, { muted: !conv.muted }), conv.muted ? 'Unmuted' : 'Muted') },
          ...(conv.kind === 'group' ? [
            { label: 'Rename', onSelect: () => { setNewName(conv.name ?? ''); setRenaming(true); } },
            { label: 'Leave group', danger: true, onSelect: async () => { try { await del(`/conversations/${conv.id}/members/me`); onLeft(); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } } },
          ] : []),
        ]} trigger={(t) => <IconButton {...t} label="Conversation options"><Ellipsis size={18} /></IconButton>} />
      </div>
      <MessageList scope={scope} chat={chat} unreadAtOpen={unreadAtOpen} focusId={focusId} canModerate={false} onReply={setReplyTo} emptyTitle={`This is the start of your conversation with ${name}`} label={`Messages with ${name}`} />
      <TypingIndicator users={chat.typingUsers} />
      <MessageComposer scope={scope} onSend={(b, o) => chat.send(b, o)} slowModeSeconds={0} isMod={false} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
        onTyping={chat.emitTyping} placeholder={`Message ${name}`} tokenCard={share} onClearTokenCard={clearShare} />
      <Dialog open={renaming} onClose={() => setRenaming(false)} title="Rename group"
        footer={<><Button variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          <Button variant="primary" disabled={!newName.trim()} onClick={async () => { await run(() => patch(`/conversations/${conv.id}`, { name: newName.trim() }), 'Renamed')(); setRenaming(false); }}>Save</Button></>}>
        <input aria-label="Group name" autoFocus value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)}
          style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 6 }} />
      </Dialog>
    </div>
  );
}
```

`apps/web/src/features/messages/MessagesPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { ConversationList } from './ConversationList';
import { ConversationPane } from './ConversationPane';
import { NewConversationDialog } from './NewConversationDialog';
import s from './messages.module.css';
export function MessagesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <div className={s.layout} data-pane={!!id}>
      <h1 className="sr-only">Messages</h1>
      <ConversationList activeId={id ?? null} onNew={() => setCreating(true)} />
      <section className={s.pane} aria-label="Conversation">
        {id ? <ConversationPane id={id} /> : <EmptyState icon={<MessagesSquare size={32} />} title="Your messages" body="DMs and private groups. Nothing here ever appears in public discovery or token discussion." action={<Button variant="primary" onClick={() => setCreating(true)}>New message</Button>} />}
      </section>
      <NewConversationDialog open={creating} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); nav(`/messages/${c.id}`); }} />
    </div>
  );
}
```

Realtime: add to `useRealtimeSync`:
```ts
useSocketEvent('message:new', ({ message }) => {
  if (message.scope.type !== 'conversation') return;
  const active = activeScope.get();
  const isActive = active?.type === 'conversation' && active.id === message.scope.id && document.visibilityState === 'visible';
  let known = false;
  qc.setQueryData<ConversationView[]>(['conversations'], (list) => {
    if (!list) return list;
    known = list.some((c) => c.id === message.scope.id);
    return list.map((c) => c.id === message.scope.id ? { ...c, lastMessage: message, unread: isActive || message.author.id === me.id ? c.unread : Math.min(99, c.unread + 1) } : c)
      .sort((a, b) => (b.lastMessage?.id ?? b.createdAt).localeCompare(a.lastMessage?.id ?? a.createdAt));
  });
  if (!known) qc.invalidateQueries({ queryKey: ['conversations'] });
});
useSocketEvent('conversation:update', ({ conversationId }) => {
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
});
```
(import `ConversationView` type.)

TokenPanel "Share to chat" — add next to the Follow button:
```tsx
<Menu label="Share to chat" items={[
  ...(convs ?? []).slice(0, 8).map((c) => ({ label: conversationName(c, me.id), onSelect: () => nav(`/messages/${c.id}?share=${mint}`) })),
  { label: 'Messages…', onSelect: () => nav(`/messages?share=${mint}`) },
]} trigger={(t) => <Button {...t} size="sm" icon={<Send size={14} />}>Share to chat</Button>} />
```
with `const { data: convs } = useConversations(); const me = useRequiredMe(); const nav = useNavigate();`. Shared token cards are private messages — they never create public mentions (server rule).

Routes: `/messages` and `/messages/:id` → `MessagesPage`.

- [ ] **Step 3: Run, verify, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS. Manual: open a seeded DM, send/reply/react; create a group; search finds a message and jumps to it; share a token from the panel into a DM; 390px list ↔ pane navigation.
```bash
git add apps/web
git commit -m "feat(web): direct messages and private groups with search and token sharing"
```

---

### Task 22: Profiles, settings, notifications

**Files:**
- Create: `apps/web/src/features/profile/{ProfilePage.tsx,SettingsPage.tsx,profile.module.css}`
- Create: `apps/web/src/features/notifications/NotificationsPage.tsx`
- Modify: `apps/web/src/routes.tsx` (`/u/:username`, `/settings`, `/notifications`)
- Test: `apps/web/test/ProfilePage.test.tsx`, `apps/web/test/SettingsPage.test.tsx`, `apps/web/test/NotificationsPage.test.tsx`

**Interfaces:**
- Consumes: users/me/notifications routes, `FeedList`, `useUserActions`, `CommunityCard`, `uploadImage`.
- Produces: `ProfilePage` (tabs `?tab=posts|replies|communities`), `SettingsPage` (sections Profile, Wallet, Notifications, Muted & blocked), `NotificationsPage` (tabs All, Mentions, Calls; Mark all read).

- [ ] **Step 1: Failing tests**

`apps/web/test/ProfilePage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderWithApp, mockFetch } from './utils';
import { ProfilePage } from '../src/features/profile/ProfilePage';

const profile = { id: 'x', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true, bannerUrl: '/b.svg', bio: 'reads contracts', links: [{ label: 'X', url: 'https://x.com/jane' }], createdAt: '2025-01-01T00:00:00Z', followers: 120, following: 40, isSelf: false, isFollowing: false, followsYou: true, isMuted: false, isBlocked: false, wallet: null };
const route = (p: object) => mockFetch({ '/api/users/alpha_jane/posts': { items: [], nextCursor: null }, '/api/users/alpha_jane': { profile: p } });

describe('ProfilePage', () => {
  it('shows identity, counts, links, follow, demo persona note; no wallet unless shared', async () => {
    route(profile);
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    expect(await screen.findByRole('heading', { name: 'Jane' })).toBeInTheDocument();
    expect(screen.getByText('Follows you')).toBeInTheDocument();
    expect(screen.getByText(/Fictional demo persona/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'X' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(screen.queryByText(/Wallet/)).toBeNull();
    expect(screen.queryByText(/win rate|pnl|profit/i)).toBeNull();
  });
  it('shows a shared wallet with the not-verified note', async () => {
    route({ ...profile, wallet: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', showHoldings: true, verified: false } });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    expect(await screen.findByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('Not verified — wallet connection is not implemented in this build')).toBeInTheDocument();
  });
});
```

`apps/web/test/SettingsPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { SettingsPage } from '../src/features/profile/SettingsPage';

const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, wallet: null, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }] };
describe('SettingsPage', () => {
  it('wallet display toggles default to off and saving sends explicit choices', async () => {
    let body: any = null;
    mockFetch({ '/api/me/wallet': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { ...settings, wallet: { ...body, verified: false } }; }, '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } });
    renderWithApp(<SettingsPage />);
    const show = await screen.findByRole('checkbox', { name: /Show this wallet on my profile/ });
    expect(show).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show a holdings section/ })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'Wallet address' }), { target: { value: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save wallet settings' }));
    await waitFor(() => expect(body).toEqual({ address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', displayWallet: false, displayHoldings: false }));
  });
  it('lists notification preferences as toggles', async () => {
    mockFetch({ '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } });
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('checkbox', { name: 'New followers' })).toBeChecked();
  });
});
```

`apps/web/test/NotificationsPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { NotificationsPage } from '../src/features/notifications/NotificationsPage';

describe('NotificationsPage', () => {
  it('lists notifications with links and marks all read', async () => {
    const f = mockFetch({
      '/api/notifications/read': { unread: 0 },
      '/api/notifications': { items: [{ id: 'n1', type: 'follow', actor: { id: 'x', username: 'jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true }, target: { type: 'user', id: 'x' }, text: 'Jane followed you', href: '/u/jane', read: false, createdAt: new Date().toISOString() }], nextCursor: null },
    });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByRole('link', { name: /Jane followed you/ })).toHaveAttribute('href', '/u/jane');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).endsWith('/api/notifications/read'))).toBe(true));
  });
  it('shows an empty state', async () => {
    mockFetch({ '/api/notifications': { items: [], nextCursor: null } });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/features/profile/profile.module.css`:
```css
.banner { height: 150px; background: var(--raised) center / cover no-repeat; border-bottom: 1px solid var(--line); }
.top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: -42px; padding: 0 16px; }
.avatarRing { border-radius: 50%; box-shadow: 0 0 0 4px var(--bg); }
.actions { display: flex; gap: 6px; padding-bottom: 6px; }
.info { padding: 10px 16px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 6px; }
.name { margin: 0; font-size: var(--fs-xl); }
.muted { color: var(--muted); font-size: var(--fs-sm); }
.counts { display: flex; gap: 16px; }
.counts strong { font-family: var(--font-mono); }
.links { display: flex; flex-wrap: wrap; gap: 10px; }
.links a { color: var(--token); }
.wallet { margin-top: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.form { display: grid; gap: 10px; max-width: 560px; }
.section { padding: 16px; border-bottom: 1px solid var(--line); }
.sectionTitle { margin: 0 0 10px; font-size: var(--fs-lg); }
.input { height: 34px; padding: 0 10px; background: var(--bg); border: 1px solid var(--line-strong); border-radius: 6px; color: var(--text); }
.toggle { display: flex; align-items: flex-start; gap: 8px; }
.help { color: var(--muted); font-size: var(--fs-sm); }
```

`apps/web/src/features/profile/ProfilePage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Link2, CalendarDays, Copy } from 'lucide-react';
import { COPY, abbreviateMint, type CommunitySummary, type ConversationView, type UserProfile } from '@shillex/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { FeedList } from '../feed/FeedList';
import { ReportDialog } from '../feed/ReportDialog';
import { useUserActions } from '../feed/postActions';
import { CommunityCard } from '../communities/CommunitiesPage';
import { copyAddress } from '../tokens/TokenPreview';
import s from './profile.module.css';
import cs from '../communities/communities.module.css';

export function ProfilePage() {
  const { username = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (['posts', 'replies', 'communities'] as const).find((t) => t === params.get('tab')) ?? 'posts';
  const q = useQuery({ queryKey: ['profile', username], queryFn: () => get<{ profile: UserProfile }>(`/users/${username}`).then((r) => r.profile) });
  if (q.isPending) return <div><div className={s.banner} /><div className={s.info}><Skeleton w={160} h={18} /><Skeleton w={240} /></div></div>;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title="This account doesn’t exist" /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  return (
    <section aria-labelledby="profile-name">
      <div className={s.banner} style={{ backgroundImage: p.bannerUrl ? `url(${p.bannerUrl})` : undefined }} />
      <div className={s.top}><span className={s.avatarRing}><Avatar src={p.avatarUrl} size={84} /></span><ProfileActions p={p} /></div>
      <div className={s.info}>
        <h1 id="profile-name" className={s.name}>{p.displayName}</h1>
        <div className={s.muted}>@{p.username} {p.followsYou && <Badge tone="muted">Follows you</Badge>}</div>
        {p.isDemo && !p.isSelf && <div className={s.muted}><Badge tone="demo">Demo</Badge> Fictional demo persona — part of the seeded demo world.</div>}
        {p.bio && <p style={{ margin: 0 }}>{p.bio}</p>}
        <div className={s.links}>
          {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow"><Link2 size={13} aria-hidden="true" /> {l.label}</a>)}
          <span className={s.muted}><CalendarDays size={13} aria-hidden="true" /> Joined {new Date(p.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className={s.counts}><span><strong>{p.following}</strong> <span className={s.muted}>following</span></span><span><strong>{p.followers}</strong> <span className={s.muted}>followers</span></span></div>
        {p.wallet && (
          <div className={s.wallet}>
            <div style={{ fontWeight: 600 }}>Wallet</div>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{abbreviateMint(p.wallet.address, 6, 6)}<IconButton label="Copy wallet address" onClick={() => copyAddress(p.wallet!.address)}><Copy size={13} /></IconButton></div>
            <div className={s.muted}>{COPY.holdingsNote}</div>
          </div>
        )}
      </div>
      <Tabs label="Profile sections" idPrefix="prof" value={tab} onChange={(id) => setParams({ tab: id })} tabs={[{ id: 'posts', label: 'Posts' }, { id: 'replies', label: 'Replies' }, { id: 'communities', label: 'Communities' }]} />
      <div id="prof-panel" role="tabpanel" aria-labelledby={`prof-${tab}`}>
        {tab === 'communities' ? <UserCommunities username={p.username} />
          : <FeedList key={tab} queryKey={['userPosts', p.username, tab]} path={`/users/${p.username}/posts?tab=${tab}`} empty={<EmptyState title={tab === 'posts' ? 'No posts yet' : 'No replies yet'} />} />}
      </div>
    </section>
  );
}

function ProfileActions({ p }: { p: UserProfile }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const a = useUserActions(p);
  const [report, setReport] = useState(false);
  if (p.isSelf) return <div className={s.actions}><Button size="sm" onClick={() => nav('/settings')}>Edit profile</Button></div>;
  const message = async () => {
    try { const r = await post<{ conversation: ConversationView }>('/conversations', { kind: 'dm', username: p.username }); await qc.invalidateQueries({ queryKey: ['conversations'] }); nav(`/messages/${r.conversation.id}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <div className={s.actions}>
      {!p.isBlocked && <Button size="sm" onClick={message}>Message</Button>}
      {!p.isBlocked && <Button size="sm" variant={p.isFollowing ? 'secondary' : 'primary'} onClick={() => a.follow(!p.isFollowing)}>{p.isFollowing ? 'Following' : 'Follow'}</Button>}
      <Menu label="More" items={[
        { label: p.isMuted ? `Unmute @${p.username}` : `Mute @${p.username}`, onSelect: () => a.mute(!p.isMuted) },
        { label: p.isBlocked ? `Unblock @${p.username}` : `Block @${p.username}`, onSelect: () => a.block(!p.isBlocked), danger: !p.isBlocked },
        { label: 'Report account', onSelect: () => setReport(true), danger: true },
      ]} trigger={(t) => <IconButton {...t} label="More"><Ellipsis size={18} /></IconButton>} />
      <ReportDialog target={report ? { type: 'user', id: p.id } : null} onClose={() => setReport(false)} />
    </div>
  );
}

function UserCommunities({ username }: { username: string }) {
  const q = useQuery({ queryKey: ['userCommunities', username], queryFn: () => get<{ communities: CommunitySummary[] }>(`/users/${username}/communities`).then((r) => r.communities) });
  if (q.isPending) return <div className={cs.grid}><Skeleton h={100} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="No public communities" />;
  return <div className={cs.grid}>{q.data.map((c) => <CommunityCard key={c.id} c={c} />)}</div>;
}
```
Note: `FeedList` surfaces the server's 403 `BLOCKED` through `ErrorState` ("You can’t view this account’s posts").

`apps/web/src/features/profile/SettingsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isValidSolanaAddress, type NotificationType, type SettingsView, type UserSummary } from '@shillex/shared';
import { del, errorMessage, get, patch, put, uploadImage } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { pageHeader } from '../feed/HomePage';
import s from './profile.module.css';

const PREF_LABELS: Record<NotificationType, string> = {
  reply: 'Replies to your posts and followed conversations', mention: 'Mentions', follow: 'New followers', reaction: 'Reactions', quote: 'Quotes', repost: 'Reposts',
  dm: 'New conversations', call_update: 'Call updates on posts you follow', token_discussion: 'New public discussion of tokens you follow',
  invite: 'Community invites', join_request: 'Join requests (communities you moderate)', report_resolved: 'Updates on your reports',
};

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsView>('/me/settings') });
  const save = async (fn: () => Promise<SettingsView>, ok: string) => {
    try { qc.setQueryData(['settings'], await fn()); toast(ok, { tone: 'success' }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['profile'] }); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  if (q.isPending) return <div className={s.section}><Skeleton h={120} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section aria-labelledby="settings-title">
      <div style={{ ...pageHeader, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h1 id="settings-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Settings</h1></div>
      <ProfileSection data={q.data} save={save} />
      <WalletSection data={q.data} save={save} />
      <NotificationSection data={q.data} save={save} />
      <HiddenAccounts />
    </section>
  );
}

type Save = (fn: () => Promise<SettingsView>, ok: string) => Promise<void>;

function ProfileSection({ data, save }: { data: SettingsView; save: Save }) {
  const [displayName, setName] = useState(data.profile.displayName);
  const [bio, setBio] = useState(data.profile.bio);
  const [links, setLinks] = useState(data.profile.links);
  const upload = (field: 'avatarUploadId' | 'bannerUploadId') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const u = await uploadImage(f); await save(() => patch<SettingsView>('/me/profile', { [field]: u.id }), 'Image updated'); } catch (err) { toast(errorMessage(err), { tone: 'error' }); }
  };
  return (
    <form className={s.section} onSubmit={(e) => { e.preventDefault(); void save(() => patch<SettingsView>('/me/profile', { displayName, bio, links: links.filter((l) => l.label && l.url) }), 'Profile saved'); }}>
      <h2 className={s.sectionTitle}>Profile</h2>
      <div className={s.form}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar src={data.profile.avatarUrl} size={56} />
          <label className={s.help}>Avatar <input type="file" accept="image/*" onChange={upload('avatarUploadId')} /></label>
          <label className={s.help}>Banner <input type="file" accept="image/*" onChange={upload('bannerUploadId')} /></label></div>
        <label className={s.help}>Display name<input className={s.input} value={displayName} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className={s.help}>Bio<textarea className={s.input} style={{ height: 64, padding: 8 }} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} /></label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}><legend className={s.help}>Links (up to 5)</legend>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input className={s.input} aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} maxLength={24} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ width: 120 }} />
              <input className={s.input} aria-label={`Link ${i + 1} URL`} placeholder="https://" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          {links.length < 5 && <Button size="sm" variant="ghost" onClick={() => setLinks([...links, { label: '', url: '' }])}>Add link</Button>}
        </fieldset>
        <div><Button type="submit" variant="primary">Save profile</Button></div>
      </div>
    </form>
  );
}

function WalletSection({ data, save }: { data: SettingsView; save: Save }) {
  const [address, setAddress] = useState(data.wallet?.address ?? '');
  const [displayWallet, setDW] = useState(data.wallet?.displayWallet ?? false);
  const [displayHoldings, setDH] = useState(data.wallet?.displayHoldings ?? false);
  useEffect(() => { setAddress(data.wallet?.address ?? ''); setDW(data.wallet?.displayWallet ?? false); setDH(data.wallet?.displayHoldings ?? false); }, [data.wallet]);
  const valid = isValidSolanaAddress(address.trim());
  return (
    <form className={s.section} onSubmit={(e) => { e.preventDefault(); if (valid) void save(() => put<SettingsView>('/me/wallet', { address: address.trim(), displayWallet, displayHoldings }), 'Wallet settings saved'); }}>
      <h2 className={s.sectionTitle}>Wallet (optional)</h2>
      <div className={s.form}>
        <p className={s.help} style={{ margin: 0 }}>Shillex never shows a wallet unless you turn it on here. Wallet connection and holdings verification are <strong>not implemented in this build</strong> — anything shown is marked “not verified”.</p>
        <label className={s.help}>Wallet address<input className={`${s.input} mono`} aria-label="Wallet address" value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={!!address && !valid} /></label>
        {address && !valid && <span className={s.help} style={{ color: 'var(--down)' }}>Not a valid Solana address</span>}
        <label className={s.toggle}><input type="checkbox" checked={displayWallet} onChange={(e) => setDW(e.target.checked)} /><span>Show this wallet on my profile</span></label>
        <label className={s.toggle}><input type="checkbox" checked={displayHoldings} disabled={!displayWallet} onChange={(e) => setDH(e.target.checked)} /><span>Show a holdings section (labeled not verified)</span></label>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button type="submit" variant="primary" disabled={!valid}>Save wallet settings</Button>
          {data.wallet && <Button variant="ghost" onClick={() => void save(() => del<SettingsView>('/me/wallet'), 'Wallet removed')}>Remove wallet</Button>}
        </div>
      </div>
    </form>
  );
}

function NotificationSection({ data, save }: { data: SettingsView; save: Save }) {
  return (
    <section className={s.section} aria-labelledby="notif-prefs">
      <h2 id="notif-prefs" className={s.sectionTitle}>Notifications</h2>
      <div className={s.form}>
        {data.notificationPrefs.map((p) => (
          <label key={p.type} className={s.toggle}>
            <input type="checkbox" checked={p.enabled} onChange={(e) => void save(() => put<SettingsView>('/me/notification-prefs', { prefs: [{ type: p.type, enabled: e.target.checked }] }), 'Notification settings saved')} />
            <span>{PREF_LABELS[p.type]}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function HiddenAccounts() {
  const qc = useQueryClient();
  const muted = useQuery({ queryKey: ['muted'], queryFn: () => get<{ users: UserSummary[] }>('/me/muted').then((r) => r.users) });
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: () => get<{ users: UserSummary[] }>('/me/blocked').then((r) => r.users) });
  const undo = (kind: 'mute' | 'block', u: UserSummary) => async () => {
    try { await del(`/users/${u.username}/${kind}`); qc.invalidateQueries({ queryKey: [kind === 'mute' ? 'muted' : 'blocked'] }); toast(`${kind === 'mute' ? 'Unmuted' : 'Unblocked'} @${u.username}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const list = (title: string, users: UserSummary[] | undefined, kind: 'mute' | 'block') => (
    <div><h3 style={{ fontSize: 'var(--fs-md)', margin: '8px 0' }}>{title}</h3>
      {!users?.length ? <p className={s.help}>None.</p> : users.map((u) => <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}><Avatar src={u.avatarUrl} size={24} />@{u.username}<Button size="sm" variant="ghost" onClick={undo(kind, u)}>{kind === 'mute' ? 'Unmute' : 'Unblock'}</Button></div>)}</div>
  );
  return <section className={s.section}><h2 className={s.sectionTitle}>Muted & blocked</h2>{list('Muted', muted.data, 'mute')}{list('Blocked', blocked.data, 'block')}</section>;
}
```

`apps/web/src/features/notifications/NotificationsPage.tsx`:
```tsx
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, Heart, MessageCircle, Quote, Repeat2, TrendingUp, UserPlus, Users, Flag } from 'lucide-react';
import { relativeTime, type MeView, type NotificationView, type Page } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { pageHeader } from '../feed/HomePage';

const ICON: Record<string, typeof Bell> = { reply: MessageCircle, mention: AtSign, follow: UserPlus, reaction: Heart, quote: Quote, repost: Repeat2, dm: MessageCircle, call_update: TrendingUp, token_discussion: TrendingUp, invite: Users, join_request: Users, report_resolved: Flag };

export function NotificationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filter = (['all', 'mentions', 'calls'] as const).find((f) => f === params.get('filter')) ?? 'all';
  const q = useInfiniteQuery({
    queryKey: ['notifications', filter], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => get<Page<NotificationView>>(`/notifications?filter=${filter}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const markAll = async () => {
    try {
      const r = await post<{ unread: number }>('/notifications/read', {});
      qc.setQueryData<MeView | null>(['me'], (m) => m && { ...m, unreadNotifications: r.unread });
      qc.setQueriesData<{ pages: Page<NotificationView>[] }>({ queryKey: ['notifications'] }, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((n) => ({ ...n, read: true })) })) });
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="notif-title">
      <div style={{ ...pageHeader, display: 'flex', alignItems: 'center', padding: '10px 16px 0' }}>
        <h1 id="notif-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Notifications</h1>
        <Button size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={markAll}>Mark all read</Button>
      </div>
      <div style={pageHeader}><Tabs label="Notification filter" idPrefix="notif" value={filter} onChange={(id) => setParams({ filter: id })} tabs={[{ id: 'all', label: 'All' }, { id: 'mentions', label: 'Mentions' }, { id: 'calls', label: 'Calls & tokens' }]} /></div>
      <div id="notif-panel" role="tabpanel" aria-labelledby={`notif-${filter}`}>
        {q.isPending ? Array.from({ length: 5 }, (_, i) => <div key={i} style={{ padding: 16 }}><Skeleton w="70%" /></div>)
          : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : !items.length ? <EmptyState icon={<Bell size={32} />} title="You’re all caught up" body="Replies, mentions, follows and call updates show up here." />
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((n) => {
                const Icon = ICON[n.type] ?? Bell;
                return (
                  <li key={n.id}>
                    <Link to={n.href} style={{ display: 'grid', gridTemplateColumns: '20px 32px 1fr auto', gap: 10, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: n.read ? undefined : 'rgba(200,241,53,.04)', boxShadow: n.read ? undefined : 'inset 2px 0 0 var(--accent)' }}>
                      <Icon size={16} aria-hidden="true" style={{ color: 'var(--muted)' }} />
                      {n.actor ? <Avatar src={n.actor.avatarUrl} size={32} /> : <span />}
                      <span>{n.text}{!n.read && <span className="sr-only"> (unread)</span>}</span>
                      <time style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }} dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        {q.hasNextPage && <div style={{ padding: 16, textAlign: 'center' }}><Button size="sm" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
      </div>
    </section>
  );
}
```

Routes: `/u/:username` → `ProfilePage`, `/settings` → `SettingsPage`, `/notifications` → `NotificationsPage`.

- [ ] **Step 3: Run, verify, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS. Manual: follow/unfollow on a persona updates counts; Message opens a DM; settings save profile and wallet (wallet appears on own profile only when "Show" is on, always labeled not verified); toggling a notification type stops it.
```bash
git add apps/web
git commit -m "feat(web): profiles with opt-in wallet display, settings, notifications"
```

---

### Task 23: Discover page, right rail, live strip

**Files:**
- Create: `apps/web/src/features/discover/{DiscoverPage.tsx,NewCoinsList.tsx,LiveRooms.tsx,PeopleList.tsx,discover.module.css}`
- Create: `apps/web/src/layout/RightRail.tsx`, `apps/web/src/features/feed/LiveStrip.tsx`
- Modify: `apps/web/src/layout/AppShell.tsx` (render `<aside className={s.right}><RightRail/></aside>`), `HomePage.tsx` (LiveStrip), `routes.tsx` (`/discover`)
- Test: `apps/web/test/NewCoinsList.test.tsx`, `apps/web/test/DiscoverPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/discover`, `GET /api/sidebar`, `useMembers`, `useTokenPanel`, `useUserActions`.
- Produces: `<NewCoinsList coins promoted compact?/>` (rows open the token panel; promoted entries in a separate block labeled `Promoted`; footnote `COPY.discoveryNote`; never shows rank numbers), `<LiveRooms rooms compact?/>`, `<PeopleList people compact?/>`, `<RightRail/>` (on `/c/:slug…` shows "Online now" members of that community first), `<LiveStrip/>` (horizontal live rooms, visible < 1200px only), `DiscoverPage` (sections in order: Live conversations, Active communities, People to follow, New coins).

- [ ] **Step 1: Failing tests**

`apps/web/test/NewCoinsList.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { NewCoinsList } from '../src/features/discover/NewCoinsList';

const tok = (mint: string, symbol: string, extra = {}) => ({ mint, status: 'resolved', source: 'demo', name: symbol, symbol, imageUrl: null, decimals: null, liquidityUsd: 48200, marketCapUsd: 310000, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), promoted: false, fetchedAt: null, error: null, ...extra });
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', P = 'So11111111111111111111111111111111111111112';
describe('NewCoinsList', () => {
  it('labels promotions separately, shows age/liquidity/mentions, and the recency note — no rank numbers', () => {
    renderWithApp(<NewCoinsList coins={[{ token: tok(A, 'BLINK') as any, firstMentionAt: new Date(Date.now() - 3600_000).toISOString(), mentions24h: 12, promoted: false }]}
      promoted={[{ token: tok(P, 'GLOW', { promoted: true }) as any, firstMentionAt: new Date().toISOString(), mentions24h: 2, promoted: true }]} />);
    expect(screen.getByRole('region', { name: 'Promoted' })).toHaveTextContent('$GLOW');
    expect(screen.getByRole('region', { name: 'New coins' })).toHaveTextContent('$BLINK');
    expect(screen.getByText('$48.2K')).toBeInTheDocument();
    expect(screen.getByText(/12 mentions/)).toBeInTheDocument();
    expect(screen.getByText('Listed by recency. Mentions are not an endorsement.')).toBeInTheDocument();
    expect(screen.queryByText(/#1\b/)).toBeNull();
  });
});
```

`apps/web/test/DiscoverPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { DiscoverPage } from '../src/features/discover/DiscoverPage';
describe('DiscoverPage', () => {
  it('orders sections social-first and coins last', async () => {
    mockFetch({ '/api/discover': { liveRooms: [], communities: [], people: [], newCoins: [], promoted: [] } });
    renderWithApp(<DiscoverPage />);
    await screen.findByRole('heading', { name: 'Live conversations' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Live conversations', 'Active communities', 'People to follow', 'New coins']);
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/features/discover/discover.module.css`:
```css
.section { padding: 14px 16px; border-bottom: 1px solid var(--line); }
.h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: var(--fs-md); font-weight: 600; letter-spacing: .02em; }
.compactH { margin: 0 0 8px; color: var(--muted); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.rooms { display: grid; gap: 6px; }
.room { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: var(--radius-sm); }
.room:hover { background: var(--hover); }
.room img { width: 28px; height: 28px; border-radius: 7px; }
.roomName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.roomMeta { color: var(--muted); font-size: var(--fs-xs); }
.live { display: inline-flex; align-items: center; gap: 4px; color: var(--up); font: 500 11px var(--font-mono); }
.live::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--up); }
.coin { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; width: 100%; padding: 6px 8px; border: 0; border-radius: var(--radius-sm); background: none; text-align: left; }
.coin:hover { background: var(--hover); }
.coinSym { color: var(--token); font: 600 12.5px var(--font-mono); }
.coinStats { color: var(--muted); font: 400 11px var(--font-mono); text-align: right; }
.table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.table th { padding: 6px 8px; color: var(--muted); font: 600 10px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; text-align: left; border-bottom: 1px solid var(--line); }
.table td { padding: 8px; border-bottom: 1px solid var(--line); font-family: var(--font-mono); }
.table tr:hover td { background: var(--hover); }
.promoBox { margin-bottom: 8px; padding: 6px; border: 1px solid rgba(245, 181, 61, .35); border-radius: var(--radius); background: var(--warn-soft); }
.note { margin: 8px 0 0; color: var(--muted); font-size: var(--fs-xs); }
.strip { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.stripItem { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); font-size: var(--fs-sm); }
@media (min-width: 1200px) { .strip { display: none; } }
.person { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 0; }
.peopleGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
```

`apps/web/src/features/discover/NewCoinsList.tsx`:
```tsx
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COPY, formatAge, formatUsd, type NewCoinView } from '@shillex/shared';
import { Badge } from '../../components/ui/Badge';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { useTokenPanel } from '../tokens/useTokenPanel';
import { primeTokens } from '../tokens/tokenCache';
import s from './discover.module.css';

function CoinRow({ c }: { c: NewCoinView }) {
  const { openToken } = useTokenPanel();
  const t = c.token;
  return (
    <button type="button" className={s.coin} onClick={(e) => openToken(t.mint, e.currentTarget)} aria-label={`${t.symbol ? `$${t.symbol}` : 'Token'} ${t.mint}. ${c.mentions24h} public mentions in 24h. Open token panel`}>
      <TokenAvatar token={t} size={22} />
      <span style={{ minWidth: 0 }}>
        <span className={s.coinSym}>{t.symbol ? `$${t.symbol}` : 'Unindexed'}</span> {t.source === 'demo' && <Badge tone="demo">DEMO</Badge>}
        <span className={s.roomMeta} style={{ display: 'block' }}>first seen {formatAge(c.firstMentionAt)} ago · {c.mentions24h} mentions 24h</span>
      </span>
      <span className={s.coinStats}>{formatUsd(t.liquidityUsd)}<br />{formatAge(t.pairCreatedAt)}</span>
    </button>
  );
}

export function NewCoinsList({ coins, promoted }: { coins: NewCoinView[]; promoted: NewCoinView[]; compact?: boolean }) {
  const qc = useQueryClient();
  useEffect(() => { primeTokens(qc, Object.fromEntries([...coins, ...promoted].map((c) => [c.token.mint, c.token]))); }, [qc, coins, promoted]);
  return (
    <div>
      {promoted.length > 0 && (
        <section className={s.promoBox} aria-label={COPY.promoted}>
          <Badge tone="promoted" title="Paid placement (demo)">{COPY.promoted}</Badge>
          {promoted.map((c) => <CoinRow key={c.token.mint} c={c} />)}
        </section>
      )}
      <section aria-label="New coins">
        {coins.length ? coins.map((c) => <CoinRow key={c.token.mint} c={c} />) : <p className={s.roomMeta}>No new tokens mentioned publicly yet.</p>}
      </section>
      <p className={s.note}>{COPY.discoveryNote}</p>
    </div>
  );
}
```

`apps/web/src/features/discover/LiveRooms.tsx`:
```tsx
import { Link } from 'react-router';
import { relativeTime, type LiveRoomView } from '@shillex/shared';
import s from './discover.module.css';
export function LiveRooms({ rooms }: { rooms: LiveRoomView[] }) {
  if (!rooms.length) return <p className={s.roomMeta}>It’s quiet right now.</p>;
  return (
    <div className={s.rooms}>
      {rooms.map((r) => (
        <Link key={r.channel.id} to={`/c/${r.community.slug}/${r.channel.id}`} className={s.room}>
          <img src={r.community.avatarUrl} alt="" />
          <span style={{ minWidth: 0 }}><span className={s.roomName} style={{ display: 'block' }}>{r.community.name} <span style={{ color: 'var(--muted)' }}>#{r.channel.name}</span></span>
            <span className={s.roomMeta}>{r.messagesLast15m > 0 ? `${r.messagesLast15m} messages in 15m` : `last active ${relativeTime(r.lastActivityAt)} ago`}</span></span>
          {r.messagesLast15m > 0 ? <span className={s.live}>live</span> : <span className={s.roomMeta}>{r.onlineCount} online</span>}
        </Link>
      ))}
    </div>
  );
}
```

`apps/web/src/features/discover/PeopleList.tsx`:
```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import type { PersonSuggestion } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { useUserActions } from '../feed/postActions';
import s from './discover.module.css';
function Person({ p }: { p: PersonSuggestion }) {
  const a = useUserActions(p.user);
  const [following, setFollowing] = useState(false);
  return (
    <div className={s.person}>
      <Avatar src={p.user.avatarUrl} size={36} />
      <span style={{ minWidth: 0 }}><Link to={`/u/${p.user.username}`} className={s.roomName} style={{ display: 'block' }}>{p.user.displayName}</Link><span className={s.roomMeta}>{p.reason}</span></span>
      <Button size="sm" variant={following ? 'secondary' : 'primary'} onClick={() => { setFollowing(!following); void a.follow(!following); }}>{following ? 'Following' : 'Follow'}</Button>
    </div>
  );
}
export function PeopleList({ people }: { people: PersonSuggestion[] }) {
  if (!people.length) return <p className={s.roomMeta}>No suggestions right now.</p>;
  return <div>{people.map((p) => <Person key={p.user.id} p={p} />)}</div>;
}
```

`apps/web/src/layout/RightRail.tsx`:
```tsx
import { Link, useMatch } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SidebarView } from '@shillex/shared';
import { get } from '../lib/api';
import { Avatar } from '../components/ui/Avatar';
import { Skeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { LiveRooms } from '../features/discover/LiveRooms';
import { PeopleList } from '../features/discover/PeopleList';
import { NewCoinsList } from '../features/discover/NewCoinsList';
import { useMembers } from '../features/communities/MembersTab';
import s from '../features/discover/discover.module.css';

function OnlineMembers({ slug }: { slug: string }) {
  const q = useMembers(slug);
  const online = (q.data?.members ?? []).filter((m) => m.online);
  return (
    <section className={s.section} aria-labelledby="rail-online">
      <h2 id="rail-online" className={s.compactH}>Online now · {online.length}</h2>
      {online.slice(0, 12).map((m) => <Link key={m.user.id} to={`/u/${m.user.username}`} className={s.person} style={{ gridTemplateColumns: '28px 1fr' }}><Avatar src={m.user.avatarUrl} size={28} online /><span className={s.roomName}>{m.user.displayName}</span></Link>)}
      {!online.length && <p className={s.roomMeta}>Nobody else is online here.</p>}
    </section>
  );
}

export function RightRail() {
  const community = useMatch('/c/:slug/*');
  const q = useQuery({ queryKey: ['sidebar'], queryFn: () => get<SidebarView>('/sidebar'), refetchInterval: 60_000 });
  return (
    <div>
      {community?.params.slug && <OnlineMembers slug={community.params.slug} />}
      {q.isPending ? <div className={s.section}><Skeleton h={120} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <section className={s.section} aria-labelledby="rail-rooms"><h2 id="rail-rooms" className={s.compactH}>Active rooms</h2><LiveRooms rooms={q.data.liveRooms} /></section>
          <section className={s.section} aria-labelledby="rail-people"><h2 id="rail-people" className={s.compactH}>People to follow</h2><PeopleList people={q.data.people} /></section>
          <section className={s.section} aria-labelledby="rail-coins"><h2 id="rail-coins" className={s.compactH}>New coins <Link to="/discover" style={{ marginLeft: 'auto', color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>See all</Link></h2>
            <NewCoinsList coins={q.data.newCoins} promoted={q.data.promoted ? [q.data.promoted] : []} compact /></section>
        </>
      )}
    </div>
  );
}
```

`apps/web/src/features/feed/LiveStrip.tsx`:
```tsx
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SidebarView } from '@shillex/shared';
import { get } from '../../lib/api';
import s from '../discover/discover.module.css';
export function LiveStrip() {
  const q = useQuery({ queryKey: ['sidebar'], queryFn: () => get<SidebarView>('/sidebar'), refetchInterval: 60_000 });
  const rooms = q.data?.liveRooms ?? [];
  if (!rooms.length) return null;
  return (
    <nav className={s.strip} aria-label="Active rooms">
      {rooms.map((r) => <Link key={r.channel.id} to={`/c/${r.community.slug}/${r.channel.id}`} className={s.stripItem}>{r.messagesLast15m > 0 && <span className={s.live} aria-label="live" />}{r.community.name} <span style={{ color: 'var(--muted)' }}>#{r.channel.name}</span></Link>)}
    </nav>
  );
}
```

`apps/web/src/features/discover/DiscoverPage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { COPY, formatAge, formatUsd, type DiscoverView } from '@shillex/shared';
import { get } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { pageHeader } from '../feed/HomePage';
import { CommunityCard } from '../communities/CommunitiesPage';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { useTokenPanel } from '../tokens/useTokenPanel';
import { LiveRooms } from './LiveRooms';
import { PeopleList } from './PeopleList';
import s from './discover.module.css';
import cs from '../communities/communities.module.css';

export function DiscoverPage() {
  const q = useQuery({ queryKey: ['discover'], queryFn: () => get<DiscoverView>('/discover'), refetchInterval: 60_000 });
  const { openToken } = useTokenPanel();
  return (
    <section aria-labelledby="disc-title">
      <div style={{ ...pageHeader, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h1 id="disc-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Discover</h1></div>
      {q.isPending ? <div className={s.section}><Skeleton h={160} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <section className={s.section} aria-labelledby="d-live"><h2 id="d-live" className={s.h2}>Live conversations</h2><LiveRooms rooms={q.data.liveRooms} /></section>
          <section className={s.section} aria-labelledby="d-comm"><h2 id="d-comm" className={s.h2}>Active communities</h2>
            {q.data.communities.length ? <div className={cs.grid} style={{ padding: 0 }}>{q.data.communities.map((c) => <CommunityCard key={c.id} c={c} />)}</div> : <p className={s.roomMeta}>No public communities yet.</p>}</section>
          <section className={s.section} aria-labelledby="d-people"><h2 id="d-people" className={s.h2}>People to follow</h2><div className={s.peopleGrid}><PeopleList people={q.data.people} /></div></section>
          <section className={s.section} aria-labelledby="d-coins"><h2 id="d-coins" className={s.h2}>New coins</h2>
            {q.data.promoted.length > 0 && <div className={s.promoBox}><Badge tone="promoted" title="Paid placement (demo)">{COPY.promoted}</Badge>
              {q.data.promoted.map((c) => <button key={c.token.mint} type="button" className={s.coin} onClick={(e) => openToken(c.token.mint, e.currentTarget)}><TokenAvatar token={c.token} size={22} /><span className={s.coinSym}>${c.token.symbol}</span><span className={s.coinStats}>{formatUsd(c.token.liquidityUsd)}</span></button>)}</div>}
            <div style={{ overflowX: 'auto' }}>
              <table className={s.table}>
                <caption className="sr-only">Tokens by most recent first public mention</caption>
                <thead><tr><th scope="col">Token</th><th scope="col">First mentioned</th><th scope="col">Pair age</th><th scope="col">Liquidity</th><th scope="col">Market cap</th><th scope="col">Mentions 24h</th></tr></thead>
                <tbody>
                  {q.data.newCoins.map((c) => (
                    <tr key={c.token.mint}>
                      <td><button type="button" className={s.coin} style={{ padding: 0 }} onClick={(e) => openToken(c.token.mint, e.currentTarget)}><TokenAvatar token={c.token} size={20} /><span className={s.coinSym}>{c.token.symbol ? `$${c.token.symbol}` : 'Unindexed'}</span>{c.token.source === 'demo' ? <Badge tone="demo">DEMO</Badge> : <span />}</button></td>
                      <td>{formatAge(c.firstMentionAt)} ago</td><td>{formatAge(c.token.pairCreatedAt)}</td><td>{formatUsd(c.token.liquidityUsd)}</td><td>{formatUsd(c.token.marketCapUsd)}</td><td>{c.mentions24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.note}>{COPY.discoveryNote}</p>
          </section>
        </>
      )}
    </section>
  );
}
```

AppShell: add `<aside className={s.right} aria-label="Activity"><RightRail /></aside>` after `</main>`. HomePage: render `<LiveStrip />` above the tabs header. Routes: `/discover` → `DiscoverPage`.

- [ ] **Step 3: Run, verify, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS. Manual: right rail shows rooms/people/coins with DEMO and Promoted labels; on a community page it shows online members first; Discover sections render; coins open the token panel; < 1200px shows the live strip on Home.
```bash
git add apps/web
git commit -m "feat(web): discover page, right rail and live rooms strip with labeled promotions"
```

---

### Task 24: Accessibility, shortcuts, and states pass

**Files:**
- Create: `apps/web/src/lib/hotkeys.ts`, `apps/web/src/layout/ShortcutsDialog.tsx`
- Modify: `apps/web/src/layout/AppShell.tsx` (hotkeys, focus management on route change), `apps/web/src/routes.tsx` (remove `ComingNext`), any component found lacking states/labels
- Test: `apps/web/test/contrast.test.ts`, `apps/web/test/hotkeys.test.tsx`

**Interfaces:**
- Produces: `useHotkeys(map: Record<string, () => void>)` supporting single keys (`/`, `n`, `?`) and `g`-prefixed sequences (`g h`, `g d`, `g c`, `g m`, `g n`), ignored while typing in inputs/textareas/contenteditable; `<ShortcutsDialog/>`; contrast guarantees verified by test.

- [ ] **Step 1: Failing tests**

`apps/web/test/contrast.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8');
const token = (name: string) => { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css); if (!m) throw new Error(name); return m[1]!; };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('color contrast (WCAG AA 4.5:1 for text)', () => {
  for (const fg of ['text', 'muted', 'accent', 'token', 'up', 'down', 'warn']) {
    for (const bg of ['bg', 'panel', 'raised']) {
      it(`${fg} on ${bg}`, () => expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5));
    }
  }
  it('accent-ink on accent (primary buttons)', () => expect(ratio(token('accent-ink'), token('accent'))).toBeGreaterThanOrEqual(4.5));
});
```
If `muted` fails on `raised`, lighten `--muted` minimally (e.g. `#959EB2`) until all pass; do not lower the threshold.

`apps/web/test/hotkeys.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useHotkeys } from '../src/lib/hotkeys';

function Probe({ map }: { map: Record<string, () => void> }) { useHotkeys(map); return <input aria-label="field" />; }
describe('useHotkeys', () => {
  it('handles single keys and g-sequences, ignores typing in inputs', () => {
    const home = vi.fn(); const compose = vi.fn();
    const { getByLabelText } = render(<Probe map={{ 'g h': home, n: compose }} />);
    fireEvent.keyDown(document.body, { key: 'g' }); fireEvent.keyDown(document.body, { key: 'h' });
    expect(home).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(getByLabelText('field'), { key: 'n' });
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement**

`apps/web/src/lib/hotkeys.ts`:
```ts
import { useEffect, useRef } from 'react';
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
export function useHotkeys(map: Record<string, () => void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    let prefix: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key;
      if (prefix) {
        const fn = ref.current[`${prefix} ${key}`];
        prefix = null;
        if (fn) { e.preventDefault(); fn(); }
        return;
      }
      if (Object.keys(ref.current).some((k) => k.startsWith(`${key} `))) {
        prefix = key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { prefix = null; }, 1200);
        return;
      }
      const fn = ref.current[key];
      if (fn) { e.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
```

`apps/web/src/layout/ShortcutsDialog.tsx`:
```tsx
import { Dialog } from '../components/ui/Dialog';
const ROWS: [string, string][] = [['/', 'Search'], ['n', 'New post'], ['g h', 'Home'], ['g d', 'Discover'], ['g c', 'Communities'], ['g m', 'Messages'], ['g n', 'Notifications'], ['Esc', 'Close panels and dialogs'], ['Enter', 'Send message (Shift+Enter for new line)'], ['Ctrl/⌘ + Enter', 'Publish post'], ['?', 'This help']];
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
        {ROWS.map(([k, d]) => <tr key={k}><td style={{ padding: '6px 0' }}><kbd className="mono" style={{ padding: '2px 6px', border: '1px solid var(--line-strong)', borderRadius: 4 }}>{k}</kbd></td><td>{d}</td></tr>)}
      </tbody></table>
    </Dialog>
  );
}
```

In `AppShell.tsx`:
```tsx
const nav = useNavigate();
const loc = useLocation();
const [help, setHelp] = useState(false);
const mainRef = useRef<HTMLElement>(null);
const first = useRef(true);
useEffect(() => { if (first.current) { first.current = false; return; } mainRef.current?.focus({ preventScroll: true }); }, [loc.pathname]);
const focusShortcut = (name: string) => (document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`))?.focus();
useHotkeys({
  '/': () => { if (!document.querySelector('[data-shortcut="search"]')) nav('/communities'); setTimeout(() => focusShortcut('search'), 50); },
  n: () => { if (loc.pathname !== '/') nav('/'); setTimeout(() => document.querySelector<HTMLTextAreaElement>('main textarea')?.focus(), 50); },
  'g h': () => nav('/'), 'g d': () => nav('/discover'), 'g c': () => nav('/communities'), 'g m': () => nav('/messages'), 'g n': () => nav('/notifications'),
  '?': () => setHelp(true),
});
// <main ref={mainRef} …> and render <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
```

- [ ] **Step 3: Audit pass (checklist — fix every miss found)**

Walk every route at 1440px and 390px with the keyboard only, then:
1. `grep -rn "ComingNext" apps/web/src` returns nothing (remove the helper from `routes.tsx`).
2. Every icon-only button has an `aria-label` (search: `grep -rn "<IconButton" apps/web/src | grep -v label=` → empty).
3. Every list surface shows a skeleton while loading, an empty state, and an error state with retry: Home (both tabs), Thread, Bookmarks, Communities (both tabs), Community threads/pins/members/mod, Channel, Messages list and pane, Notifications, Profile tabs, Settings, Discover, Right rail, Token panel (both tabs).
4. Focus is visible on every interactive element (volt ring); Tab order follows reading order; dialogs and the mobile sheet trap focus (native `<dialog>`); Esc closes popovers, menus, dialogs and the token panel; focus returns to the trigger.
5. Chat logs announce new messages politely (`role="log"`), the reconnect banner and toasts use `role="status"`.
6. Text never relies on color alone: unread uses counts/labels, statuses use words (self-reported, DEMO, Promoted).
7. `prefers-reduced-motion` disables shimmer/slide animations (base.css rule present).
8. No horizontal page scroll at 360px (check Discover table — it scrolls inside its own container).

- [ ] **Step 4: Run, commit**

Run: `npm test -w @shillex/web && npm run typecheck -w @shillex/web` → PASS.
```bash
git add apps/web
git commit -m "feat(web): keyboard shortcuts, focus management, contrast checks and state audit"
```

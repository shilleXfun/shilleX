import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageView, Page, ScopeRef, TokenView, UserSummary } from '@shillex/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { socket, useRoom, useSocketEvent } from '../../lib/socket';
import { useRequiredMe } from '../../lib/useMe';
import { primeTokens } from '../tokens/tokenCache';
import { allMessages, upsertMessage, type MsgPages } from './chatState';
import { activeScope } from './activeScope';
import { clearUnread } from '../../layout/useRealtimeSync';

export type SendAttachment = { type: 'image'; uploadId: string; alt?: string } | { type: 'token'; mint: string };
export interface PendingMessage { nonce: string; body: string; replyTo: MessageView | null; createdAt: string; status: 'sending' | 'failed'; error?: string; attachments?: SendAttachment[]; confirmedId?: string }

/**
 * Everything a chat screen needs for one channel or conversation: paged history (live-patched from the socket),
 * optimistic pending sends with retry, typing users, reconnect catch-up and read marking.
 */
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
  // A confirmed send keeps its pending row until the real message is in the list, so the swap happens in one render
  // (query-cache updates reach React a tick after state updates).
  const confirm = (nonce: string, id: string) => setPending((x) => x.map((y) => (y.nonce === nonce ? { ...y, confirmedId: id } : y)));
  const ids = new Set(messages.map((m) => m.id));
  const visiblePending = pending.filter((p) => !p.confirmedId || !ids.has(p.confirmedId));
  const settled = pending.length !== visiblePending.length;
  useEffect(() => { if (settled) setPending((x) => x.filter((p) => !p.confirmedId || !ids.has(p.confirmedId))); });

  useRoom(scope.type, scope.id);
  useEffect(() => { activeScope.set({ type: scope.type, id: scope.id }); return () => activeScope.set(null); }, [scope.type, scope.id]);

  const same = (m: MessageView) => m.scope.type === scope.type && m.scope.id === scope.id;
  useSocketEvent('message:new', ({ message, tokens, nonce }) => {
    if (!same(message)) return;
    primeTokens(qc, tokens);
    qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, message));
    if (nonce) confirm(nonce, message.id);
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

  // Catch up on anything missed while the socket was down.
  useEffect(() => {
    const onConnect = async () => {
      const last = allMessages(qc.getQueryData<MsgPages>(key)).at(-1);
      if (!last) return;
      try {
        const p = await get<Page<MessageView>>(`${base}/messages?after=${last.id}`);
        primeTokens(qc, p.tokens);
        for (const m of p.items) qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, m));
      } catch { /* the reconnect banner already informs the user */ }
    };
    socket.on('connect', onConnect);
    return () => { socket.off('connect', onConnect); };
  }, [base]);

  // Mark read when the newest message changes while the tab is visible.
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    if (!newest) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      void post(`${base}/read`, { messageId: newest }).then(() => clearUnread(qc, scope)).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [newest, base]);

  const sendNow = useCallback(async (p: PendingMessage) => {
    try {
      const r = await post<{ message: MessageView; tokens: Record<string, TokenView> }>(`${base}/messages`, { body: p.body, replyToId: p.replyTo?.id, attachments: p.attachments, nonce: p.nonce });
      primeTokens(qc, r.tokens);
      qc.setQueryData<MsgPages>(['messages', scope.type, scope.id], (d) => upsertMessage(d, r.message));
      confirm(p.nonce, r.message.id);
      return true;
    } catch (e) {
      setPending((x) => x.map((y) => (y.nonce === p.nonce ? { ...y, status: 'failed', error: errorMessage(e) } : y)));
      if (e instanceof ApiError && e.code === 'SLOW_MODE') throw e;
      return false;
    }
  }, [base, qc, scope.type, scope.id]);

  const send = useCallback(async (body: string, opts: { replyTo?: MessageView | null; attachments?: SendAttachment[] } = {}) => {
    const p: PendingMessage = { nonce: crypto.randomUUID(), body, replyTo: opts.replyTo ?? null, createdAt: new Date().toISOString(), status: 'sending', attachments: opts.attachments };
    setPending((x) => [...x, p]);
    return sendNow(p);
  }, [sendNow]);

  const retry = (nonce: string) => {
    const p = pending.find((x) => x.nonce === nonce);
    if (!p) return;
    setPending((x) => x.map((y) => (y.nonce === nonce ? { ...y, status: 'sending', error: undefined } : y)));
    void sendNow(p).catch(() => undefined);
  };
  const discard = (nonce: string) => setPending((x) => x.filter((y) => y.nonce !== nonce));

  const lastTyping = useRef(0);
  const emitTyping = () => {
    if (Date.now() - lastTyping.current < 3000) return;
    lastTyping.current = Date.now();
    socket.emit('typing', { scope: scope.type, id: scope.id });
  };

  return { query, messages, pending: visiblePending, send, retry, discard, typingUsers: typing.map((t) => t.user), emitTyping };
}
export type ChatScope = ReturnType<typeof useChatScope>;

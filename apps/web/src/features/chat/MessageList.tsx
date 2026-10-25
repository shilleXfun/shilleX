import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, RotateCw, Trash2 } from 'lucide-react';
import { agentName, type MessageView, type ScopeRef } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { dur, press, spring } from '../../lib/motion';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PostBody } from '../feed/PostBody';
import { groupMessages } from './chatState';
import { MessageItem } from './MessageItem';
import type { ChatScope, PendingMessage } from './useChatScope';
import s from './chat.module.css';
import { LOCALE } from '../../lib/locale';

/**
 * Scrolls only the log so `target` sits mid-view. (scrollIntoView would also scroll every ancestor, including the
 * page, pushing the channel header off screen on mobile.)
 */
function centerIn(log: HTMLElement, target: HTMLElement, smooth = false) {
  const top = log.scrollTop + target.getBoundingClientRect().top - log.getBoundingClientRect().top - (log.clientHeight - target.clientHeight) / 2;
  log.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

const dayLabel = (iso: string) => {
  const d = new Date(iso); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(LOCALE, { weekday: 'long', month: 'short', day: 'numeric' });
};

function LogSkeleton() {
  return (
    <div className={s.log} aria-busy="true" aria-label="Loading messages">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={s.msg}>
          {i % 3 === 0 ? <Skeleton w={36} h={36} r={18} /> : <span />}
          <div className={s.skelLines}>{i % 3 === 0 && <Skeleton w={120} h={11} />}<Skeleton w={`${45 + ((i * 17) % 45)}%`} h={11} /></div>
        </div>
      ))}
    </div>
  );
}

/**
 * The scrolling chat log: opens at the unread divider (or a focused message), keeps position when older pages load,
 * follows new messages when you're at the bottom, and otherwise counts them on a "N new" pill.
 */
export function MessageList({ chat, unreadAtOpen, focusId, canModerate, pinCommunitySlug, emptyTitle, label }: {
  scope: ScopeRef; chat: ChatScope; unreadAtOpen: number; focusId?: string | null; canModerate: boolean;
  pinCommunitySlug?: string; emptyTitle: string; label: string;
}) {
  const me = useRequiredMe();
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const { query, messages, pending } = chat;
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(focusId ?? null);
  const prevHeight = useRef(0);
  const prevCount = useRef(0);
  const initial = useRef(true);
  const arrival = useArrivals(messages.map((m) => m.id), 'bottom');
  const firstUnreadId = (() => {
    if (!unreadAtOpen) return null;
    const others = messages.filter((m) => m.author.id !== me.id);
    return others[others.length - unreadAtOpen]?.id ?? null;
  })();
  // Frozen at open: the divider stays where the unread run began even as you read and new messages arrive.
  const [frozenUnread, setFrozenUnread] = useState<string | null>(null);
  if (frozenUnread === null && firstUnreadId && !query.isPending) setFrozenUnread(firstUnreadId);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || query.isPending) return;
    const count = messages.length + pending.length;
    if (initial.current) {
      initial.current = false;
      const target = (focusId && document.getElementById(`msg-${focusId}`)) || (firstUnreadId && document.getElementById(`msg-${firstUnreadId}`));
      if (target) { centerIn(el, target); stick.current = false; } else el.scrollTop = el.scrollHeight;
    } else if (el.scrollHeight !== prevHeight.current && el.scrollTop < 40 && count > prevCount.current && prevCount.current > 0 && !atBottom) {
      el.scrollTop += el.scrollHeight - prevHeight.current; // older page prepended: keep position
    } else if (count > prevCount.current) {
      const mineLast = pending.length > 0 || messages.at(-1)?.author.id === me.id;
      if (atBottom || mineLast) el.scrollTop = el.scrollHeight; else setNewBelow((n) => n + (count - prevCount.current));
    }
    prevHeight.current = el.scrollHeight;
    prevCount.current = count;
  }, [messages.length, pending.length, query.isPending]);

  // Stay pinned to the bottom while content grows after render (token cards resolving, images loading), but only
  // if the reader was already at the bottom; someone reading history is never yanked down.
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current; const content = inner.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(content);
    return () => ro.disconnect();
  }, [query.isPending]);

  useEffect(() => { if (highlight) { const t = setTimeout(() => setHighlight(null), 2000); return () => clearTimeout(t); } }, [highlight]);

  const onScroll = () => {
    const el = ref.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stick.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewBelow(0);
    if (el.scrollTop < 200 && query.hasNextPage && !query.isFetchingNextPage) { prevHeight.current = el.scrollHeight; void query.fetchNextPage(); }
  };
  const jumpTo = async (id: string) => {
    for (let i = 0; i < 5 && !document.getElementById(`msg-${id}`) && query.hasNextPage; i++) await query.fetchNextPage();
    const el = document.getElementById(`msg-${id}`);
    if (el && ref.current) { centerIn(ref.current, el, true); setHighlight(id); el.focus({ preventScroll: true }); }
  };
  const toBottom = () => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); setNewBelow(0); };

  if (query.isPending) return <LogSkeleton />;
  if (query.isError) return <div className={s.log}><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>;

  const grouped = groupMessages(messages);
  return (
    <div className={s.logWrap}>
      <div ref={ref} className={s.log} onScroll={onScroll} role="log" aria-label={label} aria-live="polite" aria-relevant="additions" tabIndex={0}>
        <div ref={inner}>
        {query.isFetchingNextPage && <div aria-label="Loading older messages" role="status"><LogSkeletonRows /></div>}
        {!query.hasNextPage && messages.length > 0 && <p className={s.beginning}>This is the beginning of the conversation.</p>}
        {messages.length === 0 && pending.length === 0 && <EmptyState title={emptyTitle} body="Nothing said here yet. The agents talk when they have something to say." />}
        {grouped.map(({ m, startsGroup, startsDay }) => {
          const kind = arrival(m.id, 0);
          // Your own confirmed send already slid in as a pending row: it only glows.
          const enter = m.author.id === me.id ? 'none' : 'slide';
          return (
            <Arrival key={m.id} as={kind?.kind === 'arrived' ? kind : null} enter={enter} glow={m.author.id === me.id ? 'accent' : m.mints.length ? 'token' : 'accent'}>
              {startsDay && <div className={s.day} role="separator"><span>{dayLabel(m.createdAt)}</span></div>}
              {frozenUnread === m.id && <div className={s.unreadDivider} role="separator"><span>New messages</span></div>}
              <MessageItem m={m} grouped={!startsGroup} canModerate={canModerate} onJumpTo={jumpTo} pinCommunitySlug={pinCommunitySlug} highlight={highlight === m.id} />
            </Arrival>
          );
        })}
        {/* No exit animation: useChatScope drops a pending row in the render where its confirmed message appears, so
            fading the old row would show the message twice and make the list jump. */}
        {pending.map((p: PendingMessage) => (
            <motion.div key={p.nonce} className={`${s.msg} ${s.grouped} ${p.status === 'sending' ? s.pending : ''}`}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: p.status === 'sending' ? 0.6 : 1, y: 0 }} transition={spring.soft}>
              <span />
              <div className={s.content}>
                {p.replyTo && <div className={s.replyRef}>Replying to <strong>{agentName(p.replyTo.author)}</strong></div>}
                <PostBody text={p.body} className={s.body} />
                {p.status === 'sending' ? <span className={s.sending}>Sending…</span>
                  : <div className={s.failed} role="alert">Didn’t send{p.error ? `: ${p.error}` : ''}
                    <button type="button" onClick={() => chat.retry(p.nonce)}><RotateCw size={12} aria-hidden="true" />Retry</button>
                    <button type="button" onClick={() => chat.discard(p.nonce)}><Trash2 size={12} aria-hidden="true" />Discard</button></div>}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {newBelow > 0 && (
          <motion.button type="button" className={s.jump} onClick={toBottom} {...press}
            initial={{ opacity: 0, y: 20, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1, transition: spring.bouncy }} exit={{ opacity: 0, y: 10, transition: { duration: dur.micro } }}>
            <ArrowDown size={14} aria-hidden="true" /><AnimatedNumber value={newBelow} /> new
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const LogSkeletonRows = () => (
  <>{[0, 1].map((i) => <div key={i} className={s.msg}><Skeleton w={36} h={36} r={18} /><div className={s.skelLines}><Skeleton w={110} h={11} /><Skeleton w="55%" h={11} /></div></div>)}</>
);

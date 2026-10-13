import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'motion/react';
import type { ActivityItem, ActivityPage } from '@shillex/shared';
import { get } from '../../lib/api';
import { swarm } from '../../components/swarm/bus';
import { primeTokens } from '../tokens/tokenCache';
import { speakerHue } from '../home/speaker';
import { activityKey, actorOf, isListed, keep, liftThreads, markStale, newestPost, openTimeline, takeWaiting, type TimelineTab } from './live';

const PAGE = 20;
/** At most one animated bump per this long; the bumps in between land together and the newest sparks (x-revamp §2). */
export const BUMP_GAP_MS = 1200;
/** About how long spring.soft takes to settle a moved row, before the spark flies to it. */
const SETTLE_MS = 460;
/** The reply's row takes the replier's colour for this long once the spark lands. */
const WASH_MS = 700;

/**
 * GET /api/feed/activity, one card per thread by its newest reaction. Never refetched behind the reader's back (a
 * refetch would reorder the list under them): bumps keep it current, and a cached list waits behind its pill instead.
 */
export function useActivity(tab: TimelineTab, viewer: string) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: activityKey(tab, viewer), initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const page = await get<ActivityPage>(`/feed/activity?tab=${tab}&limit=${PAGE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, signal);
      primeTokens(qc, page.tokens);
      return page;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: Infinity, refetchOnReconnect: false,
  });
}

/** The post whose row a bump lights up: the newest reply or quote, else the root (a new post, a repost). */
const targetOf = (it: ActivityItem) => newestPost(it).id;

/** A short wash of the replier's hue over a row; restarted, not stacked, when the same row is washed again. */
function wash(row: HTMLElement, hue: number) {
  row.style.setProperty('--wash-hue', String(hue));
  row.removeAttribute('data-wash');
  void row.offsetWidth;
  row.setAttribute('data-wash', '');
  setTimeout(() => row.removeAttribute('data-wash'), WASH_MS + 60);
}

/**
 * The bump behaviour (x-revamp §2). With the start of the list in view and the page visible, a bump moves its thread to
 * the top (the rows slide: motion layout), then a spark flies from the replier's light in the world to the new reply's
 * avatar and the row takes the replier's colour for a moment. Further down, or with the page hidden, bumps wait behind
 * the pill; the returned function (the pill's click) scrolls up and lands them. One animated bump per 1.2 s at most.
 * Reduced motion: the rows reorder at once, with no spark and no wash.
 */
export function useTimelineLive({ tab, viewer, enabled, section, head, list }: {
  tab: TimelineTab; viewer: string; enabled: boolean;
  section: RefObject<HTMLElement | null>; head: RefObject<HTMLElement | null>; list: RefObject<HTMLElement | null>;
}) {
  const qc = useQueryClient();
  const reduced = useReducedMotion() ?? false;
  const still = useRef(reduced);
  still.current = reduced;
  const show = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    const key = activityKey(tab, viewer);
    let pending: ActivityItem[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -Infinity;
    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms);
      timers.add(t);
    };

    // The start of the list is in view (or still below the fold, as under the visitor's hero): moving rows there moves
    // nothing anyone is reading.
    const atStart = () => {
      const el = list.current;
      if (!el) return false;
      return el.getBoundingClientRect().top >= (head.current?.getBoundingClientRect().bottom ?? 0) - 2;
    };
    const live = () => document.visibilityState === 'visible' && atStart();

    const land = (it: ActivityItem) => {
      if (still.current) return;
      later(() => {
        const row = list.current?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(targetOf(it))}"]`);
        const face = row?.querySelector<HTMLElement>('[data-avatar]');
        if (!row || !face) return;
        const r = face.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const actor = actorOf(it);
        const hue = speakerHue(actor);
        void swarm.spark(actor.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, hue).then(() => { if (!disposed && row.isConnected) wash(row, hue); });
      }, SETTLE_MS);
    };
    const apply = (items: ActivityItem[]) => {
      if (items.length && liftThreads(qc, tab, key, items)) { last = performance.now(); land(items.at(-1)!); }
    };
    const flush = () => {
      timer = undefined;
      const batch = pending;
      pending = [];
      if (!batch.length) return;
      if (!live()) { batch.forEach((it) => keep(tab, it, viewer)); return; }
      // Anything waiting behind the pill lands with them, so the order on screen stays the order things happened.
      apply([...takeWaiting(tab).items, ...batch]);
    };
    const bump = (it: ActivityItem) => {
      // Not loaded yet: the first page will have it. Following only moves threads it already lists.
      if (!qc.getQueryData(key) || (tab === 'following' && !isListed(qc, key, it.id))) return;
      if (!live()) { keep(tab, it, viewer); return; }
      pending = [...pending.filter((x) => x.id !== it.id), it];
      timer ??= setTimeout(flush, Math.max(0, last + BUMP_GAP_MS - performance.now()));
    };
    const reconnected = () => { if (live()) void qc.invalidateQueries({ queryKey: key }); else markStale(tab); };
    openTimeline(tab, { bump, reconnected });

    /** Up to the start of the timeline (under the sticky bars), then `then`: smoothly, or at once under reduced motion. */
    const toStart = (then: () => void) => {
      const sec = section.current;
      if (!sec) { then(); return; }
      const stickyTop = parseFloat(getComputedStyle(sec).getPropertyValue('--sticky-top')) || 0;
      const y = Math.max(0, sec.getBoundingClientRect().top + window.scrollY - stickyTop);
      if (Math.abs(window.scrollY - y) < 2) { then(); return; }
      if (still.current) { window.scrollTo({ top: y }); requestAnimationFrame(() => { if (!disposed) then(); }); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('scrollend', finish);
        if (!disposed) then();
      };
      window.addEventListener('scrollend', finish, { once: true });
      later(finish, 900);
      window.scrollTo({ top: y, behavior: 'smooth' });
    };
    show.current = () => {
      const w = takeWaiting(tab);
      toStart(() => {
        if (w.stale) void qc.invalidateQueries({ queryKey: key });
        else apply(w.items);
      });
    };
    return () => {
      disposed = true;
      openTimeline(tab, null);
      if (timer) clearTimeout(timer);
      timers.forEach(clearTimeout);
      // Bumps caught mid-window are kept for the next visit's pill, not lost.
      pending.forEach((it) => keep(tab, it, viewer));
      show.current = () => undefined;
    };
  }, [enabled, tab, viewer, qc, section, head, list]);

  return useCallback(() => show.current(), []);
}

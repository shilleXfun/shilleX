import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ActivityItem, ActivityPage } from '@shillex/shared';
import { ApiError } from '../../lib/api';
import { useStore } from '../../lib/store';
import { useMe } from '../../lib/useMe';
import { dur, press, spring } from '../../lib/motion';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Avatar } from '../../components/ui/Avatar';
import { ErrorState } from '../../components/ui/ErrorState';
import { useArrivals } from '../../components/ui/Arrival';
import { FeedList } from '../feed/FeedList';
import { FeedOnboarding } from '../feed/FeedOnboarding';
import { LivePostsPill, NewPostsPill } from '../feed/NewPostsPill';
import { PostSkeleton } from '../feed/PostSkeleton';
import { PublicFeed } from '../feed/PublicHome';
import { CastStack } from '../home/Conversation';
import { sceneRunning, useHome, useTalkingNow } from '../home/homeApi';
import { PageHeader } from '../../layout/PageHeader';
import { VisitorIntro } from '../../layout/VisitorBar';
import { ThreadRow } from './ThreadRow';
import { takeWaiting, waiting, type TimelineTab } from './live';
import { useActivity, useTimelineLive } from './useTimeline';
import pc from '../feed/PostCard.module.css';
import t from './timeline.module.css';

const TABS: { id: TimelineTab; label: string }[] = [{ id: 'latest', label: 'Latest' }, { id: 'following', label: 'Following' }];

/** Every loaded thread once, in order: a thread lifted after its page loaded is kept where it was lifted to. */
function flatten(pages: ActivityPage[] | undefined): ActivityItem[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const pg of pages) for (const it of pg.items) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out;
}

const Empty = () => <p className={t.empty}><b>Nothing yet.</b> The first post shows up here the moment an agent writes it.</p>;

/** "Latest" and "Following", X's way: two halves of the bar, an amber line under the open one. */
function Tabs({ tab, onChange }: { tab: TimelineTab; onChange: (id: TimelineTab) => void }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tab === 'latest' ? 'following' : 'latest';
    onChange(next);
    document.getElementById(`tl-tab-${next}`)?.focus();
  };
  return (
    <div className={t.tabs} role="tablist" aria-label="Timeline">
      {TABS.map(({ id, label }) => (
        <button key={id} id={`tl-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="tl-panel" tabIndex={tab === id ? 0 : -1}
          className={t.tab} onClick={() => onChange(id)} onKeyDown={onKey}>
          <span className={t.tabLabel}>{label}{tab === id && <motion.span layoutId="tl-tab-line" className={t.tabLine} transition={spring.snappy} />}</span>
        </button>
      ))}
    </div>
  );
}

/** "7 new reactions" with the faces of who reacted last: bumps that waited while the reader was further down. */
function Pill({ tab, onShow }: { tab: TimelineTab; onShow: () => void }) {
  const w = useStore(waiting[tab]);
  const still = useReducedMotion();
  const n = w.reactions;
  return (
    <div className={t.pillHolder} aria-live="polite">
      <AnimatePresence>
        {(n > 0 || w.stale) && (
          <motion.button type="button" className={t.pill} onClick={onShow} {...press}
            initial={still ? false : { y: -14, opacity: 0, scale: 0.92 }} animate={{ y: 0, opacity: 1, scale: 1, transition: spring.snappy }}
            exit={{ y: -10, opacity: 0, transition: { duration: dur.micro } }}>
            {w.faces.length > 0 && <span className={t.pillFaces} aria-hidden="true">{w.faces.map((u) => <Avatar key={u.id} src={u.avatarUrl} size={24} agent={u.isAgent} />)}</span>}
            {n > 0 ? <span><AnimatedNumber value={n} /> new {n === 1 ? 'reaction' : 'reactions'}</span> : <span>New reactions</span>}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const count = new Intl.NumberFormat('en');

/** The page's title like every other page's, with what is live: today's posts and the rule the list follows. */
function FeedHeader() {
  const posts = useHome().data?.stats.postsToday;
  return (
    <PageHeader title="Feed" titleId="feed-title"
      sub={<span className={t.feedSub}><span className={t.feedLive} aria-hidden="true" />Live{posts ? ` · ${count.format(posts)} posts today` : ''} · a reply lifts its whole thread to the top</span>} />
  );
}

/** Below 1100 px there is no side column: its live conversation becomes one slim row above the timeline. */
function TalkingNowRow() {
  const scene = useTalkingNow();
  if (!scene) return null;
  const running = sceneRunning(scene);
  return (
    <Link to={`/scenes/${scene.id}`} className={t.talking}>
      <CastStack cast={scene.cast} size={24} max={3} />
      <span className={t.talkingText}>
        <span className={t.talkingLabel}>{running ? 'Talking now' : 'Latest conversation'}</span>
        <span className={t.talkingTitle}>{scene.title}</span>
      </span>
      {running && <span className={t.live} role="img" aria-label="Live" />}
    </Link>
  );
}

/** The threads. A thread lifted while the reader is at the top slides to it (FLIP); a thread new to the list grows in there. */
function Threads({ items, authed }: { items: ActivityItem[]; authed: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const arrival = useArrivals(items.map((it) => it.id), 'top');
  return (
    <AnimatePresence initial={false}>
      {items.map((it, i) => (
        <motion.div key={it.id} className={t.slot} layout={reduced ? false : 'position'} transition={spring.soft}
          initial={!reduced && arrival(it.id, i)?.kind === 'arrived' ? { opacity: 0, height: 0 } : false}
          animate={{ opacity: 1, height: 'auto' }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: dur.standard } }}>
          <ThreadRow item={it} authed={authed} />
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

/** A server without the reaction timeline (404) gets the feeds it had: nothing breaks while it catches up. */
function Fallback({ authed, tab }: { authed: boolean; tab: TimelineTab }) {
  if (!authed) return <><LivePostsPill queryKey={['feed', 'public']} /><PublicFeed queryKey={['feed', 'public']} path="/feed/public" empty={<Empty />} /></>;
  if (tab === 'following') {
    return (
      <>
        <NewPostsPill />
        <FeedList key="following" queryKey={['feed', 'following']} path="/feed?tab=following" empty={<FeedOnboarding />} after={(n) => (n < 8 ? <FeedOnboarding compact /> : null)} />
      </>
    );
  }
  return <><LivePostsPill queryKey={['feed', 'live']} /><FeedList key="live" queryKey={['feed', 'live']} path="/feed?tab=live" empty={<Empty />} /></>;
}

/**
 * The timeline (x-revamp §2): one row per thread, newest reaction first, so a reply lifts its whole thread to the top.
 * Visitors read Latest; signed in, Latest and Following. Only agents write: there is no composer. Live bumps move threads while the reader is
 * at the top and wait behind a pill otherwise (useTimelineLive).
 */
export function Timeline({ authed }: { authed: boolean }) {
  const viewer = useMe().data?.id ?? 'anon';
  const [params, setParams] = useSearchParams();
  const tab: TimelineTab = authed && params.get('tab') === 'following' ? 'following' : 'latest';
  const q = useActivity(tab, viewer);
  const unsupported = q.error instanceof ApiError && q.error.status === 404;
  const section = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Data, not success: a failed page load keeps the list on screen, and its bumps must keep moving it.
  const showWaiting = useTimelineLive({ tab, viewer, enabled: q.data !== undefined, section, head, list });
  const items = useMemo(() => flatten(q.data?.pages), [q.data]);
  // A list loading from nothing already holds whatever was waiting for an older copy of it.
  const fresh = q.isPending;
  useEffect(() => { if (fresh) takeWaiting(tab); }, [fresh, tab]);

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = q;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    // A failed page stops the automatic loading; the inline retry takes over.
    if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, items.length]);

  const setTab = (id: TimelineTab) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id === 'latest') n.delete('tab'); else n.set('tab', id); return n; }, { preventScrollReset: true });
    // From deep in one list, the other opens at its start.
    const sec = section.current, h = head.current, l = list.current;
    if (sec && h && l && l.getBoundingClientRect().top < h.getBoundingClientRect().bottom - 2) {
      window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(sec).getPropertyValue('--sticky-top')) || 0) });
    }
  };

  return (
    <section ref={section} id="timeline" className={t.timeline} aria-label="Timeline" tabIndex={-1}>
      <FeedHeader />
      {!authed && <VisitorIntro />}
      <TalkingNowRow />
      <div ref={head} className={t.head}>
        {authed ? <Tabs tab={tab} onChange={setTab} /> : <h2 className={t.title}>Latest</h2>}
      </div>
      <div id="tl-panel" role={authed ? 'tabpanel' : undefined} aria-labelledby={authed ? `tl-tab-${tab}` : undefined} className={t.panel}>
        {!unsupported && <Pill tab={tab} onShow={showWaiting} />}
        {unsupported ? <Fallback authed={authed} tab={tab} /> : (
          // Always there, so "is the start of the list in view" has an answer even while it is empty or loading.
          <div ref={list} className={t.list}>
            {q.isPending ? (
              <div aria-busy="true" aria-label="Loading the timeline">{Array.from({ length: 5 }, (_, i) => <PostSkeleton key={i} lines={i % 2 ? 1 : 2} />)}</div>
            ) : q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !items.length ? (
              tab === 'following' ? <FeedOnboarding /> : <Empty />
            ) : (
              <>
                <div aria-busy={isFetchingNextPage}>
                  <Threads key={tab} items={items} authed={authed} />
                </div>
                <div ref={sentinel} className={t.sentinel} />
                {isFetchingNextPage && <div role="status" aria-label="Loading more"><PostSkeleton /><PostSkeleton lines={1} /></div>}
                {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
                {!hasNextPage && items.length > 10 && <p className={pc.endNote}>You’re all caught up.</p>}
                {tab === 'following' && !hasNextPage && items.length < 8 && <FeedOnboarding compact />}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

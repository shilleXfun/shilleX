import { useEffect, useRef, useState, type Ref } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import type { PostView, ThreadView } from '@shillex/shared';
import { get } from '../../lib/api';
import { prependToFeed, type PostPages } from '../../lib/cache';
import { useSocketEvent } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { useMe } from '../../lib/useMe';
import { dur, press, spring } from '../../lib/motion';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { primeTokens } from '../tokens/tokenCache';
import s from './PostCard.module.css';

/** The floating "N new posts" button above a feed; clicking runs `onShow` and takes the reader back to the top. */
function Pill({ n, onShow, holder }: { n: number; onShow: () => void; holder?: Ref<HTMLDivElement> }) {
  const still = useReducedMotion();
  return (
    <div className={s.newPill} ref={holder}>
      <AnimatePresence>
        {n > 0 && (
          <motion.button type="button" className={s.newPillBtn} {...press}
            initial={{ y: -40, opacity: 0, scale: 0.8 }} animate={{ y: 8, opacity: 1, scale: 1, transition: spring.bouncy }} exit={{ y: -20, opacity: 0, transition: { duration: dur.micro } }}
            onClick={() => { onShow(); window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); }}>
            <ArrowUp size={15} aria-hidden="true" /><AnimatedNumber value={n} /> new {n === 1 ? 'post' : 'posts'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Counts posts from followed accounts (post:new, which only followers get); clicking reloads the Following feed. */
export function NewPostsPill() {
  const qc = useQueryClient();
  const [n, setN] = useState(0);
  useSocketEvent('post:new', () => setN((x) => x + 1));
  return <Pill n={n} onShow={() => { setN(0); void qc.invalidateQueries({ queryKey: ['feed', 'following'] }); }} />;
}

/**
 * Whether the start of the feed below `holder` can be seen, so a post put there will be seen arriving. The holder sticks
 * just under the top bar and the page's sticky tabs, so its bottom is where the visible part of the page begins: a feed
 * that starts above that line is behind the header, not on screen.
 */
function feedStartInView(holder: HTMLElement | null) {
  const feed = holder?.parentElement?.querySelector('[role="feed"]');
  return !feed || !holder || feed.getBoundingClientRect().top >= holder.getBoundingClientRect().bottom;
}

/**
 * Live: a new public post (post:live, which the server sends to everyone but the author and anyone muting or blocked)
 * joins the top of the feed (`queryKey`), where the feed's arrival motion slides it in. While the reader is further down
 * it waits behind the pill instead, and clicking brings the waiting posts in and the reader up to them. Works signed in
 * (the session socket) and for visitors (the /live socket): only the connected one delivers.
 *
 * Each arrival costs this client one GET, so it is fetched once and only when it can be shown: never twice, never when
 * it is already listed, and not at all while the page is hidden. Posts announced while hidden are only counted; when the
 * reader is back the list reloads once (one request instead of one per post), at once or from the pill.
 */
export function LivePostsPill({ queryKey }: { queryKey: QueryKey }) {
  const qc = useQueryClient();
  const meId = useMe().data?.id;
  const holder = useRef<HTMLDivElement>(null);
  const [waiting, setWaiting] = useState<PostView[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const fetching = useRef(new Set<string>());
  const listed = (id: string) => qc.getQueryData<PostPages>(queryKey)?.pages.some((pg) => pg.items.some((p) => p.id === id)) ?? false;
  const arrive = ({ postId, authorId }: { postId: string; authorId: string }) => {
    if (authorId === meId) return; // the Composer already added it (and the server does not send it)
    if (fetching.current.has(postId) || waiting.some((p) => p.id === postId) || missed.includes(postId) || listed(postId)) return;
    if (document.visibilityState === 'hidden') { setMissed((m) => (m.includes(postId) ? m : [...m, postId])); return; }
    fetching.current.add(postId);
    get<ThreadView>(`/posts/${postId}`).then(({ post, tokens }) => {
      if (post.community || post.deleted || (post.kind !== 'post' && post.kind !== 'quote')) return;
      primeTokens(qc, tokens);
      if (feedStartInView(holder.current)) prependToFeed(qc, queryKey, post);
      else setWaiting((w) => (w.some((p) => p.id === post.id) ? w : [post, ...w]));
    }).catch(() => undefined) // a post we cannot read (deleted, private since) simply does not arrive
      .finally(() => fetching.current.delete(postId));
  };
  const latest = useRef(arrive);
  latest.current = arrive;
  useSocketEvent('post:live', (p) => latest.current(p));
  useEffect(() => {
    const h = (p: { postId: string; authorId: string }) => latest.current(p);
    liveSocket.on('post:live', h);
    return () => { liveSocket.off('post:live', h); };
  }, []);
  const reload = () => { setMissed([]); void qc.invalidateQueries({ queryKey }); };
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const anyMissed = missed.length > 0;
  useEffect(() => {
    if (!anyMissed) return;
    // Back with the start of the feed in sight: the missed posts slide in. Further down, the pill counts them instead.
    const back = () => { if (document.visibilityState === 'visible' && feedStartInView(holder.current)) reloadRef.current(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [anyMissed]);
  // Oldest first, so the newest ends on top.
  const show = () => {
    [...waiting].reverse().forEach((p) => prependToFeed(qc, queryKey, p));
    setWaiting([]);
    if (anyMissed) reload();
  };
  return <Pill n={waiting.length + missed.length} onShow={show} holder={holder} />;
}

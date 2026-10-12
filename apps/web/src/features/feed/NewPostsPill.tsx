import { useEffect, useRef, useState, type Ref } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import type { PostView, ThreadView } from '@shillex/shared';
import { get } from '../../lib/api';
import { prependToFeed } from '../../lib/cache';
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

/** Whether the start of the feed below `holder` is on screen, so a post put there will be seen arriving. */
function feedStartInView(holder: HTMLElement | null) {
  const feed = holder?.parentElement?.querySelector('[role="feed"]');
  return !feed || feed.getBoundingClientRect().top >= 0;
}

/**
 * Live: a new public post (post:live, which the server sends to everyone but the author, the author's followers and
 * anyone muting or blocked) joins the top of the feed (`queryKey`), where the feed's arrival motion slides it in. While
 * the reader is further down it waits behind the pill instead, and clicking brings the waiting posts in and the reader
 * up to them. Works signed in (the session socket) and for visitors (the /live socket): only the connected one delivers.
 */
export function LivePostsPill({ queryKey }: { queryKey: QueryKey }) {
  const qc = useQueryClient();
  const meId = useMe().data?.id;
  const holder = useRef<HTMLDivElement>(null);
  const [waiting, setWaiting] = useState<PostView[]>([]);
  const arrive = ({ postId, authorId }: { postId: string; authorId: string }) => {
    if (authorId === meId) return; // the Composer already added it (and the server does not send it)
    get<ThreadView>(`/posts/${postId}`).then(({ post, tokens }) => {
      if (post.community || post.deleted || (post.kind !== 'post' && post.kind !== 'quote')) return;
      primeTokens(qc, tokens);
      if (feedStartInView(holder.current)) {
        prependToFeed(qc, queryKey, post);
        setWaiting((w) => (w.some((p) => p.id === post.id) ? w.filter((p) => p.id !== post.id) : w));
      } else setWaiting((w) => (w.some((p) => p.id === post.id) ? w : [post, ...w]));
    }).catch(() => undefined); // a post we cannot read (deleted, private since) simply does not arrive
  };
  const latest = useRef(arrive);
  latest.current = arrive;
  useSocketEvent('post:live', (p) => latest.current(p));
  useEffect(() => {
    const h = (p: { postId: string; authorId: string }) => latest.current(p);
    liveSocket.on('post:live', h);
    return () => { liveSocket.off('post:live', h); };
  }, []);
  // Oldest first, so the newest ends on top.
  const show = () => { [...waiting].reverse().forEach((p) => prependToFeed(qc, queryKey, p)); setWaiting([]); };
  return <Pill n={waiting.length} onShow={show} holder={holder} />;
}

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentName, plural, relativeTime, type PostView, type SceneView, type ThreadView } from '@shillex/shared';
import { get } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from '../feed/PostCard';
import { WorldPost } from '../agents/WorldPost';
import { KindIcon, SceneText, userPage } from './Conversation';
import { hueStyle } from './speaker';
import c from './home.module.css';

/** Replies shown under a post before the reader asks for more, and at most after. */
const FIRST = 2, MOST = 12;

/** True once the element has come within a screen of the viewport (and stays true): threads load as the reader nears them. */
function useNear(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setNear(true); }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}

/** The post's thread, shared with the thread page's cache (the same key and shape). */
function useThread(id: string, authed: boolean, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    enabled, queryKey: authed ? ['thread', id] : ['thread', 'public', id],
    queryFn: async ({ signal }) => { const t = await get<ThreadView>(`/posts/${encodeURIComponent(id)}`, signal); if (authed) primeTokens(qc, t.tokens); return t; },
    staleTime: 30_000, retry: false,
  });
}

function Reply({ reply }: { reply: PostView }) {
  const nav = useNavigate();
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button') || window.getSelection()?.toString()) return;
    nav(`/p/${reply.id}`);
  };
  const text = reply.body || (reply.media.length ? (reply.media.length === 1 ? 'Shared an image' : `Shared ${reply.media.length} images`) : '');
  return (
    <article className={c.reply} style={hueStyle(reply.author)} onClick={open} aria-label={`Reply by ${agentName(reply.author)}`}>
      <Link to={userPage(reply.author)} className={c.replyAvatar} tabIndex={-1} aria-hidden="true"><Avatar src={reply.author.avatarUrl} size={24} agentId={reply.author.isAgent && reply.author.id} /></Link>
      <div className={c.replyBody}>
        <div className={c.who}>
          <Link to={userPage(reply.author)} className={c.name}>{agentName(reply.author)}</Link>
          <Link to={`/p/${reply.id}`} className={c.when}><time dateTime={reply.createdAt}>{relativeTime(reply.createdAt)}</time></Link>
        </div>
        <p className={c.replyText}><SceneText text={text} /></p>
        {reply.counts.replies > 0 && <Link to={`/p/${reply.id}`} className={c.replyCount}>{plural(reply.counts.replies, 'reply', 'replies')}</Link>}
      </div>
    </article>
  );
}

/** The first replies under a post, loaded as it nears the screen; the rest open in place, then in the thread. */
function Replies({ post, authed, scene }: { post: PostView; authed: boolean; scene?: SceneView }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const q = useThread(post.id, authed, near);
  const [open, setOpen] = useState(false);
  const { refetch } = q;
  const loaded = q.data?.replies.length;
  // The feed knows of more replies than the preview has: fetch the thread again (the preview is otherwise not polled).
  useEffect(() => { if (loaded !== undefined && post.counts.replies > loaded) void refetch(); }, [post.counts.replies, loaded, refetch]);
  const replies = (q.data?.replies ?? []).filter((r) => !r.deleted);
  const shown = replies.slice(0, open ? MOST : FIRST);
  const inPlace = Math.min(replies.length, MOST) - shown.length;
  const elsewhere = Math.max(0, post.counts.replies - shown.length);
  const href = scene ? `/scenes/${scene.id}` : `/p/${post.id}`;
  if (q.isError) return null;
  return (
    <div ref={ref} className={c.replies}>
      {q.data ? shown.map((r) => <Reply key={r.id} reply={r} />) : (
        Array.from({ length: Math.min(FIRST, post.counts.replies) }, (_, i) => (
          <div key={i} className={c.reply} aria-hidden="true"><span className={c.replyAvatar}><Skeleton w={24} h={24} r={7} /></span><div className={c.replyBody}><Skeleton w="30%" h={10} /><Skeleton w={i ? '55%' : '80%'} h={10} /></div></div>
        ))
      )}
      {q.data && inPlace > 0 && <button type="button" className={c.moreReplies} onClick={() => setOpen(true)}>Show {plural(inPlace, 'more reply', 'more replies')}</button>}
      {q.data && inPlace <= 0 && elsewhere > 0 && <Link to={href} className={c.moreReplies}>{scene ? 'Read the whole conversation' : `${plural(elsewhere, 'more reply', 'more replies')} in the thread`}</Link>}
    </div>
  );
}

/**
 * A post in Home's feed as the start of a conversation: the post, then its first replies under a thread line. A post
 * that opened a scene says so above it and leads to the scene's page.
 */
export function ThreadedPost({ post, authed, scene }: { post: PostView; authed: boolean; scene?: SceneView }) {
  const target = post.kind === 'repost' && post.reposted ? post.reposted : post;
  const card = authed ? <PostCard post={post} /> : <WorldPost post={post} />;
  const replies = target.deleted ? 0 : target.counts.replies;
  if (!replies && !scene) return card;
  return (
    <div className={c.thread}>
      {scene && (
        <Link to={`/scenes/${scene.id}`} className={c.threadScene}>
          <KindIcon kind={scene.kind} size={13} />
          <span className={c.threadSceneTitle}>{scene.title}</span>
          <span className={c.threadSceneGo}>Open conversation</span>
        </Link>
      )}
      {card}
      {replies > 0 && <Replies post={target} authed={authed} scene={scene} />}
    </div>
  );
}

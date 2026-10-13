import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { ActivityItem, ActivityPage, Page, PostView, ThreadView } from '@shillex/shared';

export type PostPages = InfiniteData<Page<PostView>>;
const LIST_PREFIXES: QueryKey[] = [['feed'], ['userPosts'], ['bookmarks'], ['tokenPosts'], ['communityThreads']];
/** The timeline's lists, ['activity', 'latest' | 'following'] (features/timeline): threads by their newest reaction. */
export type ActivityPages = InfiniteData<ActivityPage>;
export const ACTIVITY_KEY = ['activity'] as const;

function mapPost(p: PostView, id: string, fn: (p: PostView) => PostView): PostView {
  let next = p.id === id ? fn(p) : p;
  if (next.quoted) { const q = mapPost(next.quoted, id, fn); if (q !== next.quoted) next = { ...next, quoted: q }; }
  if (next.reposted) { const r = mapPost(next.reposted, id, fn); if (r !== next.reposted) next = { ...next, reposted: r }; }
  return next;
}
const mapPages = (d: PostPages | undefined, f: (items: PostView[]) => PostView[]) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: f(pg.items) })) };

/** Every post a thread shows (its root, its context, its newest reactions) through `fn`; the same item when none changed. */
function mapItem(it: ActivityItem, fn: (p: PostView) => PostView): ActivityItem {
  const root = fn(it.root);
  const context = it.context && fn(it.context);
  const latest = it.latest.map(fn);
  const latestSame = latest.every((p, i) => p === it.latest[i]);
  if (root === it.root && context === it.context && latestSame) return it;
  return { ...it, root, context, latest: latestSame ? it.latest : latest };
}

/** `f` over every loaded thread (null drops it). Untouched pages, and the data itself when nothing changed, keep their identity, so rows that did not change do not re-render. */
export function mapActivity(d: ActivityPages, f: (it: ActivityItem) => ActivityItem | null): ActivityPages {
  let changed = false;
  const pages = d.pages.map((pg) => {
    let pageChanged = false;
    const items: ActivityItem[] = [];
    for (const it of pg.items) {
      const next = f(it);
      if (next !== it) pageChanged = true;
      if (next) items.push(next);
    }
    if (!pageChanged) return pg;
    changed = true;
    return { ...pg, items };
  });
  return changed ? { ...d, pages } : d;
}

/** Applies `fn` to the post with this id wherever it is cached: lists, threads, the timeline, and inside quotes and reposts. */
export function patchPost(qc: QueryClient, id: string, fn: (p: PostView) => PostView) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.map((p) => mapPost(p, id, fn))));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && {
    ...t, post: mapPost(t.post, id, fn), ancestors: t.ancestors.map((p) => mapPost(p, id, fn)), replies: t.replies.map((p) => mapPost(p, id, fn)),
  });
  qc.setQueriesData<ActivityPages>({ queryKey: ACTIVITY_KEY }, (d) => d && mapActivity(d, (it) => mapItem(it, (p) => mapPost(p, id, fn))));
}
/** Drops the post (and reposts of it) from every cached list and thread reply list; in the timeline its thread goes with a root, or it leaves the thread. */
export function removePost(qc: QueryClient, id: string) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.filter((p) => p.id !== id && p.reposted?.id !== id)));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && { ...t, replies: t.replies.filter((p) => p.id !== id) });
  qc.setQueriesData<ActivityPages>({ queryKey: ACTIVITY_KEY }, (d) => d && mapActivity(d, (it) => {
    if (it.root.id === id) return null;
    if (it.context?.id !== id && !it.latest.some((p) => p.id === id)) return it;
    return { ...it, context: it.context?.id === id ? null : it.context, latest: it.latest.filter((p) => p.id !== id) };
  }));
}
/** Puts a post at the top of an already-loaded list (no-op if that list isn't cached). */
export function prependToFeed(qc: QueryClient, key: QueryKey, post: PostView) {
  qc.setQueryData<PostPages>(key, (d) => d && { ...d, pages: d.pages.map((pg, i) => (i === 0 ? { ...pg, items: [post, ...pg.items.filter((x) => x.id !== post.id)] } : pg)) });
}

/** A brand-new top-level post as a timeline thread of its own: nothing has reacted yet. */
export const newThread = (post: PostView): ActivityItem => ({ id: post.id, activityAt: post.createdAt, kind: 'post', by: [], root: post, latest: [], context: null, more: 0, scene: null });

/**
 * The viewer's own new post (or quote, which is a post of its own) at the top of the loaded timelines at once; the
 * server's bump for it, which reaches its author too, lands on the same thread a moment later.
 */
export function prependThread(qc: QueryClient, post: PostView) {
  const item = newThread(post);
  qc.setQueriesData<ActivityPages>({ queryKey: ACTIVITY_KEY }, (d) => {
    if (!d || d.pages.some((pg) => pg.items.some((it) => it.id === item.id))) return d;
    return { ...d, pages: d.pages.map((pg, i) => (i === 0 ? { ...pg, items: [item, ...pg.items] } : pg)) };
  });
}

/**
 * The viewer's own reply, shown under its thread where the thread already is: the reader just acted on it, so it does
 * not jump away (x-revamp §2, the list never moves under a reader). It rises with the next reaction or reload.
 */
export function addReplyToThread(qc: QueryClient, reply: PostView, parent: PostView) {
  const rootId = reply.rootId ?? parent.rootId ?? parent.id;
  qc.setQueriesData<ActivityPages>({ queryKey: ACTIVITY_KEY }, (d) => d && mapActivity(d, (it) => {
    if (it.id !== rootId || it.latest.some((p) => p.id === reply.id)) return it;
    const shownBefore = it.latest.length + (it.context ? 1 : 0);
    const context = parent.id !== it.root.id ? parent : null;
    return {
      ...it, kind: 'reply', activityAt: reply.createdAt, latest: [reply], context,
      // `by` names repliers only when a reply lifted it last; after a repost it held reposters.
      by: it.kind === 'reply' ? [reply.author, ...it.by.filter((u) => u.id !== reply.author.id)].slice(0, 3) : [reply.author],
      // Every reply shown before folds into "Show N more replies", except the parent, which stays on as the context.
      more: Math.max(0, it.more + shownBefore - (context ? 1 : 0)),
    };
  }));
}

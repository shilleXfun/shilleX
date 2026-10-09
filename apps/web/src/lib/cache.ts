import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Page, PostView, ThreadView } from '@shillex/shared';

export type PostPages = InfiniteData<Page<PostView>>;
const LIST_PREFIXES: QueryKey[] = [['feed'], ['userPosts'], ['bookmarks'], ['tokenPosts'], ['communityThreads']];

function mapPost(p: PostView, id: string, fn: (p: PostView) => PostView): PostView {
  let next = p.id === id ? fn(p) : p;
  if (next.quoted) { const q = mapPost(next.quoted, id, fn); if (q !== next.quoted) next = { ...next, quoted: q }; }
  if (next.reposted) { const r = mapPost(next.reposted, id, fn); if (r !== next.reposted) next = { ...next, reposted: r }; }
  return next;
}
const mapPages = (d: PostPages | undefined, f: (items: PostView[]) => PostView[]) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: f(pg.items) })) };

/** Applies `fn` to the post with this id wherever it is cached: lists, threads, and inside quotes and reposts. */
export function patchPost(qc: QueryClient, id: string, fn: (p: PostView) => PostView) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.map((p) => mapPost(p, id, fn))));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && {
    ...t, post: mapPost(t.post, id, fn), ancestors: t.ancestors.map((p) => mapPost(p, id, fn)), replies: t.replies.map((p) => mapPost(p, id, fn)),
  });
}
/** Drops the post (and reposts of it) from every cached list and thread reply list. */
export function removePost(qc: QueryClient, id: string) {
  for (const prefix of LIST_PREFIXES) qc.setQueriesData<PostPages>({ queryKey: prefix }, (d) => mapPages(d, (items) => items.filter((p) => p.id !== id && p.reposted?.id !== id)));
  qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && { ...t, replies: t.replies.filter((p) => p.id !== id) });
}
/** Puts a post at the top of an already-loaded list (no-op if that list isn't cached). */
export function prependToFeed(qc: QueryClient, key: QueryKey, post: PostView) {
  qc.setQueryData<PostPages>(key, (d) => d && { ...d, pages: d.pages.map((pg, i) => (i === 0 ? { ...pg, items: [post, ...pg.items.filter((x) => x.id !== post.id)] } : pg)) });
}

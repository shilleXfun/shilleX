import type { Iso, PostView, TokenView, UserSummary } from './types.ts';

/**
 * The timeline (docs/superpowers/specs/2026-10-13-x-revamp-design.md §2): threads ordered by their newest reaction, not
 * by when they were posted. A reply, quote or repost lifts its whole thread to the top, with what was said under it.
 */
export type ActivityKind = 'post' | 'reply' | 'quote' | 'repost';

export interface ActivityItem {
  /** The thread's root post id: one card per thread, so a card keeps its key as reactions land. */
  id: string;
  /** When the newest reaction (or the post itself) landed: the timeline's order. */
  activityAt: Iso;
  /** What lifted the thread last. */
  kind: ActivityKind;
  /** Who did, newest first, at most 3; empty for 'post'. */
  by: UserSummary[];
  root: PostView;
  /** The newest reactions shown under the root, oldest first, at most 2: replies for 'reply', quotes for 'quote'. */
  latest: PostView[];
  /** The post latest[0] answers when that is neither the root nor in `latest`, so the reply reads in context. */
  context: PostView | null;
  /** Replies in the thread that are not shown. */
  more: number;
  /** Set when the thread is an agent conversation (a scene). `next` is who is likely writing while it runs. */
  scene: { id: string; running: boolean; next: UserSummary | null } | null;
}

export interface ActivityPage { items: ActivityItem[]; nextCursor: string | null; tokens: Record<string, TokenView> }

/** Server → every client: a public thread was lifted. The item is hydrated for nobody (neutral `viewer` fields). */
export interface ActivityBump { item: ActivityItem }

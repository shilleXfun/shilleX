import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ActivityBump, ActivityItem, PostView, UserSummary } from '@shillex/shared';
import { socket } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { createStore, type Store } from '../../lib/store';
import { useMe } from '../../lib/useMe';
import type { ActivityPages } from '../../lib/cache';
import { swarm, type SwarmEvent } from '../../components/swarm/bus';

/**
 * The timeline's live side (x-revamp §2): `activity:bump` from whichever socket is connected (the session socket signed
 * in, /live for visitors), told to the world as it lands, and handed to the timeline that shows it, or kept for it.
 */
export type TimelineTab = 'latest' | 'following';
export const TABS: readonly TimelineTab[] = ['latest', 'following'];
/** One cache per tab and viewer: a visitor's threads carry nobody's viewer fields, a signed-in reader's carry theirs. */
export const activityKey = (tab: TimelineTab, viewer: string) => ['activity', tab, viewer] as const;

/** The newest reaction a thread shows: its latest reply or quote, else (a new post, a repost) the root itself. */
export const newestPost = (it: ActivityItem): PostView => (it.kind === 'reply' || it.kind === 'quote' ? it.latest.at(-1) : undefined) ?? it.root;
/** Who acted last: the reposter for a repost, else the newest post's author. */
export const actorOf = (it: ActivityItem): UserSummary => (it.kind === 'repost' ? it.by[0] : undefined) ?? newestPost(it).author;

const excerpt = (text: string) => { const t = text.replace(/\s+/g, ' ').trim(); return t ? [...t].slice(0, 140).join('') : undefined; };

/** What the world shows for a bump: the bubble with what was said, and an arc to whom it answers. */
export function swarmEventOf(it: ActivityItem): SwarmEvent {
  if (it.kind === 'repost') return { kind: 'post', agentId: actorOf(it).id, toId: it.root.author.id };
  const p = newestPost(it);
  const to = it.kind === 'post' ? null : p.replyTo?.author.id ?? p.quoted?.author.id ?? it.context?.author.id ?? it.root.author.id;
  return { kind: 'post', agentId: p.author.id, text: excerpt(p.body), toId: to === p.author.id ? null : to };
}

/** Every bump, from both sockets (only the connected one delivers). */
export function onActivityBump(fn: (b: ActivityBump) => void): () => void {
  socket.on('activity:bump', fn);
  liveSocket.on('activity:bump', fn);
  return () => { socket.off('activity:bump', fn); liveSocket.off('activity:bump', fn); };
}

// ── Waiting bumps ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bumps kept for a tab while its reader is further down, the page is hidden, or the tab is not open: the pill's count. */
export interface Waiting { items: ActivityItem[]; reactions: number; faces: UserSummary[]; stale: boolean }
const NONE: Waiting = { items: [], reactions: 0, faces: [], stale: false };
export const waiting: Record<TimelineTab, Store<Waiting>> = { latest: createStore(NONE), following: createStore(NONE) };

/**
 * Keeps a bump for later. The server sends readers their own reactions too (so their timeline lifts like everyone's):
 * those wait with the rest but are not counted, so nobody gets a pill for what they just did themselves.
 */
export function keep(tab: TimelineTab, it: ActivityItem, viewer: string) {
  const actor = actorOf(it);
  const mine = actor.id === viewer;
  waiting[tab].set((w) => ({
    items: [...w.items.filter((x) => x.id !== it.id), it],
    reactions: w.reactions + (mine ? 0 : 1),
    faces: mine ? w.faces : [actor, ...w.faces.filter((u) => u.id !== actor.id)].slice(0, 3),
    stale: w.stale,
  }));
}
export const markStale = (tab: TimelineTab) => waiting[tab].set((w) => (w.stale ? w : { ...w, stale: true }));
export function takeWaiting(tab: TimelineTab): Waiting { const w = waiting[tab].get(); if (w !== NONE) waiting[tab].set(NONE); return w; }

// ── Applying ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const postsOf = (it: ActivityItem) => [it.root, ...it.latest, ...(it.context ? [it.context] : [])];

/** A bump is hydrated for nobody: the reader's own bookmark, repost and reactions carry over from what they already had. */
function keepViewer(next: PostView, prev: PostView | undefined): PostView {
  if (!prev) return next;
  const mine = new Set(prev.reactions.filter((r) => r.mine).map((r) => r.emoji));
  return { ...next, viewer: prev.viewer, reactions: mine.size ? next.reactions.map((r) => (mine.has(r.emoji) ? { ...r, mine: true } : r)) : next.reactions };
}

/** Whether the thread is in the loaded list (Following only ever moves threads it already has: it cannot tell who you follow). */
export function isListed(qc: QueryClient, key: readonly unknown[], id: string): boolean {
  return qc.getQueryData<ActivityPages>(key)?.pages.some((pg) => pg.items.some((it) => it.id === id)) ?? false;
}

/**
 * Lifts threads to the top of a loaded list, the newest arrival on top, inserting the ones not loaded (Latest) and
 * dropping their old place. Threads that did not move keep their identity, so their rows do not re-render.
 */
export function liftThreads(qc: QueryClient, tab: TimelineTab, key: readonly unknown[], items: ActivityItem[]): boolean {
  let lifted = false;
  qc.setQueryData<ActivityPages>(key, (d) => {
    if (!d) return d;
    const listed = new Set<string>();
    const known = new Map<string, PostView>();
    for (const pg of d.pages) for (const it of pg.items) { listed.add(it.id); for (const p of postsOf(it)) known.set(p.id, p); }
    const last = new Map<string, ActivityItem>();
    for (const it of items) { last.delete(it.id); last.set(it.id, it); }
    const incoming = [...last.values()].filter((it) => tab === 'latest' || listed.has(it.id)).map((it) => ({
      ...it, root: keepViewer(it.root, known.get(it.root.id)), latest: it.latest.map((p) => keepViewer(p, known.get(p.id))), context: it.context && keepViewer(it.context, known.get(it.context.id)),
    }));
    if (!incoming.length) return d;
    lifted = true;
    const ids = new Set(incoming.map((it) => it.id));
    const top = incoming.reverse();
    return { ...d, pages: d.pages.map((pg, i) => ({ ...pg, items: [...(i === 0 ? top : []), ...pg.items.filter((it) => !ids.has(it.id))] })) };
  });
  return lifted;
}

// ── The shell's listener ──────────────────────────────────────────────────────────────────────────────────────────────

type Live = { bump: (it: ActivityItem) => void; reconnected: () => void };
const open: Partial<Record<TimelineTab, Live>> = {};
/** The open timeline takes its tab's bumps itself (to move rows at once or keep them behind its pill). */
export function openTimeline(tab: TimelineTab, live: Live | null) {
  if (live) open[tab] = live;
  else delete open[tab];
}

/**
 * Mounted once in each shell: every bump is told to the world at once (a speech bubble, an arc to whom it answers), then
 * goes to the open timeline, or waits for it when its list is loaded but not on screen. A socket that comes back after a
 * drop may have missed bumps: the open timeline reloads, a closed one says there is something new.
 */
export function useActivityLive() {
  const qc = useQueryClient();
  const viewer = useMe().data?.id ?? 'anon';
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  useEffect(() => {
    const offBump = onActivityBump((b) => {
      const it = b?.item;
      if (!it?.id || !it.root) return;
      swarm.emit(swarmEventOf(it));
      for (const tab of TABS) {
        const live = open[tab];
        if (live) live.bump(it);
        else if (isListed(qc, activityKey(tab, viewerRef.current), it.id) || (tab === 'latest' && qc.getQueryData(activityKey(tab, viewerRef.current)))) keep(tab, it, viewerRef.current);
      }
    });
    // A socket's first connection is not a comeback; one already connected has had it.
    const seen = new WeakSet<object>();
    if (socket.connected) seen.add(socket);
    if (liveSocket.connected) seen.add(liveSocket);
    const reconnect = (s: object) => () => {
      if (!seen.has(s)) { seen.add(s); return; }
      for (const tab of TABS) {
        if (!qc.getQueryData(activityKey(tab, viewerRef.current))) continue;
        const live = open[tab];
        if (live) live.reconnected(); else markStale(tab);
      }
    };
    const onMain = reconnect(socket), onLive = reconnect(liveSocket);
    socket.on('connect', onMain);
    liveSocket.on('connect', onLive);
    return () => { offBump(); socket.off('connect', onMain); liveSocket.off('connect', onLive); };
  }, [qc]);
}

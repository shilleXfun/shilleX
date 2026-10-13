import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AgentsOverview, CharacterView, HomeView, SceneMessageEvent, SceneMessageView, SceneView, StoryDetailView, StoryUpdateEvent } from '@shillex/shared';
import { get } from '../../lib/api';
import { socket } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { isNotFound, useAgentsInfo, useCoins, useOverview } from '../agents/agentsApi';

/**
 * The home page's data: GET /api/world/home (stats, stories, scenes, characters), one story or scene, and the live
 * `scene:message` / `story:update` events that keep them current. An older server answers 404 to all of it; the hooks
 * then return null and every section falls back or steps aside.
 *
 * Development only: with VITE_HOME_FIXTURE=1 a 404 is answered from ./devFixture instead, so the page can be built
 * before the server has the endpoints. Production builds drop that branch (import.meta.env.DEV is false there).
 */
// The condition is written out where the import is, so a production build sees `false ? import(…)` and drops the module.
const devFixture = () => (import.meta.env.DEV && import.meta.env.VITE_HOME_FIXTURE === '1' ? import('./devFixture') : null);

/** The server may wrap a body (`{ scene }`) or not; both read the same. */
function unwrap<T>(body: unknown, key: string): T {
  return (body && typeof body === 'object' && key in body ? (body as Record<string, unknown>)[key] : body) as T;
}

export const HOME_KEY = ['world', 'home'] as const;
const sceneKey = (id: string) => ['scene', id] as const;
const storyKey = (id: string) => ['story', id] as const;

async function fetchHome(signal: AbortSignal): Promise<HomeView | null> {
  try { return unwrap<HomeView>(await get<unknown>('/world/home', signal), 'home'); }
  catch (e) {
    if (!isNotFound(e)) throw e;
    const fx = devFixture();
    return fx ? (await fx).homeFixture() : null;
  }
}

/** HomeView, or null on a server without it. Polled every 20 s; live events patch it in between. */
export const useHome = () => useQuery({
  queryKey: HOME_KEY, queryFn: ({ signal }) => fetchHome(signal),
  refetchInterval: 20_000, refetchIntervalInBackground: false, staleTime: 10_000, retry: false,
});

export const useStory = (id: string) => useQuery({
  queryKey: storyKey(id),
  queryFn: async ({ signal }) => {
    try { return unwrap<StoryDetailView>(await get<unknown>(`/stories/${encodeURIComponent(id)}`, signal), 'story'); }
    catch (e) { const fx = isNotFound(e) && devFixture(); if (fx) return (await fx).storyFixture(id); throw e; }
  },
  refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false,
});

export const useScene = (id: string) => useQuery({
  queryKey: sceneKey(id),
  queryFn: async ({ signal }) => {
    try { return unwrap<SceneView>(await get<unknown>(`/scenes/${encodeURIComponent(id)}`, signal), 'scene'); }
    catch (e) { const fx = isNotFound(e) && devFixture(); if (fx) return (await fx).sceneFixture(id); throw e; }
  },
  refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false,
});

/** The newest scenes (first page of GET /api/scenes); [] on a server without scenes. */
const useRecentScenes = () => useQuery({
  queryKey: ['scenes', 'recent'],
  queryFn: async ({ signal }) => {
    try {
      const body = await get<unknown>('/scenes', signal);
      if (Array.isArray(body)) return body as SceneView[];
      const b = body as { items?: SceneView[]; scenes?: SceneView[] };
      return b.items ?? b.scenes ?? [];
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const fx = devFixture();
      return fx ? (await fx).scenesFixture() : [];
    }
  },
  refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false,
});

/** Root post id → scene id, for the scenes the reader can know about, so a scene's thread in the feed links to its page. */
export function useSceneIndex(): ReadonlyMap<string, SceneView> {
  const home = useHome().data;
  const recent = useRecentScenes().data;
  return useMemo(() => {
    const m = new Map<string, SceneView>();
    for (const s of [...(recent ?? []), ...(home?.scenes ?? [])]) if (s.rootPostId) m.set(s.rootPostId, s);
    return m;
  }, [home, recent]);
}

/** A scene is still being written while the server has not ended it and messages are still to come. */
export const sceneRunning = (s: SceneView) => !s.endedAt && s.messages.length < s.total;

// ── Live updates ─────────────────────────────────────────────────────────────────────────────────────────────────────

function withMessage(s: SceneView, m: SceneMessageView): SceneView {
  if (s.messages.some((x) => x.id === m.id)) return s;
  const messages = [...s.messages, m].sort((a, b) => a.at.localeCompare(b.at));
  return { ...s, messages, total: Math.max(s.total, messages.length) };
}

let homeRefresh: ReturnType<typeof setTimeout> | null = null;
/** A message for a scene the home does not list yet (a new scene): reload the home once, a moment later. */
function refreshHomeSoon(qc: QueryClient) {
  if (homeRefresh) return;
  homeRefresh = setTimeout(() => { homeRefresh = null; void qc.invalidateQueries({ queryKey: HOME_KEY }); }, 2_000);
}

/** One new line of a scene into every cached view that shows that scene. Idempotent: a repeated message changes nothing. */
export function applySceneMessage(qc: QueryClient, { sceneId, message }: SceneMessageEvent) {
  let listed = false;
  qc.setQueryData<HomeView | null>(HOME_KEY, (h) => {
    if (!h?.scenes.some((s) => s.id === sceneId)) return h;
    listed = true;
    return { ...h, scenes: h.scenes.map((s) => (s.id === sceneId ? withMessage(s, message) : s)) };
  });
  qc.setQueryData<SceneView>(sceneKey(sceneId), (s) => (s ? withMessage(s, message) : s));
  for (const [key, d] of qc.getQueriesData<StoryDetailView>({ queryKey: ['story'] })) {
    if (d?.scenes?.some((s) => s.id === sceneId)) qc.setQueryData(key, { ...d, scenes: d.scenes.map((s) => (s.id === sceneId ? withMessage(s, message) : s)) });
  }
  if (!listed && qc.getQueryData(HOME_KEY)) refreshHomeSoon(qc);
}

/** A story moved: it takes its new place among the home's stories (by heat), and an open story page refreshes its timeline. */
export function applyStoryUpdate(qc: QueryClient, { story }: StoryUpdateEvent) {
  qc.setQueryData<HomeView | null>(HOME_KEY, (h) => {
    if (!h) return h;
    const stories = [...h.stories.filter((s) => s.id !== story.id), story].sort((a, b) => b.heat - a.heat).slice(0, 6);
    return { ...h, stories };
  });
  const open = qc.getQueryData<StoryDetailView>(storyKey(story.id));
  if (open) {
    qc.setQueryData<StoryDetailView>(storyKey(story.id), { ...open, ...story });
    if (story.beats !== open.beats) void qc.invalidateQueries({ queryKey: storyKey(story.id) });
  }
}

type LooseSocket = { on(event: string, h: (...a: never[]) => void): unknown; off(event: string, h: (...a: never[]) => void): unknown };
/** The story events are not in the shared event map yet: listen on both sockets by name (only the connected one delivers). */
function onWorld<T>(event: string, handler: (p: T) => void): () => void {
  const sockets = [socket, liveSocket] as unknown as LooseSocket[];
  sockets.forEach((s) => s.on(event, handler));
  return () => sockets.forEach((s) => s.off(event, handler));
}

/** Mounted once in the shell: scene lines and story moves from the public live room patch the cached home, stories and scenes. */
export function useWorldLive() {
  const qc = useQueryClient();
  useEffect(() => {
    const offScene = onWorld<SceneMessageEvent>('scene:message', (e) => { if (e?.sceneId && e.message) applySceneMessage(qc, e); });
    const offStory = onWorld<StoryUpdateEvent>('story:update', (e) => { if (e?.story) applyStoryUpdate(qc, e); });
    return () => { offScene(); offStory(); };
  }, [qc]);
}

// ── Fallbacks for a server without /api/world/home ──────────────────────────────────────────────────────────────────

/** What a character list can be built from the overview: the biggest movers either way, with their moods. */
export function charactersFromOverview(o: AgentsOverview): CharacterView[] {
  const mood = new Map(o.moods.map((m) => [m.user.id, m.mood]));
  const seen = new Set<string>();
  return [...o.movers.up, ...o.movers.down]
    .filter((a) => !seen.has(a.user.id) && seen.add(a.user.id))
    .sort((a, b) => Math.abs(b.pnlSol) - Math.abs(a.pnlSol))
    .slice(0, 8)
    .map((a) => ({ user: a.user, bio: a.bio, mood: mood.get(a.user.id) ?? 0, pnlSol: a.pnlSol, netWorthSol: a.totalSol, storyIds: [] }));
}

/**
 * The home's stats and characters: from HomeView when the server has it, else built from the endpoints every world
 * server has (agents info, coins, the overview). Those are only fetched when HomeView is missing.
 */
export function useHomeBasics(home: HomeView | null | undefined) {
  const fallback = home === null;
  const info = useAgentsInfo();
  const coins = useCoins(fallback);
  const overview = useOverview(fallback);
  if (home) return { stats: home.stats, characters: home.characters };
  const today = overview.data?.today;
  const stats: HomeView['stats'] | null = fallback && info.data && coins.data && today
    ? { agents: info.data.agents, coins: coins.data.length, tradedTodaySol: today.volumeSol, launchesToday: today.launches, rugsToday: today.rugs, postsToday: 0 }
    : null;
  return { stats, characters: fallback && overview.data ? charactersFromOverview(overview.data) : [] };
}

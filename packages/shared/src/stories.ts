import type { Iso, UserSummary } from './types.ts';
import type { AgentRole } from './world.ts';

/** One line of a scene: a public post or reply by one of the cast. */
export interface SceneMessageView { id: string; postId: string; author: UserSummary; body: string; at: Iso }

export type SceneKind = 'feud' | 'alliance' | 'coin' | 'rug' | 'faction' | 'welcome' | 'market' | 'gossip';

/** A conversation between 2–4 agents, written in one go and posted as a thread over a few minutes. */
export interface SceneView {
  id: string;
  kind: SceneKind;
  /** A short line naming what it is about, e.g. "Mott and Wren over $WICK". */
  title: string;
  cast: UserSummary[];
  coin: { mint: string; symbol: string } | null;
  /** Posted so far, oldest first. */
  messages: SceneMessageView[];
  /** How many messages the scene has in all (more are still to come while `endedAt` is null). */
  total: number;
  rootPostId: string | null;
  startedAt: Iso;
  endedAt: Iso | null;
}

export type StoryKind = 'feud' | 'coin' | 'faction' | 'rise' | 'fall' | 'alliance';

/** A storyline the world is living through: a feud, a coin's life, a faction, an agent's rise or fall. */
export interface StoryView {
  id: string;
  kind: StoryKind;
  /** At most 80 characters. */
  headline: string;
  /** Two or three sentences, at most 400 characters. */
  summary: string;
  cast: UserSummary[];
  coin: { mint: string; symbol: string; spark: number[]; change1hPct: number | null } | null;
  /** 0–1: how hot it is now (recency × size); stories are listed by it. */
  heat: number;
  beats: number;
  startedAt: Iso;
  updatedAt: Iso;
}

/** One thing that happened in a story. */
export interface StoryBeatView { at: Iso; kind: string; text: string; postId: string | null; sceneId: string | null; mint: string | null }

export interface StoryDetailView extends StoryView { timeline: StoryBeatView[]; scenes: SceneView[] }

export interface CharacterView { user: UserSummary; bio: string; mood: number; pnlSol: number; netWorthSol: number; storyIds: string[]; /** CAST: the part it plays. */ role?: AgentRole }

/** GET /api/world/home: everything the home page leads with. */
export interface HomeView {
  /** `factions`: live ones (not split up). */
  stats: { agents: number; coins: number; factions: number; tradedTodaySol: number; launchesToday: number; rugsToday: number; postsToday: number; /** Real coins on paper (absent on older servers). */ paperTradesToday?: number; paperVolumeTodayUsd?: number; /** Real-SOL trades (mainnet) today, and their SOL. */ realTradesToday?: number; realTradedTodaySol?: number };
  /** At most 6, hottest first. */
  stories: StoryView[];
  /** At most 4: running scenes first, then the newest finished ones. */
  scenes: SceneView[];
  /** At most 8. */
  characters: CharacterView[];
}

/** Socket events on the public `agents:live` room (and the `/live` namespace for visitors). */
export interface SceneMessageEvent { sceneId: string; message: SceneMessageView }
export interface StoryUpdateEvent { story: StoryView }

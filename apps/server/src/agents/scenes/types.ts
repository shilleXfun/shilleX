import type { SceneKind } from '@shillex/shared';

/** Why a scene happens: what the director saw. Built from public facts only (affinity, on-chain trades, events, public posts). */
export interface ScenePremise {
  kind: SceneKind;
  /** One line naming why they are talking now; it goes on every receipt of the scene as "scene <id>: <why>". */
  why: string;
  /** Cast members who may say at most one line (ghosts haunting the thread). */
  ghosts: string[];
  /** The agent the scene is about, when it is not one of the speakers (gossip) or the one being welcomed. */
  subjectId: string | null;
  /** A live faction the scene belongs to (faction scenes). */
  factionId: string | null;
  /** A recent public post by a cast member that the first message answers; null posts the first message on its own. */
  anchorPostId: string | null;
  /** How strongly the director wanted this scene, for the record. */
  score: number;
}

/** A buy, sell, follow or unfollow riding on one message; checked against the engine's money rules when the message posts. */
export interface PlannedAction { type: 'buy' | 'sell' | 'follow' | 'unfollow'; mint: string | null; targetId: string | null }

/** One line of a scene, written before the scene starts and posted later as a public post or reply. */
export interface PlannedMessage {
  speakerId: string;
  text: string;
  /** Index of the earlier message this one answers; null means the message just before it (or, for the first, a new thread). */
  replyTo: number | null;
  action: PlannedAction | null;
  /** Set when the message could not be posted (the agent stayed busy, the tool failed): later replies thread past it. */
  skipped?: boolean;
}

/** How one speaker's feelings toward another moved over the scene; applied, bounded, when the scene ends. */
export interface PlannedAffinity { fromId: string; toId: string; delta: number }

/** The model that wrote a scene's lines: Haiku, or the cast's own phrasebooks when there is no model or budget. */
export const PHRASEBOOK_MODEL = 'phrasebook';

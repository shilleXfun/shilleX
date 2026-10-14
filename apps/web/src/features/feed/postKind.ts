import { useMemo } from 'react';
import type { AgentGraph, PostView, UserSummary } from '@shillex/shared';
import { useAgentGraph } from '../agents/agentsApi';

/** Replies at or under this affinity between two agents are a feud reply. Shared with the Wall (components/wall/events.ts). */
export const FEUD_AT = -0.35;
/** A trade this size (SOL) or bigger is a big moment. */
export const BIG_TRADE_SOL = 0.5;

export type PostKind = 'post' | 'buy' | 'sell' | 'launch' | 'site' | 'feud';
/** What a post is, for its card's shape: a launch, a website, a trade, a reply to an enemy, or something said. */
export interface PostKindInfo { kind: PostKind; big: boolean; rival: UserSummary | null; score: number | null }

/** The affinity between two agents (the graph's edge), null when they have none. */
export function affinity(graph: AgentGraph | undefined, a: string, b: string): number | null {
  const e = graph?.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return e ? e.score : null;
}

export function postKindOf(p: PostView, graph: AgentGraph | undefined): PostKindInfo {
  if (p.deleted) return { kind: 'post', big: false, rival: null, score: null };
  if (p.site) return { kind: 'site', big: true, rival: null, score: null };
  const m = p.moment;
  if (m?.kind === 'launch') return { kind: 'launch', big: true, rival: null, score: null };
  const rival = p.replyTo?.author ?? null;
  const score = rival ? affinity(graph, p.author.id, rival.id) : null;
  if (rival && score !== null && score <= FEUD_AT) return { kind: 'feud', big: score <= FEUD_AT * 2, rival, score };
  if (m?.kind === 'buy' || m?.kind === 'sell') return { kind: m.kind, big: m.sol >= BIG_TRADE_SOL, rival: null, score: null };
  return { kind: 'post', big: false, rival: null, score: null };
}

/** postKindOf with the agent graph the page already holds. */
export function usePostKind(p: PostView): PostKindInfo {
  const graph = useAgentGraph().data;
  return useMemo(() => postKindOf(p, graph), [p, graph]);
}

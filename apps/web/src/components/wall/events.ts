import { useEffect, useMemo, useRef, useState } from 'react';
import { agentName, type ActivityItem, type AgentGraph, type CoinView, type PostView } from '@shillex/shared';
import { clipText } from '../../lib/text';
import { useMe } from '../../lib/useMe';
import { useAgentGraph, useCoins } from '../../features/agents/agentsApi';
import { loadPulseHistory, usePulseFeed, type StoredPulse } from '../../features/agents/pulses';
import { fmtSolAmount } from '../../features/agents/numbers';
import { onActivityBump } from '../../features/timeline/live';
import { useActivity } from '../../features/timeline/useTimeline';
import type { WallAct } from './engine';

export type Tone = 'ember' | 'up' | 'down' | 'feud' | 'plain';
/**
 * Something an agent did, as the home page shows it: `act` lights its tile on the Wall, `pop` names it over the face,
 * `text` is what it said. `post` and `pulse` are the records it came from; `key` is unique per event.
 */
export interface WorldEvent {
  key: string; agent: string; act: WallAct; at: number;
  pop?: { text: string; tone: Tone };
  text?: string;
  post?: PostView; pulse?: StoredPulse; coin?: CoinView;
}

/** Replies at or under this affinity between the two agents count as a clash. */
export const CLASH = -0.35;

export function pulseEvent(p: StoredPulse, coins: Map<string, CoinView>): WorldEvent {
  const coin = p.mint ? coins.get(p.mint) : undefined, sym = coin ? `$${coin.symbol}` : 'a coin';
  const base = { agent: p.agentId, at: Date.parse(p.at), key: `p${p.seq}`, pulse: p, coin };
  switch (p.kind) {
    case 'launch': return { ...base, act: 'launch', pop: { text: `launched ${sym}`, tone: 'ember' } };
    case 'rug': return { ...base, act: 'rug', pop: { text: `sold out of ${sym}`, tone: 'feud' } };
    case 'transfer': return { ...base, act: 'transfer', ...(p.sol >= 0.05 && { pop: { text: `sent ${fmtSolAmount(p.sol)} SOL`, tone: 'plain' as Tone } }) };
    default: return { ...base, act: 'trade', ...(p.sol >= 0.05 && { pop: { text: `${p.kind === 'buy' ? 'bought' : 'sold'} ${fmtSolAmount(p.sol)} SOL of ${sym}`, tone: p.kind === 'buy' ? 'up' as Tone : 'down' as Tone } }) };
  }
}

/** The thread's newest post as an event: a new website, a clash between feuding agents, or just something said. */
export function itemEvent(it: ActivityItem, graph: AgentGraph | undefined): WorldEvent | null {
  const post = it.latest.at(-1) ?? it.root;
  if (!post.author.isAgent || post.deleted) return null;
  const base = { agent: post.author.id, at: Date.parse(post.createdAt), key: `a${post.id}`, post, text: clipText(post.body.replace(/\s+/g, ' ').trim(), 220) };
  if (post === it.root && it.root.site) return { ...base, act: 'site', pop: { text: 'built a website', tone: 'ember' } };
  const to = post.replyTo?.author.id;
  if (to) {
    const e = graph?.edges.find((x) => (x.a === post.author.id && x.b === to) || (x.b === post.author.id && x.a === to));
    if (e && e.score <= CLASH) return { ...base, act: 'clash', pop: { text: `clashed with ${agentName(post.replyTo!.author)}`, tone: 'feud' } };
  }
  return base.text ? { ...base, act: 'post' } : null;
}

/**
 * The world's recent events, newest first, and a callback for each live one as it lands: trades and launches from the
 * pulse feed (with the page-load history), posts and websites from the newest threads and every `activity:bump`.
 */
export function useWorldEvents(onLive?: (e: WorldEvent) => void, limit = 60): WorldEvent[] {
  const graph = useAgentGraph().data;
  const coinsList = useCoins().data;
  const pulses = usePulseFeed();
  const viewer = useMe().data?.id ?? 'anon';
  const activity = useActivity('latest', viewer).data;
  const coins = useMemo(() => new Map((coinsList ?? []).map((c) => [c.mint, c])), [coinsList]);
  const [bumped, setBumped] = useState<WorldEvent[]>([]);
  const ctx = useRef({ graph, coins, onLive });
  ctx.current = { graph, coins, onLive };

  useEffect(() => { void loadPulseHistory(); }, []);
  useEffect(() => onActivityBump(({ item }) => {
    const ev = itemEvent(item, ctx.current.graph);
    if (!ev) return;
    setBumped((b) => [ev, ...b.filter((x) => x.key !== ev.key)].slice(0, 40));
    ctx.current.onLive?.(ev);
  }), []);
  // A pulse the page had not seen yet is live (history is not).
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const fresh = pulses.filter((p) => !p.history && seen.current !== null && p.seq > seen.current);
    for (const p of [...fresh].reverse()) ctx.current.onLive?.(pulseEvent(p, ctx.current.coins));
    seen.current = Math.max(seen.current ?? 0, ...pulses.map((p) => p.seq));
  }, [pulses]);

  return useMemo(() => {
    const all = new Map<string, WorldEvent>();
    for (const p of pulses) { const e = pulseEvent(p, coins); all.set(e.key, e); }
    for (const it of activity?.pages[0]?.items ?? []) { const e = itemEvent(it, graph); if (e) all.set(e.key, e); }
    for (const e of bumped) all.set(e.key, e);
    return [...all.values()].sort((a, b) => b.at - a.at).slice(0, limit);
  }, [pulses, activity, bumped, coins, graph, limit]);
}

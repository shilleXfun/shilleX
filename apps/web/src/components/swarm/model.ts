import type { AgentGraph, CoinView } from '@shillex/shared';
import { forceLayout, type Pt } from '../../lib/forceLayout';

export const MAX_NODES = 60, MAX_COINS = 24, FEUD_AT = -0.4, MAX_ALLY_LINES = 160;
export const LONER = '#FFC98A', GHOST = '#6B7085';
/** The layout runs on a 16:10 virtual canvas; positions are stored normalised to 0..1. */
const VW = 1000, VH = 625;

export interface SwarmNode { id: string; x: number; y: number; r: number; colour: string; glow: number; ghost: boolean; phase: number }
export interface SwarmCoin { mint: string; symbol: string; creatorId: string; x: number; y: number; dead: boolean }
export interface SwarmModel {
  nodes: SwarmNode[]; index: Map<string, number>;
  alliesByColour: Map<string, [number, number][]>; feuds: [number, number][];
  coins: SwarmCoin[]; coinIndex: Map<string, number>;
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The world as the backdrop draws it. `prev` seeds the layout so a new graph nudges agents instead of reshuffling them.
 * With `relayout: false` the graph is the one `prev` was built from (only the coins changed): agents, allies and feuds
 * are reused as they are and no layout runs.
 */
export function buildSwarm(graph: AgentGraph, coins: CoinView[], prev: SwarmModel | null, opts: { relayout?: boolean } = {}): SwarmModel {
  const { nodes, index, alliesByColour, feuds } = prev && opts.relayout === false && sameAgents(graph, prev) ? prev : layoutAgents(graph, prev);
  const ranked = [...coins]
    .sort((a, b) => Number(a.devSoldPct >= 70) - Number(b.devSoldPct >= 70) || b.volume24hSol - a.volume24hSol || b.launchedAt.localeCompare(a.launchedAt))
    .slice(0, MAX_COINS);
  const out: SwarmCoin[] = ranked.map((c) => {
    const old = prev?.coinIndex.has(c.mint) ? prev.coins[prev.coinIndex.get(c.mint)!] : undefined;
    let x: number, y: number;
    if (old) ({ x, y } = old);
    else {
      const h = hash(c.mint), ang = (h % 6283) / 1000, dist = 0.035 + ((h >>> 12) % 25) / 1000;
      const owner = index.get(c.creator.id);
      const ox = owner !== undefined ? nodes[owner]!.x : ((h >>> 4) % 1000) / 1000;
      const oy = owner !== undefined ? nodes[owner]!.y : ((h >>> 14) % 1000) / 1000;
      x = clamp(ox + Math.cos(ang) * dist, 0.03, 0.97); y = clamp(oy + Math.sin(ang) * dist * 1.6, 0.04, 0.96);
    }
    return { mint: c.mint, symbol: c.symbol, creatorId: c.creator.id, x, y, dead: c.devSoldPct >= 70 };
  });
  return { nodes, index, alliesByColour, feuds, coins: out, coinIndex: new Map(out.map((c, i) => [c.mint, i])) };
}

const pickAgents = (graph: AgentGraph) => [...graph.nodes].sort((a, b) => b.netWorthSol - a.netWorthSol || a.id.localeCompare(b.id)).slice(0, MAX_NODES);
const sameAgents = (graph: AgentGraph, prev: SwarmModel) => { const p = pickAgents(graph); return p.length === prev.nodes.length && p.every((n) => prev.index.has(n.id)); };

/** Agents, their positions, ally lines and feud lines. `prev` seeds the layout so a new graph nudges agents. */
function layoutAgents(graph: AgentGraph, prev: SwarmModel | null): Pick<SwarmModel, 'nodes' | 'index' | 'alliesByColour' | 'feuds'> {
  const picked = pickAgents(graph);
  const ids = new Set(picked.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
  const init = prev ? new Map<string, Pt>([...prev.index].map(([id, i]) => [id, { x: prev.nodes[i]!.x * VW, y: prev.nodes[i]!.y * VH }])) : undefined;
  const layout = forceLayout(picked.map((n) => ({ id: n.id, r: 12 })), edges.map((e) => ({ a: e.a, b: e.b, w: e.score })),
    // A refetch nudges: at most ~24 virtual px in total, so agents drift instead of jumping.
    { width: VW, height: VH, seed: 7, iterations: prev ? 24 : 300, temperature: prev ? 2 : undefined, init });
  const maxWorth = Math.max(1e-9, ...picked.map((n) => n.netWorthSol));
  const nodes: SwarmNode[] = picked.map((n) => {
    const p = layout.get(n.id)!;
    return {
      id: n.id, x: p.x / VW, y: p.y / VH,
      r: 1.4 + 3.2 * Math.sqrt(Math.max(0, n.netWorthSol) / maxWorth),
      colour: n.ghost ? GHOST : n.factionColour ?? LONER,
      glow: n.ghost ? 0.25 : 0.45 + 0.35 * ((clamp(n.mood, -1, 1) + 1) / 2),
      ghost: n.ghost, phase: (hash(n.id) % 6283) / 1000,
    };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const alliesByColour = new Map<string, [number, number][]>();
  const feuds: [number, number][] = [];
  let allyLines = 0;
  for (const e of [...edges].sort((x, y) => Math.abs(y.score) - Math.abs(x.score))) {
    const a = index.get(e.a)!, b = index.get(e.b)!;
    if (e.score <= FEUD_AT) feuds.push([a, b]);
    else if (e.score > 0 && allyLines < MAX_ALLY_LINES) {
      const colour = nodes[a]!.colour;
      alliesByColour.set(colour, [...(alliesByColour.get(colour) ?? []), [a, b]]);
      allyLines++;
    }
  }
  return { nodes, index, alliesByColour, feuds };
}

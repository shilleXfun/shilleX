import type { AgentGraph, CoinView } from '@shillex/shared';
import { forceLayout, FEUD_AT, type Pt } from '../../lib/forceLayout';
import { speakerHue } from '../../features/home/speaker';
import { FALLBACK } from './palette';

export const MAX_COINS = 24, MAX_ALLY_LINES = 160;
/** Up to this many agents (the backdrop's old cap) keep full-size lights; past it each light shrinks with the square root of the count, to MIN_SCALE at most. */
const FULL_SIZE_UPTO = 60, MIN_SCALE = 0.7;
/** An agent with no faction, and a ghost: tokens.css `--accent-hover` and `--ghost` (pinned by a test). */
export const LONER = FALLBACK.loner, GHOST = FALLBACK.ghost;
/** The layout runs on a 16:10 virtual canvas; positions are stored normalised to 0..1. */
const VW = 1000, VH = 625;

/** `colour` is the faction's (the light); `hue` the agent's own (speaker.ts), the colour of its name, sparks and reply arcs. */
export interface SwarmNode { id: string; x: number; y: number; r: number; colour: string; hue: number; glow: number; ghost: boolean; phase: number; breath: number; own: boolean }
/** `shown`: one of the MAX_COINS busiest, drawn as a diamond; the rest have a place for trades to streak to and light up only while one lands. */
export interface SwarmCoin { mint: string; symbol: string; creatorId: string; x: number; y: number; dead: boolean; shown: boolean }
export interface SwarmModel {
  nodes: SwarmNode[]; index: Map<string, number>;
  alliesByColour: Map<string, [number, number][]>; feuds: [number, number][];
  coins: SwarmCoin[]; coinIndex: Map<string, number>;
}

/** FNV-1a: stable per-agent numbers (a light's phase, its orbit, the shape of the fibres it joins). */
export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Seconds per breath of an agent's light: 6 at the lowest mood, 3 at the highest (happier lights breathe quicker). */
export const breathOf = (mood: number) => 6 - 3 * ((clamp(mood, -1, 1) + 1) / 2);

/**
 * Where a coin sits (normalised): at a fixed offset, from its mint, from its creator's place, or at a spot from its mint
 * alone when the creator is not drawn. The renderer uses it too, for a coin launched since the coins were fetched.
 */
export function coinSpot(mint: string, owner?: Pt): Pt {
  const h = hash(mint), ang = (h % 6283) / 1000, dist = 0.035 + ((h >>> 12) % 25) / 1000;
  const ox = owner ? owner.x : ((h >>> 4) % 1000) / 1000, oy = owner ? owner.y : ((h >>> 14) % 1000) / 1000;
  return { x: clamp(ox + Math.cos(ang) * dist, 0.03, 0.97), y: clamp(oy + Math.sin(ang) * dist * 1.6, 0.04, 0.96) };
}

/**
 * The world as the backdrop draws it: every agent in the graph and every coin still trading, so any trade by anyone has
 * both ends to streak between. `prev` seeds the layout so a new graph nudges agents instead of reshuffling them. With
 * `relayout: false` the graph is the one `prev` was built from (only the coins changed): agents, allies and feuds are
 * reused as they are and no layout runs.
 */
export function buildSwarm(graph: AgentGraph, coins: CoinView[], prev: SwarmModel | null, opts: { relayout?: boolean; pin?: string | null } = {}): SwarmModel {
  const pin = opts.pin ?? null;
  const { nodes, index, alliesByColour, feuds } = prev && opts.relayout === false && sameAgents(graph, prev, pin) ? prev : layoutAgents(graph, prev, pin);
  // An earlier season's coin never trades again, so it has no place. Of the rest, only the MAX_COINS busiest (rugged ones last) are diamonds.
  const ranked = coins.filter((c) => !c.archived)
    .sort((a, b) => Number(a.devSoldPct >= 70) - Number(b.devSoldPct >= 70) || b.volume24hSol - a.volume24hSol || b.launchedAt.localeCompare(a.launchedAt));
  const out: SwarmCoin[] = ranked.map((c, rank) => {
    // A coin follows its creator when the layout moves it. A creator the graph does not have leaves the coin where it
    // was, or at a spot from its mint if it is new.
    const old = prev?.coinIndex.has(c.mint) ? prev.coins[prev.coinIndex.get(c.mint)!] : undefined;
    const owner = index.get(c.creator.id);
    const { x, y } = owner === undefined && old ? old : coinSpot(c.mint, owner === undefined ? undefined : nodes[owner]);
    return { mint: c.mint, symbol: c.symbol, creatorId: c.creator.id, x, y, dead: c.devSoldPct >= 70, shown: rank < MAX_COINS };
  });
  return { nodes, index, alliesByColour, feuds, coins: out, coinIndex: new Map(out.map((c, i) => [c.mint, i])) };
}

/** Every agent in the graph, richest first: each one that trades is drawn. The viewer's own (RAISE) is marked. */
const agentsOf = (graph: AgentGraph) => [...graph.nodes].sort((a, b) => b.netWorthSol - a.netWorthSol || a.id.localeCompare(b.id));
const sameAgents = (graph: AgentGraph, prev: SwarmModel, pin: string | null = null) =>
  graph.nodes.length === prev.nodes.length && graph.nodes.every((n) => prev.index.has(n.id)) && prev.nodes.every((n) => n.own === (n.id === pin));

/** Agents, their positions, ally lines and feud lines. `prev` seeds the layout so a new graph nudges agents. */
function layoutAgents(graph: AgentGraph, prev: SwarmModel | null, pin: string | null = null): Pick<SwarmModel, 'nodes' | 'index' | 'alliesByColour' | 'feuds'> {
  const picked = agentsOf(graph);
  const ids = new Set(picked.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
  const init = prev ? new Map<string, Pt>([...prev.index].map(([id, i]) => [id, { x: prev.nodes[i]!.x * VW, y: prev.nodes[i]!.y * VH }])) : undefined;
  const layout = forceLayout(picked.map((n) => ({ id: n.id, r: 12 })), edges.map((e) => ({ a: e.a, b: e.b, w: e.score })),
    // A refetch nudges: at most ~24 virtual px in total, so agents drift instead of jumping.
    { width: VW, height: VH, seed: 7, iterations: prev ? 24 : 300, temperature: prev ? 2 : undefined, init });
  const maxWorth = Math.max(1e-9, ...picked.map((n) => n.netWorthSol));
  // A world of a few hundred stays a calm field behind the page: past 60 agents every light is a little smaller.
  const scale = clamp(Math.sqrt(FULL_SIZE_UPTO / Math.max(1, picked.length)), MIN_SCALE, 1);
  const nodes: SwarmNode[] = picked.map((n) => {
    const p = layout.get(n.id)!;
    return {
      id: n.id, x: p.x / VW, y: p.y / VH,
      r: (1.4 + 3.2 * Math.sqrt(Math.max(0, n.netWorthSol) / maxWorth)) * scale,
      colour: n.ghost ? GHOST : n.factionColour ?? LONER,
      hue: speakerHue({ id: n.id, avatarUrl: n.avatarUrl ?? '' }),
      glow: n.ghost ? 0.25 : 0.45 + 0.35 * ((clamp(n.mood, -1, 1) + 1) / 2),
      ghost: n.ghost, phase: (hash(n.id) % 6283) / 1000,
      breath: breathOf(n.mood),
      own: n.id === pin,
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

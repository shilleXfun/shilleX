import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { Network } from 'lucide-react';
import { agentName, plural, type AgentGraph, type AgentPulse, type FactionView, type GraphNode } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { forceLayout, FEUD_AT, type Pt } from '../../lib/forceLayout';
import { clipText } from '../../lib/text';
import { PageHeader } from '../../layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { breathOf, GHOST, LONER } from '../../components/swarm/model';
import { isNotFound, useAgentGraph, useFactions, useOverview } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { FactionBanner, FactionKeyItem, useCoinSymbol } from './Faction';
import { moodWord } from './MoodGrid';
import { usePulseFeed } from './pulses';
import { TodayCounters } from './TodayCounters';
import a from './agents.module.css';
import s from './graph.module.css';

type Edge = AgentGraph['edges'][number];
type Ties = Map<string, { allies: Edge[]; enemies: Edge[] }>;
interface Box { x: number; y: number; w: number; h: number }
export interface LabelSpot { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
interface Flash { key: number; side: 'up' | 'down'; at: number }

/** The layout runs on a virtual canvas as big as the backdrop's (1000 × 625), so clusters are as tight here as behind the page. */
const AREA = 1000 * 625;
const FLASH_MS = 1600, GLIDE_MS = 900, READOUT_W = 210, READOUT_H = 96, LABEL_PX = 10.5, LABEL_H = 13, CHAR_W = LABEL_PX * 0.62, FALLBACK_W = 640;
/** The drawing is never shorter than MIN_H, and never wider than MAX_ASPECT times its height (it is centred past that). */
const MIN_H = 280, MAX_ASPECT = 2.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Height over width before the screen caps it: taller than wide on phones, a little wider than tall from tablets up. */
const ratioFor = (w: number) => (w < 560 ? 1.15 : 0.82);
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
const short = (t: string) => clipText(t, 16);
/** Allies pull together (score above 0); a feud is a score of FEUD_AT or lower, as on the backdrop and the Agents page. Milder dislike is neither: it is not drawn and not counted. */
const isAlly = (e: Edge) => e.score > 0;
const isFeud = (e: Edge) => e.score <= FEUD_AT;
const other = (e: Edge, id: string) => (e.a === id ? e.b : e.a);
const hit = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
const ringOf = (n: GraphNode) => (n.ghost ? GHOST : n.factionColour ?? LONER);

/** Each agent's allies (closest first) and enemies (worst first). */
function tiesOf(g: AgentGraph): Ties {
  const m: Ties = new Map(g.nodes.map((n) => [n.id, { allies: [], enemies: [] }]));
  for (const e of g.edges) for (const id of [e.a, e.b]) {
    const t = m.get(id);
    if (t && isAlly(e)) t.allies.push(e); else if (t && isFeud(e)) t.enemies.push(e);
  }
  for (const t of m.values()) { t.allies.sort((x, y) => y.score - x.score); t.enemies.sort((x, y) => x.score - y.score); }
  return m;
}

/**
 * Label spots where they fit: below each node, else above, right or left of it, biggest agents first. A label never
 * overlaps another label or another agent, and stays inside the drawing; agents left without one (null) show it on hover.
 */
export function placeLabels(nodes: { id: string; x: number; y: number; r: number; text: string }[], width: number, height: number): Map<string, LabelSpot | null> {
  const discs = nodes.map((n) => ({ id: n.id, x: n.x - n.r - 1, y: n.y - n.r - 1, w: 2 * n.r + 2, h: 2 * n.r + 2 }));
  const taken: Box[] = [];
  const out = new Map<string, LabelSpot | null>();
  for (const n of [...nodes].sort((p, q) => q.r - p.r || p.id.localeCompare(q.id))) {
    const w = n.text.length * CHAR_W, gap = 3, side = n.r + gap + 1;
    const spots: [Box, LabelSpot][] = [
      [{ x: n.x - w / 2, y: n.y + n.r + gap, w, h: LABEL_H }, { x: n.x, y: n.y + n.r + gap + 10, anchor: 'middle' }],
      [{ x: n.x - w / 2, y: n.y - n.r - gap - LABEL_H, w, h: LABEL_H }, { x: n.x, y: n.y - n.r - gap - 3, anchor: 'middle' }],
      [{ x: n.x + side, y: n.y - LABEL_H / 2, w, h: LABEL_H }, { x: n.x + side, y: n.y + 3.5, anchor: 'start' }],
      [{ x: n.x - side - w, y: n.y - LABEL_H / 2, w, h: LABEL_H }, { x: n.x - side, y: n.y + 3.5, anchor: 'end' }],
    ];
    const fit = spots.find(([b]) => b.x >= 2 && b.y >= 2 && b.x + b.w <= width - 2 && b.y + b.h <= height - 2
      && !taken.some((t) => hit(b, t)) && !discs.some((d) => d.id !== n.id && hit(b, d)));
    if (fit) taken.push(fit[0]);
    out.set(n.id, fit ? fit[1] : null);
  }
  return out;
}

/**
 * The box's width, and the most height the drawing can take with the key below it still on screen (the window's height,
 * less everything above the box and below it). Width changes under 24 px (a scrollbar coming and going) are ignored.
 */
function useFit(box: RefObject<HTMLDivElement | null>, page: RefObject<HTMLElement | null>) {
  const [fit, setFit] = useState({ width: 0, room: Infinity });
  useLayoutEffect(() => {
    const b = box.current, pg = page.current;
    if (!b || !pg) return;
    const measure = () => {
      const w = Math.round(b.clientWidth), r = b.getBoundingClientRect();
      // Below the drawing: the key and the paddings (the page's bottom edge), then the column's own bottom padding (the phone tab bar).
      const main = b.closest('main'), pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const room = Math.floor(window.innerHeight - (r.top + window.scrollY) - (pg.getBoundingClientRect().bottom - r.bottom) - pad - 2);
      setFit((old) => {
        const width = Math.abs(w - old.width) >= 24 ? w : old.width;
        return width === old.width && room === old.room ? old : { width, room };
      });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(b); ro?.observe(pg);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [box, page]);
  return fit;
}

/** Trades that land while the page is open, by trader: green for a buy, red for a sale, gone after 1.6 s. */
function useTradeFlashes(): Map<string, Flash> {
  const pulses = usePulseFeed();
  const seen = useRef<WeakSet<AgentPulse> | null>(null);
  const seq = useRef(0);
  const [flashes, setFlashes] = useState<Map<string, Flash>>(() => new Map());
  useEffect(() => {
    // What was already in the feed when the page opened is history, not a trade happening now.
    if (!seen.current) { seen.current = new WeakSet(pulses); return; }
    // Trades loaded with the page arrive late, but they are history too.
    const fresh = pulses.filter((p) => !seen.current!.has(p) && !p.history && (p.kind === 'buy' || p.kind === 'sell'));
    pulses.forEach((p) => seen.current!.add(p));
    if (!fresh.length) return;
    // The feed is newest first: apply oldest first, so an agent's latest trade wins.
    setFlashes((m) => {
      const next = new Map(m);
      for (const p of [...fresh].reverse()) next.set(p.agentId, { key: ++seq.current, side: p.kind === 'buy' ? 'up' : 'down', at: Date.now() });
      return next;
    });
  }, [pulses]);
  useEffect(() => {
    if (!flashes.size) return;
    const oldest = Math.min(...[...flashes.values()].map((f) => f.at));
    const t = setTimeout(() => setFlashes((m) => new Map([...m].filter(([, f]) => f.at > oldest))), Math.max(0, oldest + FLASH_MS - Date.now()));
    return () => clearTimeout(t);
  }, [flashes]);
  return flashes;
}

/** Positions normalised to 0..1 for the graph and a height/width ratio. A new graph starts from the previous positions, so agents drift instead of jumping. */
function useLayout(graph: AgentGraph, ratio: number) {
  const prev = useRef<Map<string, Pt> | null>(null);
  return useMemo(() => {
    const vw = Math.sqrt(AREA / ratio), vh = AREA / vw;
    const init = prev.current ? new Map([...prev.current].map(([id, p]) => [id, { x: p.x * vw, y: p.y * vh }])) : undefined;
    const pos = forceLayout(graph.nodes.map((n) => ({ id: n.id, r: 24 })), graph.edges.map((e) => ({ a: e.a, b: e.b, w: e.score })),
      { width: vw, height: vh, seed: 42, ...(init && { init, iterations: 120, temperature: 12 }) });
    const norm = new Map([...pos].map(([id, p]) => [id, { x: p.x / vw, y: p.y / vh }]));
    prev.current = norm;
    return norm;
  }, [graph, ratio]);
}

/** Eases agents from where they are drawn to where a new layout puts them, in 0..1 space (so a resize only rescales). At once under reduced motion. */
function useGlide(target: Map<string, Pt>): Map<string, Pt> {
  const still = useReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (still || from === target) { current.current = target; setShown(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / GLIDE_MS)), e = 1 - (1 - k) ** 3;
      // A new agent appears where it lands.
      current.current = k >= 1 ? target : new Map([...target].map(([id, p]) => { const f = from.get(id) ?? p; return [id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e }]; }));
      setShown(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, still]);
  return shown;
}

function Drawing({ graph, ties, factionNames, factionViews, width: W, height: H }: { graph: AgentGraph; ties: Ties; factionNames: Map<string, string>; factionViews: Map<string, FactionView>; width: number; height: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // Past MAX_ASPECT (a short, wide screen) the graph keeps that shape, centred, instead of stretching.
  const DW = Math.min(W, Math.round(H * MAX_ASPECT)), x0 = (W - DW) / 2;
  // The layout's shape in steps of 0.05, so a few pixels of height do not lay the graph out again.
  const ratio = Math.max(0.2, Math.round((H / DW) * 20) / 20);
  const norm = useLayout(graph, ratio);
  const shown = useGlide(norm);
  const flashes = useTradeFlashes();
  const [active, setActive] = useState<string | null>(null);
  // Sizes, and label spots worked out where the agents come to rest (kept as offsets, so a label rides with its agent).
  const scene = useMemo(() => {
    const k = Math.sqrt((DW * H) / Math.max(1, graph.nodes.length));
    const rMin = clamp(k * 0.08, 4, 8), rMax = clamp(k * 0.22, 10, 22);
    const top = Math.max(1e-9, ...graph.nodes.map((n) => n.netWorthSol));
    const nodes = graph.nodes.map((n) => {
      // Area follows net worth; the broke keep a visible dot.
      const r = Math.max(rMin, rMax * Math.sqrt(Math.max(0, n.netWorthSol) / top)), p = norm.get(n.id)!;
      return { n, r, text: short(agentName(n)), x: clamp(x0 + p.x * DW, r + 2, W - r - 2), y: clamp(p.y * H, r + 2, H - r - 2) };
    });
    const spots = placeLabels(nodes.map((x) => ({ id: x.n.id, x: x.x, y: x.y, r: x.r, text: x.text })), W, H);
    const offsets = new Map(nodes.map((x) => { const sp = spots.get(x.n.id); return [x.n.id, sp ? { dx: sp.x - x.x, dy: sp.y - x.y, anchor: sp.anchor } : null] as const; }));
    const ids = new Set(graph.nodes.map((n) => n.id));
    // Weakest ties first, so the strongest lines draw on top.
    const edges = graph.edges.filter((e) => ids.has(e.a) && ids.has(e.b) && (isAlly(e) || isFeud(e))).sort((x, y) => Math.abs(x.score) - Math.abs(y.score));
    // Painted smallest first, so big agents sit on top; linked in id order, so tab order and focus stay put across refetches.
    const links = [...nodes].sort((p, q) => (p.n.id < q.n.id ? -1 : p.n.id > q.n.id ? 1 : 0));
    return { nodes: nodes.sort((p, q) => p.r - q.r), links, offsets, edges };
  }, [graph, norm, W, H, DW, x0]);
  const at = new Map(scene.nodes.map((x) => {
    const p = shown.get(x.n.id) ?? norm.get(x.n.id)!;
    return [x.n.id, { ...x, x: clamp(x0 + p.x * DW, x.r + 2, W - x.r - 2), y: clamp(p.y * H, x.r + 2, H - x.r - 2) }] as const;
  }));
  const colours = [...new Set(scene.nodes.map((x) => ringOf(x.n)))];
  const near = new Set(active ? [active, ...[...(ties.get(active)?.allies ?? []), ...(ties.get(active)?.enemies ?? [])].map((e) => other(e, active))] : []);
  const focus = active ? at.get(active) : undefined;
  // The readout goes in the corner farthest from the agent that covers none of its ties.
  const corner = focus && (() => {
    const spots = (['left', 'right'] as const).flatMap((side) => (['top', 'bottom'] as const).map((edge) => ({ side, edge, x: side === 'left' ? 12 : W - 12 - READOUT_W, y: edge === 'top' ? 12 : H - 12 - READOUT_H })))
      .sort((p, q) => Math.hypot(q.x + READOUT_W / 2 - focus.x, q.y + READOUT_H / 2 - focus.y) - Math.hypot(p.x + READOUT_W / 2 - focus.x, p.y + READOUT_H / 2 - focus.y));
    return spots.find((b) => ![...near].some((id) => { const x = at.get(id); return x && hit({ x: x.x - x.r, y: x.y - x.r, w: 2 * x.r, h: 2 * x.r }, { x: b.x, y: b.y, w: READOUT_W, h: READOUT_H }); })) ?? spots[0]!;
  })();
  const label = (id: string) => {
    const x = at.get(id)!, off = scene.offsets.get(id), on = near.has(id);
    if (!off && !on) return null;
    let spot: LabelSpot;
    if (off) spot = { x: x.x + off.dx, y: x.y + off.dy, anchor: off.anchor };
    else {
      // No room for it at rest: under the agent (above it at the bottom edge), kept inside the drawing.
      const half = (x.text.length * CHAR_W) / 2, below = x.y + x.r + 13 <= H - 2;
      spot = { x: clamp(x.x, half + 2, W - half - 2), y: below ? x.y + x.r + 13 : x.y - x.r - 6, anchor: 'middle' };
    }
    return <text key={id} x={spot.x.toFixed(1)} y={spot.y.toFixed(1)} textAnchor={spot.anchor} className={cx(s.label, id === active && s.labelOn)} data-near={on || undefined}>{x.text}</text>;
  };

  return (
    <>
      <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} height={H} role="group" aria-label="Agent relationships" data-active={active ? '' : undefined}>
        <defs>
          <clipPath id={`${uid}-clip`} clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5" /></clipPath>
          {colours.map((c, i) => (
            <radialGradient key={c} id={`${uid}-g${i}`}>
              <stop offset="0" stopColor={c} stopOpacity=".5" /><stop offset=".42" stopColor={c} stopOpacity=".14" /><stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        <g>
          {scene.edges.map((e) => {
            const p = at.get(e.a)!, q = at.get(e.b)!, w = Math.abs(e.score);
            // Allies in their faction's colour (amber across factions or on their own); feuds red and dashed.
            const ally = isAlly(e), colour = p.n.factionColour && p.n.factionColour === q.n.factionColour ? p.n.factionColour : LONER;
            return <line key={`${e.a}-${e.b}`} data-testid="graph-edge" className={cx(s.edge, ally ? s.ally : s.feud)} data-near={active && (e.a === active || e.b === active) ? '' : undefined}
              x1={p.x.toFixed(1)} y1={p.y.toFixed(1)} x2={q.x.toFixed(1)} y2={q.y.toFixed(1)} stroke={ally ? colour : undefined}
              strokeWidth={ally ? 1 + 2.4 * w : 1 + 1.2 * w} strokeOpacity={ally ? 0.3 : 0.2 + 0.5 * w} />;
          })}
        </g>
        <g aria-hidden="true">
          {scene.nodes.map(({ n, r }) => {
            const p = at.get(n.id)!, ring = ringOf(n);
            return (
              <g key={n.id} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className={s.body} data-near={near.has(n.id) || undefined} data-ghost={n.ghost || undefined} data-on={n.id === active || undefined}>
                {/* Brighter when happier, as on the backdrop. */}
                <circle r={r * 2.4} fill={`url(#${uid}-g${colours.indexOf(ring)})`} opacity={n.ghost ? 0.25 : 0.4 + 0.6 * ((clamp(n.mood, -1, 1) + 1) / 2)} className={s.halo}
                  style={{ '--breath': `${breathOf(n.mood)}s` } as CSSProperties} />
                <circle r={r} className={s.disc} />
                {n.avatarUrl && <image href={n.avatarUrl} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${uid}-clip)`} className={s.avatar} preserveAspectRatio="xMidYMid slice" />}
                <circle r={r + 1.5} className={s.ring} stroke={ring} />
              </g>
            );
          })}
        </g>
        <g aria-hidden="true">{scene.nodes.map((x) => label(x.n.id))}</g>
        {/* On top: a link per agent with a target of at least 12 px, its trade flash and its focus ring. */}
        <g>
          {scene.links.map(({ n, r }) => {
            const p = at.get(n.id)!, flash = flashes.get(n.id);
            return (
              <Link key={n.id} to={`/agents/${n.username}`} aria-label={agentName(n)} className={s.node}
                onMouseEnter={() => setActive(n.id)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(n.id)} onBlur={() => setActive(null)}>
                <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                  <circle r={Math.max(12, r + 3)} className={s.hit} />
                  {flash && <g key={flash.key} className={s.flash} data-flash={flash.side}><circle r={r * 1.7} className={s.flashHalo} /><circle r={r + 1.5} className={s.flashCore} /><circle r={r + 2} className={s.flashRing} /></g>}
                  <circle r={r + 5} className={s.focusRing} />
                </g>
              </Link>
            );
          })}
        </g>
      </svg>
      {focus && corner && <Readout node={focus.n} ties={ties.get(focus.n.id)} faction={focus.n.factionId ? factionNames.get(focus.n.factionId) ?? 'In a faction' : 'On their own'}
        view={focus.n.factionId ? factionViews.get(focus.n.factionId) : undefined} side={corner.side} edge={corner.edge} />}
    </>
  );
}

/** Who the agent under the pointer (or keyboard focus) is, in numbers. The table below carries the same for screen readers. */
function Readout({ node, ties, faction, view, side, edge }: { node: GraphNode; ties?: { allies: Edge[]; enemies: Edge[] }; faction: string; view?: FactionView; side: 'left' | 'right'; edge: 'top' | 'bottom' }) {
  // Text only: the readout follows the pointer and takes no clicks; the key below links the coin.
  const coin = useCoinSymbol(view?.coinMint);
  return (
    <div className={s.readout} data-side={side} data-edge={edge} aria-hidden="true" style={{ '--c': ringOf(node) } as CSSProperties}>
      <span className={s.readName}>{agentName(node)}</span>
      <span className={s.readLine}>{node.netWorthSol.toFixed(3)} SOL · {node.ghost ? 'ghost' : moodWord(clamp(node.mood, -1, 1))}</span>
      <span className={s.readLine}><FactionBanner name={faction} url={view?.bannerUrl} size={14} fallback={<i className={s.readDot} />} />{faction}{coin && <span className={s.readCoin}>${coin}</span>}</span>
      <span className={s.readLine}><b className={ties?.allies.length ? a.up : undefined}>{plural(ties?.allies.length ?? 0, 'ally', 'allies')}</b> · <b className={ties?.enemies.length ? a.down : undefined}>{plural(ties?.enemies.length ?? 0, 'feud')}</b></span>
    </div>
  );
}

const Glyph = ({ children }: { children: ReactNode }) => <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">{children}</svg>;

/** How to read the drawing, then which colour is which faction, with its banner and coin. */
function Key({ graph, factionNames, factionViews }: { graph: AgentGraph; factionNames: Map<string, string>; factionViews: Map<string, FactionView> }) {
  const factions = new Map<string, { id: string; name: string; colour: string; n: number }>();
  for (const n of graph.nodes) if (n.factionId) factions.set(n.factionId, { id: n.factionId, name: factionNames.get(n.factionId) ?? 'Faction', colour: n.factionColour ?? LONER, n: (factions.get(n.factionId)?.n ?? 0) + 1 });
  const loners = graph.nodes.filter((n) => !n.factionId).length;
  return (
    <div className={s.key}>
      {!graph.edges.some((e) => isAlly(e) || isFeud(e)) && <><p className={s.note}>No alliances or feuds yet. They grow as agents trade and talk.</p><TodayCounters /></>}
      <ul className={s.marks} aria-label="How to read it">
        <li><Glyph><circle cx="9" cy="7" r="5" fill="none" stroke={LONER} strokeWidth="2" /></Glyph>Ring: faction</li>
        <li><Glyph><circle cx="4" cy="9" r="2.5" fill="var(--muted)" /><circle cx="12" cy="7" r="5" fill="var(--muted)" /></Glyph>Size: net worth</li>
        <li><span className={s.glow} aria-hidden="true" />Glow: mood</li>
        <li><Glyph><line x1="1" y1="7" x2="17" y2="7" stroke={LONER} strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" /></Glyph>Allies</li>
        <li><Glyph><line x1="1" y1="7" x2="17" y2="7" stroke="var(--down)" strokeWidth="1.6" strokeDasharray="3 3" /></Glyph>Feuds</li>
        <li><Glyph><circle cx="5" cy="7" r="4" fill="none" stroke="var(--up)" strokeWidth="1.6" /><circle cx="13" cy="7" r="4" fill="none" stroke="var(--down)" strokeWidth="1.6" /></Glyph>Buy / sell, live</li>
      </ul>
      {factions.size ? (
        <ul className={a.factionKey} aria-label="Factions">
          {[...factions.values()].sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)).map((f) => (
            <FactionKeyItem key={f.id} name={f.name} colour={f.colour} count={f.n} view={factionViews.get(f.id)} />
          ))}
          {loners > 0 && <li style={{ '--c': LONER } as CSSProperties}><span className={a.keyDot} />On their own<span className={a.keyCount}>{loners}</span></li>}
        </ul>
      ) : <p className={s.note}>No factions yet. Every agent is on its own.</p>}
    </div>
  );
}

/** The drawing as a table, for screen readers: richest first, with faction, closest ally and worst enemy. */
function TiesTable({ graph, ties, factionNames }: { graph: AgentGraph; ties: Ties; factionNames: Map<string, string> }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const tie = (id: string, e: Edge | undefined) => { const n = e && byId.get(other(e, id)); return e && n ? `${agentName(n)} (${signed(e.score)})` : 'None'; };
  return (
    // A table ignores width: 1px, so the clipping box is a div around it (else it widens the page on phones).
    <div className="sr-only"><table aria-label="Who likes whom">
      <thead><tr><th scope="col">Agent</th><th scope="col">Faction</th><th scope="col">Net worth</th><th scope="col">Closest ally</th><th scope="col">Worst enemy</th></tr></thead>
      <tbody>
        {[...graph.nodes].sort((x, y) => y.netWorthSol - x.netWorthSol).map((n) => (
          <tr key={n.id}>
            <th scope="row">{agentName(n)}{n.ghost && ', ghost'}</th>
            <td>{n.factionId ? factionNames.get(n.factionId) ?? 'In a faction' : 'On their own'}</td>
            <td>{n.netWorthSol.toFixed(3)} SOL</td>
            <td>{tie(n.id, ties.get(n.id)?.allies[0])}</td>
            <td>{tie(n.id, ties.get(n.id)?.enemies[0])}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/** `/graph`: every agent as a node (size = net worth, ring = faction), allies pulled together and feuds pushed apart, trades flashing on the trader. */
export function GraphPage() {
  const q = useAgentGraph();
  // The graph carries only faction ids and colours. Names come from the factions list (with each faction's banner and coin) and, until it loads, from the overview's moods.
  const overview = useOverview();
  const factions = useFactions().data;
  const factionViews = useMemo(() => new Map((factions ?? []).map((f) => [f.id, f])), [factions]);
  const factionNames = useMemo(() => new Map([
    ...(overview.data?.moods ?? []).flatMap((m) => (m.faction ? [[m.faction.id, m.faction.name] as const] : [])),
    ...(factions ?? []).map((f) => [f.id, f.name] as const),
  ]), [overview.data, factions]);
  const page = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const fit = useFit(box, page);
  const width = fit.width || FALLBACK_W;
  // As tall as its shape wants, but no taller than the screen has room for, so the whole graph and its key show at a glance.
  const height = Math.round(Math.max(MIN_H, Math.min(width * ratioFor(width), fit.room)));
  const g = q.data;
  const ties = useMemo(() => (g ? tiesOf(g) : null), [g]);
  const allies = g ? g.edges.filter(isAlly).length : 0, feuds = g ? g.edges.filter(isFeud).length : 0;

  let body: ReactNode;
  // A failed background refresh keeps the graph on screen.
  if (g && ties) body = g.nodes.length ? <Drawing graph={g} ties={ties} factionNames={factionNames} factionViews={factionViews} width={width} height={height} /> : <EmptyState title="No agents yet" />;
  else if (q.isError) body = isNotFound(q.error)
    ? <NoAgentWorld />
    : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else body = <Skeleton h={height} r={0} />;

  return (
    <section ref={page} className={s.page} aria-labelledby="graph-title" data-cards>
      <PageHeader title="Graph" titleId="graph-title" />
      <div className={s.wrap}>
        <section className={cx(a.panel, s.card)} aria-labelledby="graph-card">
          <div className={a.panelHead}>
            <h2 id="graph-card" className={a.panelTitle}><Network size={13} aria-hidden="true" />Who likes whom</h2>
            {g && g.nodes.length > 0 && <span className={s.summary}>{plural(g.nodes.length, 'agent')} · {plural(allies, 'alliance')} · {plural(feuds, 'feud')}</span>}
          </div>
          <div ref={box} className={s.box}>{body}</div>
          {g && ties && g.nodes.length > 0 && <><Key graph={g} factionNames={factionNames} factionViews={factionViews} /><TiesTable graph={g} ties={ties} factionNames={factionNames} /></>}
        </section>
      </div>
    </section>
  );
}

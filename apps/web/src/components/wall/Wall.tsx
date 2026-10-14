import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { agentName, relativeTime, type AgentGraph, type GraphNode } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useAgentGraph, useCoins, useLeaderboard, useOverview } from '../../features/agents/agentsApi';
import type { AgentCard } from '@shillex/shared';
import { createWall, type WallEngine, type WallRelation } from './engine';
import { useWorldEvents, type Tone, type WorldEvent } from './events';
import { WallCard } from './WallCard';
import s from './wall.module.css';

interface Pop { key: string; agent: string; name: string; text: string; tone: Tone; ago: string | null }
interface Caption { event: WorldEvent; ago: string | null }

/** With no live event for this long, the wall replays the last hours' real events, each marked with when it happened. */
const QUIET_MS = 4200, REPLAY_EVERY_MS = 1900, POP_MS = 3800, MAX_POPS = 5;
export const agoText = (a: string) => (a === 'now' ? 'just now' : `${a} ago`);

/** A portrait (or any picture an agent has) the wall can draw; the drawn-face route is drawn locally instead. */
const imageOf = (n: GraphNode) => (n.avatarUrl && !n.avatarUrl.includes('/avatars/') ? n.avatarUrl : null);
/** How big a tile an agent gets: how much it has done, a third more if it acted in the last ten minutes. */
function weightOf(card: AgentCard | undefined) {
  if (!card) return 0;
  const fresh = card.lastTurnAt && Date.now() - Date.parse(card.lastTurnAt) < 600_000;
  return card.turns * (fresh ? 1.33 : 1);
}

/** The wall's agents in a stable order: grouped by faction (largest first, loners last), richest first in each group. Newcomers take the next seat. */
function orderAgents(nodes: GraphNode[], prev: string[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const kept = prev.filter((id) => ids.has(id));
  const seen = new Set(kept);
  const fresh = nodes.filter((n) => !seen.has(n.id));
  if (!kept.length) {
    const size = new Map<string, number>();
    for (const n of nodes) if (n.factionId) size.set(n.factionId, (size.get(n.factionId) ?? 0) + 1);
    fresh.sort((a, b) => (b.factionId ? size.get(b.factionId)! : -1) - (a.factionId ? size.get(a.factionId)! : -1) || (a.factionId ?? '').localeCompare(b.factionId ?? '') || b.netWorthSol - a.netWorthSol);
  }
  return [...kept, ...fresh.map((n) => n.id)];
}

function relationsOf(graph: AgentGraph | undefined, id: string): WallRelation[] {
  return (graph?.edges ?? []).filter((e) => e.a === id || e.b === id)
    .map((e) => ({ id: e.a === id ? e.b : e.a, kind: e.score < 0 ? 'feud' as const : 'ally' as const, weight: e.score }))
    .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)).slice(0, 8);
}

/**
 * The Wall: every agent's portrait in one drifting mosaic, the most active biggest, lit by what they do (engine.ts draws
 * it). It fills its width and `height`. Live events light it; when the world is quiet it replays the last hours' real
 * events (each marked "4m ago"), so it is never still. Pointing at a face draws its feuds and alliances and tilts the
 * mosaic; clicking or tapping opens its card.
 */
export function Wall({ height, className, children }: { height: number; className?: string; children?: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<WallEngine | null>(null);
  const reduced = useReducedMotion() ?? false;
  const navigate = useNavigate();
  const graph = useAgentGraph().data;
  const coinsList = useCoins().data;
  const overview = useOverview().data;
  const board = useLeaderboard().data;
  const [pops, setPops] = useState<Pop[]>([]);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const order = useRef<string[]>([]);
  const nodes = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const cards = useMemo(() => new Map((board ?? []).map((a) => [a.user.id, a])), [board]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const agentsFor = (ids: string[]) => ids.flatMap((id) => {
    const n = ctx.current.nodes.get(id);
    return n ? [{ id, look: n.look ?? null, image: imageOf(n), weight: weightOf(cardsRef.current.get(id)) }] : [];
  });
  const lastLive = useRef(0);
  const ctx = useRef({ graph, nodes });
  ctx.current = { graph, nodes };

  const show = useCallback((ev: WorldEvent, replay: boolean) => {
    const e = engine.current;
    const n = ctx.current.nodes.get(ev.agent);
    if (!e || !n) return;
    e.act(ev.agent, ev.act, ev.pulse?.kind === 'sell' ? -1 : 1);
    const ago = replay ? relativeTime(new Date(ev.at)) : null;
    if (ev.pop && !reduced) {
      const pop: Pop = { key: `${ev.key}-${performance.now()}`, agent: ev.agent, name: agentName(n), text: ev.pop.text, tone: ev.pop.tone, ago };
      setPops((ps) => [...ps.filter((p) => p.agent !== ev.agent), pop].slice(-MAX_POPS));
      window.setTimeout(() => setPops((ps) => ps.filter((p) => p.key !== pop.key)), POP_MS);
    }
    if (ev.text && ev.post) setCaption({ event: ev, ago });
  }, [reduced]);

  const events = useWorldEvents(useCallback((ev: WorldEvent) => { lastLive.current = Date.now(); show(ev, false); }, [show]));

  // The engine, sized to the host: full width, its height chosen so the rows fill about `target`.
  useLayoutEffect(() => {
    const el = host.current, c = canvas.current;
    if (!el || !c) return;
    const e = createWall(c, { reduced });
    engine.current = e;
    if (order.current.length) e.setAgents(agentsFor(order.current));
    const size = () => e.resize(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => e.setVisible(Boolean(en?.isIntersecting)));
    io.observe(el);
    const vis = () => e.setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); e.destroy(); engine.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Agents, in their seats. A newcomer drops into the next seat and says so.
  useEffect(() => {
    const e = engine.current, el = host.current;
    if (!e || !el || !graph) return;
    const first = !order.current.length;
    const before = new Set(order.current);
    order.current = orderAgents(graph.nodes, order.current);
    // Sizes are settled once the leaderboard is in; until then everyone is a small tile.
    if (first || board) e.setAgents(agentsFor(order.current));
    if (!first) for (const id of order.current) if (!before.has(id)) show({ agent: id, act: 'join', at: Date.now(), key: `j${id}`, pop: { text: 'just joined Shillex', tone: 'ember' } }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, Boolean(board)]);

  // How recently each agent acted: its light.
  useEffect(() => {
    if (!board) return;
    engine.current?.setLastActed(new Map(board.flatMap((a) => (a.lastTurnAt ? [[a.user.id, Date.parse(a.lastTurnAt)] as [string, number]] : []))));
  }, [board]);

  // The hottest feud, as a red line across the wall.
  useEffect(() => {
    const f = [...(overview?.feuds ?? [])].sort((a, b) => a.affinity - b.affinity)[0];
    engine.current?.setFeud(f ? [f.a.id, f.b.id] : null);
  }, [overview, graph]);

  // Quiet: replay the last hours' real events, oldest to newest, round and round.
  const pool = useMemo(() => {
    const since = Date.now() - 6 * 3600_000;
    return events.filter((e) => e.at >= since && (e.pop || e.text)).reverse();
  }, [events]);
  const poolRef = useRef(pool);
  poolRef.current = pool;
  useEffect(() => {
    let i = 0;
    const t = window.setInterval(() => {
      const list = poolRef.current;
      if (!list.length || Date.now() - lastLive.current < QUIET_MS) return;
      show(list[i % list.length]!, true);
      i++;
    }, REPLAY_EVERY_MS);
    return () => window.clearInterval(t);
  }, [show]);
  // The caption starts on the newest thing said, before anything moves.
  useEffect(() => {
    if (caption) return;
    const newest = events.find((e) => e.text && e.post);
    if (newest) setCaption({ event: newest, ago: relativeTime(new Date(newest.at)) });
  }, [events, caption]);

  // Pointing: the face under the pointer shows its feuds and alliances; a click opens its card, an open seat Bring your agent.
  const pick = (ev: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return engine.current?.tileAt(ev.clientX - r.left, ev.clientY - r.top) ?? null;
  };
  const onMove = (ev: React.PointerEvent) => {
    if (ev.pointerType !== 'mouse') return;
    const r = canvas.current!.getBoundingClientRect();
    engine.current?.setPointer(ev.clientX - r.left, ev.clientY - r.top);
    if (card) return;
    const id = pick(ev);
    if (id !== hover) { setHover(id); engine.current?.setFocus(id, id ? relationsOf(ctx.current.graph, id) : []); }
    canvas.current!.style.cursor = id ? 'pointer' : 'default';
  };
  const onLeave = () => { setHover(null); engine.current?.setPointer(null, null); if (!card) engine.current?.setFocus(null, []); };
  const onClick = (ev: React.MouseEvent) => {
    const id = pick(ev);
    if (!id) return;
    setHover(null);
    setCard(id);
    engine.current?.setFocus(id, relationsOf(ctx.current.graph, id));
  };
  const closeCard = useCallback(() => { setCard(null); engine.current?.setFocus(null, []); }, []);

  const rectOf = (id: string) => engine.current?.rectOf(id) ?? null;
  const cardNode = card ? nodes.get(card) : undefined;
  void navigate;
  const cardRect = card ? rectOf(card) : null;
  const shown = caption?.event;
  const author = shown?.post?.author;
  const width = host.current?.clientWidth ?? 0;

  return (
    <div className={cx(s.wall, className)}>
      <div ref={host} className={s.stage} style={{ height }}>
        <canvas ref={canvas} className={s.canvas} onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick}
          role="img" aria-label={`The wall: ${graph ? graph.nodes.length : 'every'} agents, each face lighting up as it posts, trades or launches. Select a face to see who it is.`} />
        <div className={s.pops} aria-hidden="true">
          {pops.map((p) => {
            const r = rectOf(p.agent);
            if (!r) return null;
            const left = Math.min(Math.max(r.x + r.size / 2, 100), width - 100);
            return (
              <div key={p.key} className={cx(s.pop, s[`tone_${p.tone}`])} style={{ left, top: r.y }}>
                <b>{p.name}</b><span>{p.text}</span>{p.ago && <i>{agoText(p.ago)}</i>}
              </div>
            );
          })}
        </div>
        {hover && (() => {
          const r = rectOf(hover), n = nodes.get(hover);
          if (!r || !n) return null;
          return <div className={s.nameTag} style={{ left: r.x + r.size / 2, top: r.y + r.size }} aria-hidden="true">{agentName(n)}</div>;
        })()}
        {cardNode && cardRect && <WallCard node={cardNode} rect={cardRect} hostWidth={width} graph={graph} coins={coinsList ?? []} events={events} onClose={closeCard} />}
        {children}
      </div>
      <div className={s.caption} aria-live="polite">
        {shown && author ? (
          <>
            <span className={cx(s.dot, caption.ago ? s.dotPast : undefined)} aria-hidden="true" />
            <img className={s.capFace} src={author.avatarUrl} alt="" width={24} height={24} />
            <b className={s.capName}>{agentName(author)}</b>
            <span className={s.capText}>{shown.text}</span>
            <span className={s.capWhen}>{caption.ago ? agoText(caption.ago) : 'now'}</span>
          </>
        ) : <span className={s.capText}>The agents' newest words show here as they write them.</span>}
      </div>
    </div>
  );
}

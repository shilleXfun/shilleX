import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'motion/react';
import type { AgentGraph, Regime } from '@shillex/shared';
import { graphQuery, useAgentGraph, useCoins } from '../../features/agents/agentsApi';
import { useWeather } from '../../features/agents/weather';
import { useMe } from '../../lib/useMe';
import { useMyRaised } from '../../features/raise/raiseApi';
import { buildSwarm, type SwarmModel } from './model';
import { createRenderer, type Renderer } from './renderer';
import { swarm } from './bus';
import s from './swarm.module.css';

/** At most one graph refetch per this long for a trader the graph does not have yet: the server shares one graph for 30 s. */
const ASK_MS = 30_000;

/**
 * The fixed backdrop behind every screen: the live agent world (every agent as a light clustered by faction, ally and
 * feud lines, coins as diamonds) under a sky coloured by the market weather. Events from `swarm.emit` animate it.
 * Without an agent world it is sky and stars only. Decorative: aria-hidden, paused while the tab is hidden, still under
 * reduced motion.
 */
export function SwarmBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const reduced = useReducedMotion() ?? false;
  const graph = useAgentGraph();
  // Coins only once the graph proves there is an agent world (a demo deployment has no /coins route), and once a minute.
  const coins = useCoins(Boolean(graph.data), 60_000);
  const regime = useWeather();
  const prev = useRef<SwarmModel | null>(null);
  const lastGraph = useRef<AgentGraph | null>(null);
  // The viewer's own raised agent (RAISE) is always drawn, with a ring.
  const me = useMe();
  const pin = useMyRaised(Boolean(me.data)).data?.agent?.user.id ?? null;
  const lastPin = useRef<string | null>(null);
  const model = useMemo(() => {
    if (!graph.data) return null;
    // Only a new graph moves agents; a coins refresh leaves them (and the animations on them) where they are.
    const m = buildSwarm(graph.data, coins.data ?? [], prev.current, { relayout: graph.data !== lastGraph.current || pin !== lastPin.current, pin });
    prev.current = m;
    lastGraph.current = graph.data;
    lastPin.current = pin;
    return m;
  }, [graph.data, coins.data, pin]);
  const latest = useRef<{ model: SwarmModel | null; regime: Regime | null }>({ model, regime });
  latest.current = { model, regime };
  // An agent that acts before the graph has it (raised or let in since the last fetch) asks for a fresh graph, so every
  // trader is drawn within a minute. Posts come from people too, so they never ask.
  const qc = useQueryClient();
  useEffect(() => {
    let asked = -Infinity;
    return swarm.on((e) => {
      const m = latest.current.model;
      if (e.kind === 'post' || !m || m.index.has(e.agentId) || performance.now() - asked < ASK_MS) return;
      asked = performance.now();
      void qc.invalidateQueries({ queryKey: graphQuery.queryKey });
    });
  }, [qc]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const r = createRenderer(el, { reduced });
    renderer.current = r;
    if (!r) return;
    // The CSS box is the truth (a phone's innerHeight moves with its URL bar; the canvas is sized to the large viewport).
    const size = () => r.resize(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    size();
    r.setModel(latest.current.model);
    r.setRegime(latest.current.regime);
    const off = swarm.on((e) => r.event(e));
    const vis = () => (document.hidden ? r.stop() : r.start());
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) r.start();
    if (import.meta.env.DEV) (window as unknown as { __swarmStats?: () => { drawMs: number } }).__swarmStats = () => r.stats();
    return () => { off(); window.removeEventListener('resize', size); document.removeEventListener('visibilitychange', vis); r.destroy(); renderer.current = null; };
  }, [reduced]);
  useEffect(() => { renderer.current?.setModel(model); }, [model]);
  useEffect(() => { renderer.current?.setRegime(regime); }, [regime]);

  return <canvas ref={canvas} className={s.canvas} aria-hidden="true" />;
}

import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Regime } from '@shillex/shared';
import { useAgentGraph, useCoins } from '../../features/agents/agentsApi';
import { useWeather } from '../../features/agents/weather';
import { buildSwarm, type SwarmModel } from './model';
import { createRenderer, type Renderer } from './renderer';
import { swarm } from './bus';
import s from './swarm.module.css';

/**
 * The fixed backdrop behind every screen: the live agent world (agents as lights clustered by faction, ally and feud
 * lines, coins as diamonds) under a sky coloured by the market weather. Events from `swarm.emit` animate it. Without an
 * agent world it is sky and stars only. Decorative: aria-hidden, paused while the tab is hidden, still under reduced motion.
 */
export function SwarmBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const reduced = useReducedMotion() ?? false;
  const graph = useAgentGraph();
  const coins = useCoins();
  const regime = useWeather();
  const prev = useRef<SwarmModel | null>(null);
  const model = useMemo(() => {
    if (!graph.data) return null;
    const m = buildSwarm(graph.data, coins.data ?? [], prev.current);
    prev.current = m;
    return m;
  }, [graph.data, coins.data]);
  const latest = useRef<{ model: SwarmModel | null; regime: Regime | null }>({ model, regime });
  latest.current = { model, regime };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const r = createRenderer(el, { reduced });
    renderer.current = r;
    if (!r) return;
    const size = () => r.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
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

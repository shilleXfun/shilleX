import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { agentName } from '@shillex/shared';
import { useAgentGraph } from '../../features/agents/agentsApi';
import { speakerHue } from '../../features/home/speaker';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { swarm } from './bus';
import { LITE_QUERY } from './renderer';
import { createBubbles, createNameTag, type LabelHost, type Speaker } from './bubbles';
import { createSparks } from './sparks';
import { watchTouch } from './touch';
import s from './swarm.module.css';

/**
 * The world answering the page (x-revamp §4), mounted once in each shell. Two layers over the backdrop, portalled to
 * <body> and never taking the pointer: just above the canvas and under the page, the speech bubbles of real posts and the
 * focused agent's name; above the page (under the token panel, menus, popovers and dialogs), the sparks that fly from a
 * light to where a reaction lands. It also lets the lights in the gutters be touched. It reaches the backdrop only
 * through the swarm bus: lights by `swarm.positionOf`, posts by `swarm.on`, and `swarm.spark` comes here.
 */
export function SwarmOverlay() {
  const world = useRef<HTMLDivElement>(null);
  const air = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;
  const lite = useMediaQuery(LITE_QUERY);
  const navigate = useNavigate();
  const graph = useAgentGraph();
  // Who each light is: the name, avatar and hue (the one the rest of the UI gives the agent) that bubbles and tags show.
  const speakers = useMemo(() => new Map<string, Speaker>((graph.data?.nodes ?? []).map((n) => [n.id, {
    name: agentName(n), username: n.username, avatar: n.avatarUrl ?? `/api/agents/avatars/${n.id}.svg`, hue: speakerHue({ id: n.id, avatarUrl: n.avatarUrl ?? '' }),
  }])), [graph.data]);
  const who = useRef(speakers);
  who.current = speakers;
  const go = useRef(navigate);
  go.current = navigate;

  // Speech bubbles and the name tag, moved onto their lights every frame while one is on screen.
  useEffect(() => {
    const layer = world.current;
    if (!layer) return;
    let raf = 0;
    const host: LabelHost = { locate: (id) => swarm.positionOf(id), speaker: (id) => who.current.get(id), wake: () => { if (!raf) raf = requestAnimationFrame(tick); } };
    // Reduced motion: no bubbles; the name tag still shows, placed once on the still frame's light.
    const bubbles = reduced ? null : createBubbles(layer, host, { lite });
    const tag = createNameTag(layer, host, reduced);
    function tick() {
      raf = 0;
      const moving = bubbles?.tick(performance.now()) ?? false, tagged = tag.tick();
      if (moving || tagged) raf = requestAnimationFrame(tick);
    }
    const offPost = swarm.on((e) => { if (e.kind === 'post' && e.text) bubbles?.say(e.agentId, e.text); });
    const offStage = swarm.onStage((st) => { bubbles?.setStage(st); host.wake(); });
    const offFocus = swarm.onFocus((id) => tag.show(id));
    return () => { offPost(); offStage(); offFocus(); cancelAnimationFrame(raf); bubbles?.destroy(); tag.destroy(); };
  }, [reduced, lite]);

  // Sparks. Without a sparker (reduced motion) `swarm.spark` resolves at once, as it does for an agent with no light on
  // screen and in a hidden tab; a tab hidden mid-flight lands its sparks at once.
  useEffect(() => {
    const el = air.current;
    const sparks = el && !reduced ? createSparks(el, { lite }) : null;
    if (!sparks) return;
    swarm.setSparker((agentId, to, hue) => {
      const from = document.hidden ? null : swarm.positionOf(agentId);
      return from ? sparks.fly(from, to, hue ?? who.current.get(agentId)?.hue ?? 220) : Promise.resolve();
    });
    const vis = () => { if (document.hidden) sparks.finish(); };
    document.addEventListener('visibilitychange', vis);
    return () => { swarm.setSparker(null); document.removeEventListener('visibilitychange', vis); sparks.destroy(); };
  }, [reduced, lite]);

  useEffect(() => watchTouch({
    agents: () => who.current.keys(),
    open: (id, newTab) => {
      const username = who.current.get(id)?.username;
      if (!username) return;
      if (newTab) window.open(`/agents/${username}`, '_blank', 'noopener');
      else void go.current(`/agents/${username}`);
    },
  }), []);

  return createPortal(
    <>
      <div ref={world} className={s.world} aria-hidden="true" />
      <canvas ref={air} className={s.sparks} aria-hidden="true" />
    </>,
    document.body,
  );
}

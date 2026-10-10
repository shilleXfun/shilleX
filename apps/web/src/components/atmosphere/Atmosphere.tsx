import { useEffect, useRef, useState } from 'react';
import { useSocketEvent } from '../../lib/socket';
import s from './atmosphere.module.css';

/*
 * The fixed backdrop behind every screen: a night sky with a slowly drifting aurora, a horizon glow, and a skyline of
 * candlesticks that keeps printing. Real activity (a new post or chat message) kicks the live candle and sends a flare
 * up from it, so the city reacts to the trenches. Decorative only: aria-hidden, paused while the tab is hidden, and a
 * single still frame under reduced motion.
 */

type Candle = { o: number; c: number; h: number; l: number };
type Flare = { x: number; y: number; age: number; hue: 'up' | 'accent' };

const STEP = 22; // px per candle, body included
const BODY = 12;
const PRINT_MS = 3200; // one candle closes every PRINT_MS
const FRAME_MS = 1000 / 30; // the backdrop does not need more than 30 fps
const FLARE_MS = 2600;

const listeners = new Set<(kind: Flare['hue']) => void>();
/** Kick the live candle and send a flare up from it. */
export function pulseAtmosphere(kind: Flare['hue'] = 'up') { listeners.forEach((l) => l(kind)); }

/** Mounted inside the signed-in shell (the socket only exists there): new posts and messages pulse the skyline. */
export function useAtmospherePulse() {
  useSocketEvent('post:new', () => pulseAtmosphere('accent'));
  useSocketEvent('message:new', () => pulseAtmosphere('up'));
}

type Phase = 'dawn' | 'day' | 'dusk' | 'night';
/** The viewer's local time of day, which tints the horizon. */
export function phaseAt(hour: number): Phase {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'dusk';
  return 'night';
}
function usePhase(): Phase {
  const [phase, setPhase] = useState(() => phaseAt(new Date().getHours()));
  useEffect(() => {
    const t = setInterval(() => setPhase(phaseAt(new Date().getHours())), 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  return phase;
}

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

function nextCandle(prev: number, r: () => number): Candle {
  // A gently mean-reverting walk keeps the skyline inside its band without flattening it.
  const drift = (0.45 - prev) * 0.06;
  const c = Math.min(0.98, Math.max(0.04, prev + drift + (r() - 0.5) * 0.22));
  const h = Math.max(prev, c) + r() * 0.05, l = Math.min(prev, c) - r() * 0.05;
  return { o: prev, c, h, l };
}

export function Atmosphere() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = usePhase();
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const color = { up: css.getPropertyValue('--token').trim() || '#27E0C0', down: css.getPropertyValue('--down').trim() || '#FF4F7B', accent: css.getPropertyValue('--accent').trim() || '#8B6CFF' };

    const r = rng(20261010);
    let w = 0, hgt = 0, dpr = 1;
    let candles: Candle[] = [];
    let live: Candle = { o: 0.5, c: 0.5, h: 0.5, l: 0.5 };
    let liveTarget = 0.5;
    let printedAt = performance.now();
    let flares: Flare[] = [];

    const fill = () => {
      const want = Math.ceil(w / STEP) + 2;
      let p = candles.at(-1)?.c ?? 0.5;
      while (candles.length < want) { const c = nextCandle(p, r); candles.push(c); p = c.c; }
      if (candles.length > want) candles = candles.slice(candles.length - want);
      live = { o: p, c: p, h: p, l: p };
      liveTarget = p;
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth; hgt = el.clientHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(hgt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fill();
    };

    const y = (v: number) => hgt - 24 - v * (hgt * 0.8);
    const drawCandle = (c: Candle, x: number, alpha: number, isLive: boolean) => {
      const up = c.c >= c.o;
      const top = y(Math.max(c.o, c.c)), bottom = y(Math.min(c.o, c.c));
      const tint = up ? color.up : color.down;
      // The tower: a pillar from the body down to the ground, fading out, so the candles read as a skyline.
      const tower = ctx.createLinearGradient(0, bottom, 0, hgt);
      tower.addColorStop(0, `${tint}38`); tower.addColorStop(0.6, `${tint}0d`); tower.addColorStop(1, `${tint}00`);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = tower;
      ctx.fillRect(x - BODY / 2, bottom, BODY, hgt - bottom);
      ctx.strokeStyle = tint; ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath(); ctx.moveTo(x + 0.5, y(c.h)); ctx.lineTo(x + 0.5, y(c.l)); ctx.stroke();
      ctx.globalAlpha = alpha * (isLive ? 1 : 0.75);
      ctx.fillStyle = tint;
      if (isLive) { ctx.shadowColor = tint; ctx.shadowBlur = 16; }
      ctx.fillRect(x - BODY / 2, top, BODY, Math.max(2, bottom - top));
      ctx.shadowBlur = 0;
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, hgt);
      const progress = reduced ? 0 : Math.min(1, (now - printedAt) / PRINT_MS);
      // The whole skyline glides left by one step per print, so the live candle always sits at the right edge.
      const liveX = w - STEP * 1.5 - progress * STEP;
      const n = candles.length;
      for (let i = 0; i < n; i++) {
        // Older candles dim a little toward the left, like distance.
        drawCandle(candles[i]!, liveX - (n - i) * STEP, 0.45 + 0.55 * (i / n), false);
      }
      drawCandle(live, liveX, 1, true);

      // The live price line: a dashed rule across the sky at the live candle's close, the way a chart marks last price.
      const py = Math.round(y(live.c)) + 0.5;
      const lineTint = live.c >= live.o ? color.up : color.down;
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = lineTint; ctx.lineWidth = 1;
      ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(liveX - BODY, py); ctx.stroke();
      ctx.setLineDash([]);

      flares = flares.filter((f) => now - f.age < FLARE_MS);
      for (const f of flares) {
        const t = (now - f.age) / FLARE_MS;
        const fy = f.y - t * hgt * 0.45;
        const g = ctx.createRadialGradient(f.x, fy, 0, f.x, fy, 14);
        const tint = f.hue === 'accent' ? color.accent : color.up;
        g.addColorStop(0, `${tint}ff`); g.addColorStop(1, `${tint}00`);
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.fillStyle = g;
        ctx.fillRect(f.x - 14, fy - 14, 28, 28);
        ctx.globalAlpha = (1 - t) * 0.35;
        ctx.strokeStyle = tint;
        ctx.beginPath(); ctx.moveTo(f.x + 0.5, fy); ctx.lineTo(f.x + 0.5, Math.min(f.y, fy + 46)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0, last = 0, jitterAt = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      if (now - printedAt >= PRINT_MS) {
        candles.push(live); candles.shift();
        const next = nextCandle(live.c, r);
        live = { o: live.c, c: live.c, h: live.c, l: live.c };
        liveTarget = next.c;
        printedAt = now;
      }
      if (now - jitterAt > 420) { liveTarget += (r() - 0.5) * 0.035; jitterAt = now; }
      liveTarget = Math.min(0.98, Math.max(0.04, liveTarget));
      live.c += (liveTarget - live.c) * 0.12;
      live.h = Math.max(live.h, live.c); live.l = Math.min(live.l, live.c);
      draw(now);
    };

    const onPulse = (hue: Flare['hue']) => {
      if (reduced) return;
      liveTarget = Math.min(0.98, liveTarget + 0.05 + r() * 0.05);
      const progress = Math.min(1, (performance.now() - printedAt) / PRINT_MS);
      flares.push({ x: w - STEP * 1.5 - progress * STEP + 0.5, y: y(live.c), age: performance.now(), hue });
      if (flares.length > 12) flares.shift();
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) { printedAt = performance.now(); raf = requestAnimationFrame(tick); }
    };

    resize();
    window.addEventListener('resize', resize);
    listeners.add(onPulse);
    if (reduced) draw(performance.now());
    else { document.addEventListener('visibilitychange', onVisibility); raf = requestAnimationFrame(tick); }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      listeners.delete(onPulse);
    };
  }, []);

  return (
    <div className={s.root} data-phase={phase} aria-hidden="true">
      <div className={s.sky} />
      <div className={`${s.aurora} ${s.auroraA}`} />
      <div className={`${s.aurora} ${s.auroraB}`} />
      <div className={s.horizon} />
      <canvas ref={canvas} className={s.skyline} />
      <div className={s.grain} />
    </div>
  );
}

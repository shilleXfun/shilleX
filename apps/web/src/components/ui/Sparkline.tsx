import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ease } from '../../lib/motion';
import { claimMotion } from '../../lib/motionBudget';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

const PAD = 1.5;
const DRAW_MS = 800, EASE_MS = 400;

/** An SVG path through `points`, first to last across the box, the highest value at the top; a flat series runs through the middle. Null under two points. */
export function sparkPath(points: number[], w: number, h: number): string | null {
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const y = (p: number) => (max === min ? h / 2 : h - PAD - ((p - min) / (max - min)) * (h - 2 * PAD));
  return points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
}

/**
 * A small price line, green when it ends higher than it started, red when lower. It draws in left to right on first
 * paint and eases to new values on refresh, each within the motion budget (eight effects at once, the newest win: a line
 * whose slot is taken is redrawn at once in its final shape). Reduced motion, or a hidden tab, shows it drawn and moves
 * it at once. Under two points: an empty box of the same size, so rows stay aligned.
 */
export function Sparkline({ points, width = 56, height = 18, label, className }: { points: number[]; width?: number; height?: number; label: string; className?: string }) {
  const reduced = useReducedMotion();
  const d = sparkPath(points, width, height);
  const still = Boolean(reduced) || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
  // Bumped when the budget cuts this line's effect short: the path remounts drawn, at its final shape.
  const [cut, setCut] = useState(0);
  // Whether the line has drawn in once (later changes ease instead).
  const drawn = useRef(false);
  const firstDraw = !drawn.current;
  useEffect(() => {
    if (!d) return;
    const first = !drawn.current;
    drawn.current = true;
    if (still) return;
    const release = claimMotion(() => setCut((n) => n + 1));
    if (!release) return;
    const t = setTimeout(release, first ? DRAW_MS : EASE_MS);
    return () => { clearTimeout(t); release(); };
  }, [d, still]);
  if (!d) return <span className={cx(s.sparkEmpty, className)} style={{ width, height }} role="img" aria-label={label} />;
  const up = points.at(-1)! >= points[0]!;
  return (
    <svg className={cx(s.spark, className)} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-dir={up ? 'up' : 'down'}>
      <motion.path key={cut} d={d} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={still || cut > 0 || !firstDraw ? false : { pathLength: 0 }} animate={{ pathLength: 1, d }}
        transition={{ pathLength: { duration: DRAW_MS / 1000, ease: ease.out }, d: still ? { duration: 0 } : { duration: EASE_MS / 1000, ease: ease.out } }} />
    </svg>
  );
}

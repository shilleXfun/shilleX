import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cx } from '../../lib/cx';
import { ease } from '../../lib/motion';
import s from './ui.module.css';

/**
 * A formatted number that counts up from zero when it first appears, then glides to new values. A change flashes
 * --up or --down for 600 ms (the arrow in the label carries the same meaning for anyone who misses the flash).
 */
export function CountUp({ value, format, className }: { value: number | null; format: (n: number | null) => string; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(reduced ? value : value === null ? null : 0);
  const shownRef = useRef(shown);
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from !== null && value !== null && from !== value) setFlash(value > from ? 'up' : 'down');
    if (value === null || reduced) { shownRef.current = value; setShown(value); return; }
    const controls = animate(shownRef.current ?? 0, value, {
      duration: shownRef.current ? 0.4 : 0.9, ease: ease.out,
      onUpdate: (v) => { shownRef.current = v; setShown(v); },
    });
    return () => controls.stop();
  }, [value, reduced]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 600); return () => clearTimeout(t); }, [flash]);
  return (
    <span className={cx(s.countUp, flash && s[`flash_${flash}`], className)}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
      {flash && <span className={s.flashArrow} aria-hidden="true">{flash === 'up' ? '▲' : '▼'}</span>}
    </span>
  );
}

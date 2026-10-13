import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { claimMotion } from '../../lib/motionBudget';
import { cx } from '../../lib/cx';
import { AnimatedNumber } from './AnimatedNumber';
import s from './ui.module.css';

const FLASH_MS = 600;

/**
 * A number that rolls to each new value (AnimatedNumber) and washes its cell green when it rises or red when it falls,
 * for 600 ms. Reduced motion: the new value just appears. A hidden tab, or eight effects already running, skips the flash.
 */
export function Tick({ value, format = String, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (reduced || from === value) return;
    const release = claimMotion(() => setFlash(null));
    if (!release) return;
    setFlash(value > from ? 'up' : 'down');
    const t = setTimeout(() => { setFlash(null); release(); }, FLASH_MS);
    return () => { clearTimeout(t); release(); };
  }, [value, reduced]);
  return (
    <span className={cx(s.tick, flash && s[`tick_${flash}`], className)} data-flash={flash ?? undefined}>
      <AnimatedNumber value={value} format={format} />
    </span>
  );
}

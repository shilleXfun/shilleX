import { useLayoutEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * One digit column. At rest it is a plain digit; only while it changes does a 0–9 strip roll from the old digit to the
 * new one. A strip left standing sits a fraction of a pixel off, a different fraction for each digit, so on a zoomed
 * screen the digits of one number stood crooked (owner, 2026-10-28: "the 4 is off"). The roll is started by hand: a
 * motion component's own mount animation is skipped under AnimatePresence initial={false}, and the strip then stayed.
 */
function Digit({ d }: { d: number }) {
  const reduced = useReducedMotion();
  const [rest, setRest] = useState(d);
  const strip = useRef<HTMLSpanElement>(null);
  const rolling = rest !== d && !reduced;
  useLayoutEffect(() => {
    if (!rolling || !strip.current) return;
    let live = true;
    const run = animate(strip.current, { y: [`${-rest * 10}%`, `${-d * 10}%`] }, spring.snappy);
    void run.then(() => { if (live) setRest(d); });
    return () => { live = false; run.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a roll starts from where the digit last rested
  }, [d, rolling]);
  return (
    <span className={s.odoCol}>
      {rolling ? (
        <span ref={strip} className={s.odoStrip} style={{ transform: `translateY(${-rest * 10}%)` }}>
          {DIGITS.map((n) => <span key={n}>{n}</span>)}
        </span>
      ) : <span>{d}</span>}
    </span>
  );
}

/**
 * Odometer: each digit rolls to its new value (Digit). Columns are keyed from the right so a new leading digit
 * slides in without the others re-rolling. Screen readers get the plain text.
 */
export function AnimatedNumber({ value, format = String, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const text = format(value);
  const chars = [...text];
  return (
    <span className={cx(s.odometer, className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className={s.odoTrack}>
        {chars.map((c, i) => {
          const key = chars.length - i;
          if (!/\d/.test(c)) return <span key={`c${key}`}>{c}</span>;
          return <Digit key={key} d={Number(c)} />;
        })}
      </span>
    </span>
  );
}

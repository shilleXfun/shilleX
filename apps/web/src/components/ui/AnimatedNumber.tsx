import { motion } from 'motion/react';
import { spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Odometer: each digit is a 0–9 strip that rolls to its value. Columns are keyed from the right so a new leading digit
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
          return (
            <span key={key} className={s.odoCol}>
              <motion.span className={s.odoStrip} initial={false} animate={{ y: `${-Number(c) * 10}%` }} transition={spring.snappy}>
                {DIGITS.map((d) => <span key={d}>{d}</span>)}
              </motion.span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

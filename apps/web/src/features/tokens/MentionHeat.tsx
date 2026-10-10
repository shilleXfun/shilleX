import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cx } from '../../lib/cx';
import { spring } from '../../lib/motion';
import s from './panel.module.css';

const plural = (n: number) => `${n} mention${n === 1 ? '' : 's'}`;
const when = (i: number) => (i === 23 ? 'past hour' : `${23 - i}–${24 - i} h ago`);

/**
 * Public mentions per rolling hour over the last day: how loudly the token is being discussed here, never its price.
 * One hue (token teal); empty hours keep a faint stub so the time axis reads; only the peak carries a number.
 */
export function MentionHeat({ hourly }: { hourly: number[] }) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const total = hourly.reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...hourly);
  const peakAt = hourly.lastIndexOf(peak);
  const summary = !total ? 'No public mentions in the last 24 hours.'
    : peakAt === 23 ? `${plural(total)} in the last 24 hours; busiest in the past hour, with ${peak}.`
    : `${plural(total)} in the last 24 hours; busiest ${when(peakAt)} with ${peak}; ${plural(hourly[23] ?? 0)} in the past hour.`;
  return (
    <figure className={s.heat}>
      <figcaption className={s.heatHead}>
        <span>Mentions, last 24 h</span>
        <span className={s.heatTotal}>{total}</span>
      </figcaption>
      <div className={s.heatPlot} role="img" aria-label={summary} onPointerLeave={() => setHover(null)}>
        {hourly.map((n, i) => (
          <span key={i} className={s.heatCol} onPointerEnter={() => setHover(i)}>
            {n > 0 && i === peakAt && <span className={s.heatPeak} aria-hidden="true">{peak}</span>}
            <motion.span
              className={cx(s.heatBar, !n && s.heatEmpty, i === 23 && n > 0 && s.heatNow, hover === i && s.heatHover)}
              style={{ height: n ? `${Math.max(10, (n / peak) * 100)}%` : 2 }}
              initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
              transition={{ ...spring.soft, delay: i * 0.015 }} />
          </span>
        ))}
        {hover !== null && (
          <span className={s.heatTip} aria-hidden="true" style={{ left: `${Math.min(80, Math.max(20, ((hover + 0.5) / hourly.length) * 100))}%` }}>
            <strong>{plural(hourly[hover] ?? 0)}</strong> {when(hover)}
          </span>
        )}
      </div>
      <div className={s.heatAxis} aria-hidden="true"><span>24 h ago</span><span>now</span></div>
    </figure>
  );
}

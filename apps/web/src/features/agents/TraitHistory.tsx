import type { AgentDepthView } from '@shillex/shared';
import { TRAIT_ORDER } from './TraitRadar';
import s from './agents.module.css';

/** One tiny line per trait over time: you can watch an agent turn bitter or reckless. */
export function TraitHistory({ history }: { history: AgentDepthView['traitHistory'] }) {
  if (history.length < 2) return <p className={s.empty}>Not enough history yet. Drift shows after two days.</p>;
  const W = 120, H = 28;
  return (
    <ul className={s.traitHistory} aria-label="Trait history">
      {TRAIT_ORDER.map((k) => {
        const vals = history.map((h) => h.traits[k]);
        // Each line spans at least 0.3 of the 0..1 scale around its own middle: a drift of 0.2 is plain to see, a steady trait stays flat.
        const lo = Math.min(...vals), hi = Math.max(...vals), half = Math.max(0.15, (hi - lo) / 2), mid = (lo + hi) / 2;
        const y = (v: number) => H - 2 - ((v - (mid - half)) / (2 * half)) * (H - 4);
        const pts = vals.map((v, i) => `${+((i / (vals.length - 1)) * W).toFixed(2)},${+y(v).toFixed(2)}`).join(' ');
        const delta = Math.round((vals.at(-1)! - vals[0]!) * 100);
        return (
          <li key={k}>
            <span className={s.traitName}>{k}</span>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.spark} aria-hidden="true">
              <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className={delta > 0 ? s.up : delta < 0 ? s.down : s.muted}>
              {delta > 0 ? '+' : delta < 0 ? '−' : '±'}{Math.abs(delta)}<span className="sr-only"> points since {history[0]!.day}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

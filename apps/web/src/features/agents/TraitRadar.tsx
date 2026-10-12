import type { TraitName, TraitScores } from '@shillex/shared';
import s from './agents.module.css';

type Traits = TraitScores;
export const TRAIT_ORDER: TraitName[] = ['risk', 'chattiness', 'loyalty', 'pettiness', 'greed', 'humor', 'curiosity'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => Math.round(clamp01(v) * 100);
/** Axis i's angle: the first straight up, then clockwise. */
const angle = (i: number) => -Math.PI / 2 + (i / TRAIT_ORDER.length) * Math.PI * 2;

/** Points of the radar polygon, first axis straight up, clockwise. */
export function radarPoints(t: Traits, r: number, cx: number, cy: number): string {
  return TRAIT_ORDER.map((k, i) => {
    const a = angle(i), v = clamp01(t[k]);
    return `${+(cx + Math.cos(a) * r * v).toFixed(4)},${+(cy + Math.sin(a) * r * v).toFixed(4)}`;
  }).join(' ');
}

/** The word for a trait well below (first) or above (second) the middle. */
const WORDS: Record<TraitName, [string, string]> = {
  risk: ['cautious', 'reckless'], chattiness: ['quiet', 'chatty'], loyalty: ['fickle', 'loyal'], pettiness: ['forgiving', 'petty'],
  greed: ['modest', 'greedy'], humor: ['dry', 'funny'], curiosity: ['incurious', 'curious'],
};

/** Up to three words for the traits furthest from the middle (0.35 or less, 0.65 or more), strongest first: who the agent is, at a glance. */
export function traitWords(t: Traits, n = 3): string[] {
  return TRAIT_ORDER.map((k) => ({ k, d: t[k] - 0.5 }))
    .filter((x) => Math.abs(x.d) >= 0.15 - 1e-9)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, n)
    .map((x) => WORDS[x.k][x.d > 0 ? 1 : 0]);
}

/** Seven axes with each trait's name and value; `compare` (an earlier day) is drawn dashed underneath. */
export function TraitRadar({ traits, size = 260, compare }: { traits: Traits; size?: number; compare?: Traits }) {
  const c = size / 2, r = size / 2 - 42;
  const label = TRAIT_ORDER.map((k) => `${k} ${pct(traits[k])}%`).join(', ');
  const ones = Object.fromEntries(TRAIT_ORDER.map((k) => [k, 1])) as Traits;
  return (
    <svg className={s.radar} viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Traits: ${label}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={radarPoints(ones, r * f, c, c)} className={f === 1 ? s.radarRim : s.radarRing} />)}
      {TRAIT_ORDER.map((k, i) => <line key={k} x1={c} y1={c} x2={c + Math.cos(angle(i)) * r} y2={c + Math.sin(angle(i)) * r} className={s.radarRing} />)}
      {compare && <polygon points={radarPoints(compare, r, c, c)} className={s.radarThen} />}
      <polygon points={radarPoints(traits, r, c, c)} className={s.radarNow} />
      {TRAIT_ORDER.map((k, i) => {
        const v = clamp01(traits[k]);
        return <circle key={k} cx={c + Math.cos(angle(i)) * r * v} cy={c + Math.sin(angle(i)) * r * v} r={2.6} className={s.radarDot} />;
      })}
      {/* Name over value, centred on the axis end; the two bottom labels sit a little lower, clear of the chart. */}
      {TRAIT_ORDER.map((k, i) => {
        const a = angle(i), x = c + Math.cos(a) * (r + 21), y = c + Math.sin(a) * (r + 21), below = Math.sin(a) > 0.3;
        return (
          <text key={k} x={x} y={y + (below ? -2 : -6)} textAnchor="middle" aria-hidden="true">
            <tspan className={s.radarLabel}>{k}</tspan>
            <tspan className={s.radarValue} x={x} dy={12}>{pct(traits[k])}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

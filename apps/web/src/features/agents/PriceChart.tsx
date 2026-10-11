import type { TradeView } from '@shillex/shared';
import s from './agents.module.css';

/** Price per token at each buy or sell (|SOL| ÷ |tokens|), oldest first. Launches are skipped: their SOL includes the launch cost. */
export function pricePoints(trades: TradeView[]) {
  return trades.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.tokens !== 0 && t.sol !== 0)
    .map((t) => ({ t: Date.parse(t.createdAt), price: Number((Math.abs(t.sol) / Math.abs(t.tokens)).toPrecision(6)) }))
    .sort((a, b) => a.t - b.t);
}

export function PriceChart({ trades }: { trades: TradeView[] }) {
  const pts = pricePoints(trades);
  if (pts.length < 2) return <p className={s.muted}>Not enough trades for a chart yet.</p>;
  const W = 600, H = 160, min = Math.min(...pts.map((p) => p.price)), max = Math.max(...pts.map((p) => p.price));
  const x = (i: number) => (i / (pts.length - 1)) * W, y = (p: number) => H - ((p - min) / (max - min || 1)) * (H - 8) - 4;
  const up = pts.at(-1)!.price >= pts[0]!.price;
  const line = pts.map((p, i) => `${x(i)},${y(p.price)}`).join(' ');
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price from ${pts[0]!.price} to ${pts.at(-1)!.price} SOL per token over ${pts.length} trades`}>
      <polygon fill={up ? 'var(--up-soft)' : 'var(--down-soft)'} points={`0,${H} ${line} ${W},${H}`} />
      <polyline fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="2" vectorEffect="non-scaling-stroke" points={line} />
    </svg>
  );
}

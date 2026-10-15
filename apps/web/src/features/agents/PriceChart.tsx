import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { relativeTime, type TradeView } from '@shillex/shared';
import { fmtTiny } from './numbers';
import s from './chart.module.css';

/** Price per token at each buy or sell (|SOL| ÷ |tokens|), oldest first. Launches are skipped: their SOL includes the launch cost. */
export function pricePoints(trades: TradeView[]) {
  return trades.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.tokens !== 0 && t.sol !== 0)
    .map((t) => ({ t: Date.parse(t.createdAt), price: Number((Math.abs(t.sol) / Math.abs(t.tokens)).toPrecision(6)), kind: t.kind }))
    .sort((a, b) => a.t - b.t);
}

/** The element's width in CSS pixels, kept current as it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const H = 300, PAD_T = 16, PAD_B = 28, AXIS_W = 84;

/**
 * An exchange's price chart: time runs left to right up to now, the price holds between trades (a step line), quiet
 * guide lines carry prices at the right, and the pointer reads any moment (a crosshair and the price then).
 */
export function PriceChart({ trades }: { trades: TradeView[] }) {
  const pts = pricePoints(trades);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return <p className={s.empty}>The chart starts at the second trade.</p>;
  const now = Date.now();
  const t0 = pts[0]!.t, t1 = Math.max(now, pts.at(-1)!.t + 1);
  const lo = Math.min(...pts.map((p) => p.price)), hi = Math.max(...pts.map((p) => p.price));
  const span = hi - lo || hi * 0.1 || 1;
  const min = lo - span * 0.12, max = hi + span * 0.12;
  const W = Math.max(0, width - AXIS_W);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (p: number) => PAD_T + (1 - (p - min) / (max - min)) * (H - PAD_T - PAD_B);
  // Step after each trade, then hold the last price to now.
  let d = `M ${x(pts[0]!.t)} ${y(pts[0]!.price)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i]!.t)} V ${y(pts[i]!.price)}`;
  d += ` H ${W}`;
  const area = `${d} V ${H - PAD_B} H ${x(t0)} Z`;
  const up = pts.at(-1)!.price >= pts[0]!.price;
  const tone = up ? 'var(--up)' : 'var(--down)';
  const guides = [0.15, 0.5, 0.85].map((f) => max - f * (max - min));
  const times = [t0, t0 + (t1 - t0) / 2, t1];
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px > W) { setHover(null); return; }
    const t = t0 + (px / W) * (t1 - t0);
    // The trade in force at that moment: the last one at or before it.
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1]!.t <= t) i++;
    setHover(i);
  };
  const h = hover !== null ? pts[hover] : null;
  return (
    <div ref={ref} className={s.chart} style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      role="img" aria-label={`Price from ${fmtTiny(pts[0]!.price)} to ${fmtTiny(pts.at(-1)!.price)} SOL per token over ${pts.length} trades`}>
      {width > 0 && (
        <svg width={width} height={H} aria-hidden="true">
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={tone} stopOpacity="0.22" />
              <stop offset="1" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          {guides.map((g) => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className={s.guide} />)}
          <path d={area} fill="url(#chartFill)" />
          <path d={d} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
          {pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.price)} r={2.5} className={p.kind === 'sell' ? s.sellDot : s.buyDot} />)}
          <circle cx={W} cy={y(pts.at(-1)!.price)} r={4} fill={tone} className={s.lastDot} />
          {h && <line x1={x(h.t)} x2={x(h.t)} y1={PAD_T} y2={H - PAD_B} className={s.cross} />}
          {h && <circle cx={x(h.t)} cy={y(h.price)} r={5} fill="var(--bg)" stroke={tone} strokeWidth={2} />}
        </svg>
      )}
      {guides.map((g) => <span key={g} className={s.priceLabel} style={{ top: y(g) }}>{fmtTiny(g)}</span>)}
      <span className={s.lastLabel} style={{ top: y(pts.at(-1)!.price), background: tone }}>{fmtTiny(pts.at(-1)!.price)}</span>
      <div className={s.times} style={{ width: W }}>{times.map((t, i) => <span key={i}>{i === 2 ? 'now' : `${relativeTime(new Date(t).toISOString())} ago`}</span>)}</div>
      {h && (
        <div className={s.tip} style={{ left: Math.min(Math.max(x(h.t), 70), W - 70), top: Math.max(y(h.price) - 54, 0) }}>
          <b>{fmtTiny(h.price)} SOL</b>
          <span>{h.kind === 'sell' ? 'sell' : 'buy'} · {relativeTime(new Date(h.t).toISOString())} ago</span>
        </div>
      )}
    </div>
  );
}

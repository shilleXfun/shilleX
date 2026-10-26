import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import type { CandlesView, FlowView } from '@shillex/shared';
import { get } from '../../lib/api';
import { cx } from '../../lib/cx';
import { fmtCapSol, fmtTiny } from './numbers';
import s from './candle.module.css';

const STEPS = [
  { s: 0, label: 'Auto' }, { s: 300, label: '5m' }, { s: 900, label: '15m' }, { s: 3600, label: '1h' }, { s: 14400, label: '4h' }, { s: 86400, label: '1D' },
];
const stepLabel = (sec: number) => STEPS.find((x) => x.s === sec)?.label ?? (sec < 3600 ? `${sec / 60}m` : sec < 86400 ? `${sec / 3600}h` : '1D');

/** Candles from `path` (a Shillex coin's own trades, or a real coin's pool through the server). */
export const useCandlesAt = (path: string, interval: number, every = 10_000) => useQuery({
  queryKey: ['agents', 'candles', path, interval],
  queryFn: () => get<CandlesView>(`${path}${interval ? `?interval=${interval}` : ''}`),
  refetchInterval: every, refetchIntervalInBackground: false, staleTime: every / 2,
});
export const useCandles = (mint: string, interval: number) => useCandlesAt(`/coins/${mint}/candles`, interval);

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

/** The value at fraction q (0..1) of a sorted copy of xs. */
const quantile = (xs: number[], q: number) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))]!; };
const AXIS_W = 78, PAD_T = 12, GAP = 10, TIME_H = 22;
const sol = (n: number) => (n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4));
const timeOf = (t: number, step: number) => new Date(t).toLocaleString('en', step >= 86400 ? { month: 'short', day: 'numeric' } : step >= 3600 ? { month: 'short', day: 'numeric', hour: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * An exchange's candlestick chart, drawn here (no chart library): one candle per interval with its wick, buy and sell volume
 * stacked under it, prices at the right, times along the foot, the last price on a dashed line, and a crosshair whose legend
 * reads the candle under the pointer. A single launch spike would flatten everything, so the price scale fits the middle 96%
 * of the candles and clips the rest at the edge.
 */
/** `supply`: the coin's token count; given, the chart reads market cap (price times supply) instead of the price of one token. */
export function CandleChart({ mint, path, supply }: { mint: string; path?: string; supply?: number | null }) {
  const [step, setStep] = useState(0);
  const q = useCandlesAt(path ?? `/coins/${mint}/candles`, step, path ? 60_000 : 10_000);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const H = width < 560 ? 300 : 380;
  const data = q.data;
  const geo = useMemo(() => {
    const k = supply && supply > 0 ? supply : 1;
    const cs = (data?.candles ?? []).map((c) => (k === 1 ? c : { ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
    if (!cs.length || width < 100) return null;
    // The first candles of a bonding curve hold the launch, a move ten times anything after it: once there is history, the
    // scale fits the candles' bodies after it (wicks clip at the edge).
    const scope = cs.length >= 10 ? cs.slice(2) : cs;
    const lo = quantile(scope.map((c) => Math.min(c.o, c.c)), 0.02), hi = quantile(scope.map((c) => Math.max(c.o, c.c)), 0.98);
    const pad = (hi - lo || hi * 0.2 || 1) * 0.08;
    const min = Math.max(0, lo - pad), max = hi + pad;
    const W = width - AXIS_W, volH = Math.round((H - TIME_H) * 0.2), priceH = H - TIME_H - volH - GAP;
    const slot = W / Math.max(cs.length, 24);
    const body = Math.max(1, Math.min(14, slot * 0.68));
    const y = (p: number) => PAD_T + (1 - (Math.min(max, Math.max(min, p)) - min) / (max - min)) * (priceH - PAD_T);
    const vMax = Math.max(quantile(scope.map((c) => c.buy + c.sell), 0.95) * 1.15, 1e-9);
    const vy = (v: number) => Math.min(volH, (v / vMax) * volH);
    const x = (i: number) => W - (cs.length - i - 0.5) * slot;
    return { cs, min, max, W, priceH, volH, slot, body, y, vy, x };
  }, [data, width, H, supply]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(geo.cs.length - 0.5 - (geo.W - px) / geo.slot);
    setHover(px > geo.W || i < 0 || i >= geo.cs.length ? null : i);
  };
  const shown = geo ? geo.cs[hover ?? geo.cs.length - 1] : null;
  const usd = data?.unit === 'USD';
  const fmtV = supply && supply > 0 ? fmtCapSol : fmtTiny;
  const vol = (n: number) => (usd ? `$${n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(0)}` : `${sol(n)} SOL`);
  const last = geo?.cs.at(-1);
  return (
    <div className={s.wrap}>
      <div className={s.bar}>
        <div className={s.steps} role="radiogroup" aria-label="Candle interval">
          {STEPS.map((x) => (
            <button key={x.s} type="button" role="radio" aria-checked={step === x.s} className={s.step} onClick={() => setStep(x.s)}>
              {x.s === 0 && data && step === 0 ? `Auto · ${stepLabel(data.interval)}` : x.label}
            </button>
          ))}
        </div>
        {shown && (
          <dl className={s.legend} aria-live="off">
            <div><dt>O</dt><dd>{fmtV(shown.o)}</dd></div>
            <div><dt>H</dt><dd>{fmtV(shown.h)}</dd></div>
            <div><dt>L</dt><dd>{fmtV(shown.l)}</dd></div>
            <div><dt>C</dt><dd className={shown.c >= shown.o ? s.up : s.down}>{fmtV(shown.c)}</dd></div>
            <div><dt>Vol</dt><dd>{vol(shown.buy + shown.sell)}</dd></div>
            <div className={s.legendTime}>{timeOf(shown.t, data!.interval)}</div>
          </dl>
        )}
      </div>
      <div ref={ref} className={s.chart} style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {!geo ? (q.isPending ? null : <p className={s.empty}>{path ? 'The pool has no candles to show right now.' : 'No trades yet: the chart starts with the first one.'}</p>) : (
          <>
            <svg width={width} height={H} role="img" aria-label={`${supply ? 'Market cap' : 'Price'} in ${stepLabel(data!.interval)} candles, last ${fmtV(last!.c)} ${usd ? 'USD' : 'SOL'}`}>
              {[0.12, 0.38, 0.64, 0.9].map((f) => { const p = geo.max - f * (geo.max - geo.min); const yy = geo.y(p); return <line key={f} x1={0} x2={geo.W} y1={yy} y2={yy} className={s.grid} />; })}
              {geo.cs.map((c, i) => {
                const up = c.c >= c.o, cx0 = geo.x(i);
                const top = geo.y(Math.max(c.o, c.c)), bot = geo.y(Math.min(c.o, c.c));
                const vb = geo.vy(c.buy), vs = geo.vy(c.sell), base = H - TIME_H;
                return (
                  <motion.g key={`${data!.interval}-${c.t}`} className={up ? s.upC : s.downC} style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}
                    initial={reduced ? false : { y: 14, opacity: 0 }} animate={{ y: 0, opacity: hover === null || hover === i ? 1 : 0.55 }} transition={{ delay: reduced ? 0 : Math.min(0.9, i * 0.012), duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
                    <line x1={cx0} x2={cx0} y1={geo.y(c.h)} y2={geo.y(c.l)} className={s.wick} />
                    <rect x={cx0 - geo.body / 2} y={top} width={geo.body} height={Math.max(1, bot - top)} rx={1} />
                    {usd ? <rect x={cx0 - geo.body / 2} y={base - vb} width={geo.body} height={vb} className={up ? s.volBuy : s.volSell} /> : <>
                      <rect x={cx0 - geo.body / 2} y={base - vb - vs} width={geo.body} height={vs} className={s.volSell} />
                      <rect x={cx0 - geo.body / 2} y={base - vb} width={geo.body} height={vb} className={s.volBuy} />
                    </>}
                  </motion.g>
                );
              })}
              <line x1={0} x2={geo.W} y1={geo.y(last!.c)} y2={geo.y(last!.c)} className={cx(s.lastLine, last!.c >= last!.o ? s.upStroke : s.downStroke)} />
              {hover !== null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={0} y2={H - TIME_H} className={s.cross} />}
            </svg>
            {[0.12, 0.38, 0.64, 0.9].map((f) => { const p = geo.max - f * (geo.max - geo.min); return <span key={f} className={s.price} style={{ top: geo.y(p) }}>{fmtV(p)}</span>; })}
            <span className={cx(s.price, s.lastTag, last!.c >= last!.o ? s.upBg : s.downBg)} style={{ top: geo.y(last!.c) }}>{fmtV(last!.c)}</span>
            <div className={s.times} style={{ width: geo.W }}>
              {[0.05, 0.35, 0.65, 0.95].map((f) => { const c = geo.cs[Math.min(geo.cs.length - 1, Math.floor(f * geo.cs.length))]!; return <span key={f}>{timeOf(c.t, data!.interval)}</span>; })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Buyers against sellers over the last hour and day: SOL in each direction as one split bar, with the trade counts. */
export function Pressure({ mint }: { mint: string }) {
  const p = useCandles(mint, 0).data?.pressure;
  if (!p) return null;
  const row = (label: string, f: FlowView) => {
    const total = f.buySol + f.sellSol;
    const buy = total ? f.buySol / total : 0.5;
    return (
      <div className={s.flow}>
        <div className={s.flowHead}><span>{label}</span><span>{total ? `${Math.round(buy * 100)}% buying` : 'no trades'}</span></div>
        <div className={s.flowBar} aria-hidden="true"><i style={{ width: `${buy * 100}%` }} /></div>
        <div className={s.flowFoot}><span className={s.up}>{f.buys} buys · {sol(f.buySol)} SOL</span><span className={s.down}>{f.sells} sells · {sol(f.sellSol)} SOL</span></div>
      </div>
    );
  };
  return <div className={s.flows}>{row('Last hour', p.h1)}{row('Last 24 hours', p.h24)}</div>;
}

/** Who holds the coin, as one split bar: its creator, the next nine biggest holders, and everyone else, as shares of what is held. */
export function HolderSplit({ holders, creatorId }: { holders: { user: { id: string }; tokens: number }[]; creatorId: string }) {
  const total = holders.reduce((n, h) => n + h.tokens, 0);
  if (!total) return null;
  const creator = holders.find((h) => h.user.id === creatorId)?.tokens ?? 0;
  const top = holders.filter((h) => h.user.id !== creatorId).slice(0, 9).reduce((n, h) => n + h.tokens, 0);
  const parts = [
    { label: 'Creator', share: creator / total, cls: s.segCreator },
    { label: 'Next 9 holders', share: top / total, cls: s.segTop },
    { label: `Everyone else (${Math.max(0, holders.length - 10 - (creator ? 0 : -1))})`, share: Math.max(0, 1 - (creator + top) / total), cls: s.segRest },
  ].filter((p) => p.share > 0.0005);
  return (
    <div className={s.split}>
      <div className={s.splitBar} aria-hidden="true">{parts.map((p) => <i key={p.label} className={p.cls} style={{ width: `${p.share * 100}%` }} />)}</div>
      <ul className={s.splitKey}>{parts.map((p) => <li key={p.label}><i className={p.cls} aria-hidden="true" />{p.label}<b>{(p.share * 100).toFixed(1)}%</b></li>)}</ul>
    </div>
  );
}

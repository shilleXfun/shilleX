import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import type { EquityView } from '@shillex/shared';
import { get } from '../../lib/api';
import s from './equity.module.css';

const H = 200, PAD_T = 14, PAD_B = 22, AXIS_W = 70;
const VERB = { buy: 'Bought', sell: 'Sold', launch: 'Launched', claim: 'Claimed fees on' } as const;
const when = (t: number) => new Date(t).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export const useEquity = (username: string) => useQuery({ queryKey: ['agents', 'equity', username], queryFn: () => get<EquityView>(`/agents/${username}/equity`), refetchInterval: 30_000, refetchIntervalInBackground: false, staleTime: 15_000 });

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

/**
 * An agent's net worth over its whole life, the way a fund shows its NAV: the line in green above where it started and red
 * below, the start as a dashed line, and every trade a dot on the curve that names itself under the pointer.
 */
export function EquityChart({ username }: { username: string }) {
  const q = useEquity(username);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const pts = q.data?.points ?? [];
  if (q.data && pts.length < 2) return <p className={s.empty}>No trades yet: its curve starts with the first one.</p>;
  const start = q.data?.start ?? 0;
  const W = Math.max(0, width - AXIS_W);
  // Quiet stretches (the world halted, or the agent idle) longer than GAP_MS take only GAP_MS of width, marked with a break.
  const GAP_MS = 2 * 3_600_000;
  const shift: number[] = [];
  const breaks: number[] = [];
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    const cut = prev && p.t - prev.t > GAP_MS ? p.t - prev.t - GAP_MS : 0;
    shift.push((shift[i - 1] ?? 0) + cut);
    if (cut) breaks.push(i);
  });
  const tAt = (i: number) => pts[i]!.t - shift[i]!;
  const t0 = pts.length ? tAt(0) : 0, t1 = pts.length ? tAt(pts.length - 1) : 1;
  const vals = pts.map((p) => p.sol).concat(start);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || hi * 0.1 || 0.01) * 0.1;
  const min = lo - pad, max = hi + pad;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(tAt(i)).toFixed(1)} ${y(p.sol).toFixed(1)}`).join(' ');
  const last = pts.at(-1);
  const up = (last?.sol ?? 0) >= start;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
    if (px > W || !pts.length) { setHover(null); return; }
    let best = 0, d = Infinity;
    pts.forEach((_, i) => { const dd = Math.abs(x(tAt(i)) - px); if (dd < d) { d = dd; best = i; } });
    setHover(best);
  };
  const h = hover === null ? null : pts[hover]!;
  return (
    <div ref={ref} className={s.chart} style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {width > 0 && pts.length > 1 && (
        <>
          <svg width={width} height={H} role="img" aria-label={`Net worth from ${start.toFixed(3)} to ${last!.sol.toFixed(3)} SOL`}>
            <defs>
              <linearGradient id={`eq-${username}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0.22" />
                <stop offset="1" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1={0} x2={W} y1={y(start)} y2={y(start)} className={s.start} />
            {/* The line draws itself left to right the first time it shows; the area under it fades in behind. */}
            <motion.path d={`${line} L ${x(t1)} ${H - PAD_B} L ${x(t0)} ${H - PAD_B} Z`} fill={`url(#eq-${username})`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.5 }} />
            <motion.path d={line} className={up ? s.lineUp : s.lineDown} initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }} />
            {pts.map((p, i) => (p.kind === 'buy' || p.kind === 'sell' || p.kind === 'launch') && (
              <motion.circle key={i} cx={x(tAt(i))} cy={y(p.sol)} r={hover === i ? 4.5 : 2.6} className={s[p.kind]} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + (x(tAt(i)) / Math.max(1, W)) * 1.1, duration: 0.2 }} />
            ))}
            {h && <line x1={x(tAt(hover!))} x2={x(tAt(hover!))} y1={0} y2={H - PAD_B} className={s.cross} />}
            {breaks.map((i) => <line key={`b${i}`} x1={x(tAt(i)) - x(t0 + GAP_MS) / 2} x2={x(tAt(i)) - x(t0 + GAP_MS) / 2} y1={PAD_T} y2={H - PAD_B} className={s.gap} />)}
          </svg>
          <span className={s.axis} style={{ top: y(start) }}>start {start.toFixed(3)}</span>
          <span className={`${s.axis} ${s.lastTag} ${up ? s.upBg : s.downBg}`} style={{ top: y(last!.sol) }}>{last!.sol.toFixed(3)}</span>
          <div className={s.times} style={{ width: W }}><span>{when(pts[0]!.t)}</span><span>now</span></div>
          {h && (
            <div className={s.tip} style={{ left: Math.min(Math.max(x(tAt(hover!)), 90), W - 90) }}>
              <b>{h.sol.toFixed(4)} SOL</b>
              <span>{h.kind ? `${VERB[h.kind]} ${h.symbol ? `$${h.symbol}` : ''} · ${h.amount?.toFixed(4)} SOL` : 'now'}</span>
              <span>{when(h.t)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

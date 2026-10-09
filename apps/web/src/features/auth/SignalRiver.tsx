import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import s from './auth.module.css';

// Fictional and decorative only: invented tickers, made-up address fragments and generic trench chatter.
const TICKERS = ['GLORP', 'MOONCAT', 'WIFHAT', 'SKRT', 'PNUTZ', 'BONKERS', 'GIGAFROG', 'NOODLE', 'ZOOM', 'HOPIUM', 'SNEK', 'DRIP'];
const LINES = ['who’s watching this one', 'LP burned?', 'dev wallet looks clean', 'chart is a staircase', 'taking profit, not out', 'gm trenches',
  'thesis changed, out', 'aped a small bag', 'CA in bio, trust me', 'holders up 40% today', 'volume waking up', 'still early?', 'bought the dip', 'watching, not buying'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const frag = (r: () => number, n: number) => Array.from({ length: n }, () => B58[Math.floor(r() * B58.length)]).join('');

type Item = { kind: 'chip'; ticker: string; addr: string } | { kind: 'line'; text: string };
function column(seed: number): Item[] {
  const r = rng(seed);
  return Array.from({ length: 16 }, (_, i) => (i % 2 === (seed % 2)
    ? { kind: 'chip', ticker: TICKERS[Math.floor(r() * TICKERS.length)]!, addr: `${frag(r, 4)}…${frag(r, 4)}` }
    : { kind: 'line', text: LINES[Math.floor(r() * LINES.length)]! }));
}
const COLUMNS = Array.from({ length: 7 }, (_, i) => ({ items: column(i * 97 + 13), depth: 0.4 + ((i * 37) % 7) / 10, duration: 38 + ((i * 53) % 24), offset: -((i * 29) % 40) }));

function Column({ items, depth, duration, offset, px, py, still }: (typeof COLUMNS)[number] & { px: ReturnType<typeof useSpring>; py: ReturnType<typeof useSpring>; still: boolean }) {
  const x = useTransform(px, (v) => v * 22 * depth);
  const y = useTransform(py, (v) => v * 14 * depth);
  const list = (copy: string) => items.map((it, i) => it.kind === 'chip'
    ? <span key={copy + i} className={s.riverChip}><span className={s.riverDot} />${it.ticker}<span className={s.riverAddr}>{it.addr}</span></span>
    : <span key={copy + i} className={s.riverLine}>{it.text}</span>);
  return (
    <motion.div className={s.riverCol} style={{ x, y, opacity: 0.25 + depth * 0.35, scale: 0.85 + depth * 0.2 }}>
      {/* Two copies stacked: translating by -50% loops seamlessly. */}
      <div className={still ? s.riverTrack : `${s.riverTrack} ${s.riverMoving}`} style={{ animationDuration: `${duration}s`, animationDelay: `${offset}s` }}>
        {list('a')}{list('b')}
      </div>
    </motion.div>
  );
}

/**
 * Behind the sign-in card: fictional CA chips and shill lines drifting upward in columns, with a parallax tilt that
 * follows the pointer. Pauses while the tab is hidden; static under reduced motion. Purely decorative (aria-hidden).
 */
export function SignalRiver() {
  const reduced = useReducedMotion() ?? false;
  const root = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 60, damping: 20 }), py = useSpring(my, { stiffness: 60, damping: 20 });
  const rotateX = useTransform(py, (v) => v * -4), rotateY = useTransform(px, (v) => v * 5);
  useEffect(() => {
    if (reduced) return;
    const move = (e: PointerEvent) => { mx.set(e.clientX / window.innerWidth - 0.5); my.set(e.clientY / window.innerHeight - 0.5); };
    const vis = () => root.current?.setAttribute('data-paused', String(document.hidden));
    window.addEventListener('pointermove', move);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', vis); };
  }, [reduced, mx, my]);
  return (
    <div ref={root} className={s.river} aria-hidden="true">
      <motion.div className={s.riverTilt} style={{ rotateX, rotateY }}>
        {COLUMNS.map((c, i) => <Column key={i} {...c} px={px} py={py} still={reduced} />)}
      </motion.div>
    </div>
  );
}

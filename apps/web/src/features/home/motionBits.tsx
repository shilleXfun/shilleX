import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { motion, useInView, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

/** A headline whose words rise into place one after another, each from behind its own mask. */
export function RiseWords({ text, className, id, delay = 0.08 }: { text: string; className?: string; id?: string; delay?: number }) {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  return (
    <h1 id={id} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
          <motion.span style={{ display: 'inline-block' }} initial={reduced ? false : { y: '105%' }} animate={{ y: 0 }} transition={{ delay: delay + i * 0.07, duration: 0.75, ease: [0.16, 1, 0.3, 1] }}>
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

/** The product window swinging up into place, like a screen being set down on a desk. */
export function SwingIn({ children, delay = 0.35 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div style={{ transformPerspective: 1400, transformOrigin: '50% 100%' }}
      initial={reduced ? false : { opacity: 0, y: 70, rotateX: 18, scale: 0.94 }} animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 90, damping: 18, mass: 0.9 }}>
      {children}
    </motion.div>
  );
}

/** A number that counts up from zero the first time it scrolls into view. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const done = useRef(false);
  useEffect(() => {
    if (reduced || done.current) { setShown(value); return; }
    if (!inView) return;
    done.current = true;
    const t0 = performance.now(), from = 0;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 4);
      setShown(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduced]);
  return <span ref={ref}>{format(shown)}</span>;
}

/** A card that leans toward the pointer, with a soft light following it across the surface. */
export function Tilt({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const rx = useSpring(0, { stiffness: 220, damping: 18 }), ry = useSpring(0, { stiffness: 220, damping: 18 });
  const mx = useMotionValue(50), my = useMotionValue(50);
  const light = useMotionTemplate`radial-gradient(240px circle at ${mx}% ${my}%, rgb(var(--fg-rgb) / 0.07), transparent 70%)`;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 10); rx.set((0.5 - py) * 10);
    mx.set(px * 100); my.set(py * 100);
  };
  const leave = () => { rx.set(0); ry.set(0); };
  return (
    <motion.div className={className} onPointerMove={move} onPointerLeave={leave}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, backgroundImage: reduced ? undefined : light, height: '100%' }}>
      {children}
    </motion.div>
  );
}

/** Children that rise into view one after another when the group first scrolls in. */
export function StaggerIn({ children, className, as = 'ul' }: { children: ReactNode; className?: string; as?: 'ul' | 'div' }) {
  const reduced = useReducedMotion();
  const C = as === 'ul' ? motion.ul : motion.div;
  return (
    <C className={className} initial={reduced ? false : 'hidden'} whileInView="show" viewport={{ once: true, margin: '-12% 0px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}>
      {children}
    </C>
  );
}
export const riseItem = { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 160, damping: 20 } } } as const;

import { useEffect, useRef } from 'react';
import s from './aurora.module.css';

/**
 * The backdrop behind every screen (owner, 2026-10-14: the neuron network read as cheap): near-black with a few large,
 * soft glows of colour that drift on their own, lean toward the pointer and slide as the page scrolls, each by a
 * different amount so they read as layers of light behind frosted glass. Fine grain and a vignette on top. The pointer
 * and scroll only set two CSS variables (one write per frame at most); still under reduced motion. Decorative: aria-hidden.
 */
export function Aurora() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let mx = 0, my = 0, raf = 0;
    const paint = () => {
      raf = 0;
      el.style.setProperty('--mx', mx.toFixed(3));
      el.style.setProperty('--my', my.toFixed(3));
      el.style.setProperty('--sy', Math.min(2, window.scrollY / Math.max(1, window.innerHeight)).toFixed(3));
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const move = (e: PointerEvent) => { mx = e.clientX / window.innerWidth * 2 - 1; my = e.clientY / window.innerHeight * 2 - 1; ask(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('scroll', ask, { passive: true });
    paint();
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('scroll', ask); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={root} className={s.aurora} aria-hidden="true">
      <span className={`${s.glow} ${s.amber}`} />
      <span className={`${s.glow} ${s.teal}`} />
      <span className={`${s.glow} ${s.violet}`} />
      <span className={`${s.glow} ${s.rose}`} />
      <span className={s.grain} />
      <span className={s.vignette} />
    </div>
  );
}

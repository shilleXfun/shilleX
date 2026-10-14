import { useEffect, type RefObject } from 'react';

/**
 * Scroll reveals for a page: every element under `root` matching `selector` starts lowered, blurred and faded, and rises
 * into place the first time it scrolls into view, staggered among its siblings (--i). Elements that load later (queries)
 * are picked up as they appear. The look lives in base.css ([data-reveal]); under reduced motion nothing is hidden.
 */
export function useScrollReveal(root: RefObject<HTMLElement | null>, selector: string) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = ''; io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const tag = () => {
      for (const n of el.querySelectorAll<HTMLElement>(selector)) {
        if (n.dataset.reveal !== undefined) continue;
        // Already on screen when first seen (the top of the page): shown at once, no jump.
        if (n.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
        const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
        n.dataset.reveal = '';
        n.style.setProperty('--i', String(Math.min(i, 6)));
        io.observe(n);
      }
    };
    tag();
    const mo = new MutationObserver(tag);
    mo.observe(el, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [root, selector]);
}

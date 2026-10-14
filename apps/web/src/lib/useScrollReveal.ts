import { useEffect, type RefObject } from 'react';

/**
 * Scroll reveals for a page: every element under `root` matching `selector` starts lowered, blurred and faded, and rises
 * into place the first time it scrolls into view, staggered among its siblings (--i). Elements that load later (queries)
 * are picked up as they appear. The look lives in base.css ([data-reveal]); under reduced motion nothing is hidden.
 */
/** `watch`: re-attach when it changes (the root element itself was swapped). */
export function useScrollReveal(root: RefObject<HTMLElement | null>, selector: string, watch?: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const n = e.target as HTMLElement;
        n.dataset.in = '';
        io.unobserve(n);
        // Once it has landed, the element gets its own transitions back (a card's hover lift must not take a second).
        setTimeout(() => { delete n.dataset.reveal; delete n.dataset.in; n.dataset.shown = ''; n.style.removeProperty('--i'); }, 1700);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const tag = () => {
      for (const n of el.querySelectorAll<HTMLElement>(selector)) {
        if (n.dataset.reveal !== undefined || n.dataset.shown !== undefined) continue;
        // Already on screen when first seen (the top of the page): shown at once, no jump.
        if (n.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
        // Staggered by its place in its row: its own index, or its wrapper's when it is a wrapper's only child (a list item).
        const p = n.parentElement;
        const box = p && p.children.length === 1 && p.parentElement ? p : n;
        const i = box.parentElement ? [...box.parentElement.children].indexOf(box) : 0;
        n.dataset.reveal = '';
        n.style.setProperty('--i', String(Math.min(i, 6)));
        io.observe(n);
      }
    };
    tag();
    const mo = new MutationObserver(tag);
    mo.observe(el, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [root, selector, watch]);
}

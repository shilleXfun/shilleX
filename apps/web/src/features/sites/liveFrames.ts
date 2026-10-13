import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Live site previews are whole pages, so only a few run at once (x-revamp §3): three scrolling previews in posts, and six small
 * still ones (the side column, the gallery). The rest show their still until a slot frees: first come, first served, and a
 * preview gives its slot back the moment it leaves the screen.
 */
export type LiveKind = 'embed' | 'thumb';
const MAX: Record<LiveKind, number> = { embed: 3, thumb: 6 };
const queues: Record<LiveKind, symbol[]> = { embed: [], thumb: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True while this preview may run its page: it wants to (`want`) and holds one of its kind's slots. */
export function useLiveSlot(kind: LiveKind, want: boolean): boolean {
  const [id] = useState(() => Symbol(kind));
  useEffect(() => {
    if (!want) return;
    queues[kind].push(id);
    emit();
    return () => { const q = queues[kind]; const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); emit(); };
  }, [kind, want, id]);
  return useSyncExternalStore(subscribe, () => { const i = queues[kind].indexOf(id); return i >= 0 && i < MAX[kind]; }, () => false);
}

/** `near`: within a screen's reach, worth loading; `inView`: a good part of it is on screen, worth moving. */
export function useVisibility(ref: RefObject<Element | null>): { near: boolean; inView: boolean } {
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const nearBy = new IntersectionObserver(([e]) => setNear(Boolean(e?.isIntersecting)), { rootMargin: '400px 0px' });
    const onScreen = new IntersectionObserver(([e]) => setInView(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    nearBy.observe(el);
    onScreen.observe(el);
    return () => { nearBy.disconnect(); onScreen.disconnect(); };
  }, [ref]);
  return { near, inView };
}

/** The scale that fits a page laid out `virtualWidth` px wide into this element's width. */
export function useFitScale(ref: RefObject<Element | null>, virtualWidth: number): number {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.getBoundingClientRect().width / virtualWidth);
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, virtualWidth]);
  return scale;
}

import { useSyncExternalStore } from 'react';

const lists = new Map<string, MediaQueryList>();
const list = (query: string) => {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  let l = lists.get(query);
  if (!l) { l = window.matchMedia(query); lists.set(query, l); }
  return l;
};

/** Live `matchMedia` result; false where media queries are unavailable (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => { const l = list(query); l?.addEventListener('change', onChange); return () => l?.removeEventListener('change', onChange); },
    () => !!list(query)?.matches,
    () => false,
  );
}

import { useEffect, useRef } from 'react';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Global keyboard shortcuts: single keys (`/`, `n`, `?`) and two-key sequences (`g h`). Ignored while typing in a
 * field and when a modifier is held, so browser and OS shortcuts keep working.
 */
export function useHotkeys(map: Record<string, () => void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    let prefix: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key;
      if (prefix) {
        const fn = ref.current[`${prefix} ${key}`];
        prefix = null;
        if (fn) { e.preventDefault(); fn(); }
        return;
      }
      if (Object.keys(ref.current).some((k) => k.startsWith(`${key} `))) {
        prefix = key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { prefix = null; }, 1200);
        return;
      }
      const fn = ref.current[key];
      if (fn) { e.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (timer) clearTimeout(timer); };
  }, []);
}

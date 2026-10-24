import { useSyncExternalStore } from 'react';

/**
 * The look lab (2026-10-24, lab/launch-look branch): the site in its current look or a whole new one, for the owner to compare
 * on the same live data before anything ships. The look is <html data-look>; each one is a global sheet in lab/styles/
 * scoped to it. `?look=` sets it and it is remembered per browser. The switcher only shows on localhost.
 */
export const LOOKS = [
  { id: 'original', label: 'Current' },
  { id: 'daylight', label: 'Daylight' },
] as const;
export type Look = (typeof LOOKS)[number]['id'];

const KEY = 'shillex-lab-look';
const isLook = (v: unknown): v is Look => LOOKS.some((l) => l.id === v);
export const labOn = ['localhost', '127.0.0.1'].includes(location.hostname);

function first(): Look {
  if (!labOn) return 'original';
  const q = new URLSearchParams(location.search).get('look');
  if (isLook(q)) return q;
  try { const s = localStorage.getItem(KEY); if (isLook(s)) return s; } catch { /* storage blocked */ }
  return 'original';
}

let look: Look = first();
document.documentElement.dataset.look = look;
const subs = new Set<() => void>();

export function setLook(next: Look) {
  look = next;
  document.documentElement.dataset.look = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}

export function useLook(): Look {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => look);
}

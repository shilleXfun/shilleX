import { useSyncExternalStore } from 'react';

/** "Show posts from X" (x-feed §5.7): on unless this device turned it off. Stored per device; missing or blocked storage means on. */
const KEY = 'shillex:x-embeds';
const listeners = new Set<() => void>();

export function xEmbedsOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setXEmbedsOn(on: boolean): void {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* not kept; the choice lasts this page */ }
  listeners.forEach((l) => l());
}
export function useXEmbedsOn(): boolean {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
  }, xEmbedsOn, () => true);
}

import { useSyncExternalStore } from 'react';
import { relativeTime } from '@shillex/shared';

// One clock for every age on the page: it ticks every 30 s while anything shows one, and stops when nothing does.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
function subscribe(fn: () => void) {
  subs.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); subs.forEach((f) => f()); }, 30_000);
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}
const snapshot = () => now;

/** "now", "2m", "3h": a post's age that keeps itself current, so a row that does not re-render still tells the truth. */
export function Ago({ iso }: { iso: string }) {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <time dateTime={iso} title={new Date(iso).toLocaleString()}>{relativeTime(iso, t)}</time>;
}

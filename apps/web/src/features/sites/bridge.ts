import { useEffect, type RefObject } from 'react';
import { get } from '../../lib/api';

/**
 * The bridge between an agent's sandboxed product and Shillex (server sites/data.ts). The page runs with an opaque origin and
 * connect-src 'none', so it cannot fetch anything; it posts { type: 'shillex:get', id, what } to this page, which answers with
 * public, read-only data. Only messages from this very frame's window are answered (its origin is "null" and proves nothing),
 * only for the known kinds, at most 30 a minute; nothing a page sends can make Shillex do anything but read.
 */
const KINDS = new Set(['agent', 'book', 'market', 'posts', 'agents']);
const PER_MINUTE = 30;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

export function useSiteBridge(frame: RefObject<HTMLIFrameElement | null>, slug: string) {
  useEffect(() => {
    let left = PER_MINUTE, resetAt = Date.now() + 60_000;
    const onMessage = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data as { type?: unknown; id?: unknown; what?: unknown } | null;
      if (!m || typeof m !== 'object' || m.type !== 'shillex:get' || typeof m.id !== 'number' || typeof m.what !== 'string' || !KINDS.has(m.what)) return;
      const t = Date.now();
      if (t > resetAt) { left = PER_MINUTE; resetAt = t + 60_000; }
      if (left-- <= 0) return;
      const key = `${slug}:${m.what}`;
      let hit = cache.get(key);
      if (!hit || t - hit.at > 60_000) {
        hit = { at: t, data: get<{ data: unknown }>(`/sites/${encodeURIComponent(slug)}/data/${m.what}`).then((r) => r.data, () => null) };
        cache.set(key, hit);
      }
      const { id, what } = m;
      // The frame's origin is opaque, so '*' is the only target that reaches it; what goes out is public data only.
      void hit.data.then((data) => { if (frame.current?.contentWindow === w) w.postMessage({ type: 'shillex:data', id, what, data }, '*'); });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, slug]);
}

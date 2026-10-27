import { useEffect, type RefObject } from 'react';
import { get } from '../../lib/api';

/**
 * The bridge between an agent's sandboxed product and Shillex (server sites/data.ts). The page runs with an opaque origin and
 * connect-src 'none', so it cannot fetch anything; it posts { type: 'shillex:get', id, what } to this page, which answers with
 * public, read-only data. Only messages from this very frame's window are answered (its origin is "null" and proves nothing),
 * only for the known kinds, at most 30 a minute; nothing a page sends can make Shillex do anything but read.
 */
const KINDS = new Set(['agent', 'book', 'market', 'posts', 'agents', 'coin', 'movers', 'profile']);
/**
 * Per-viewer saved state (bridge v2, 2026-10-27): a page posts { type: 'shillex:save', state } and { type: 'shillex:load', id }; the
 * state is kept here, in this browser's storage under the site's own key, so the sandboxed page never touches storage itself.
 */
const SAVE_MAX = 8_000;
const saveKey = (slug: string) => `shillex:site-state:${slug}`;
const PER_MINUTE = 30;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

export function useSiteBridge(frame: RefObject<HTMLIFrameElement | null>, slug: string) {
  useEffect(() => {
    let left = PER_MINUTE, resetAt = Date.now() + 60_000;
    const onMessage = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data as { type?: unknown; id?: unknown; what?: unknown; state?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      // One budget for every message a page sends (reads, saves, loads): a page cannot hammer this one.
      const t = Date.now();
      if (t > resetAt) { left = PER_MINUTE; resetAt = t + 60_000; }
      if (left-- <= 0) return;
      if (m.type === 'shillex:save') {
        try { const s = JSON.stringify(m.state ?? null); if (s.length <= SAVE_MAX) localStorage.setItem(saveKey(slug), s); } catch { /* storage full or blocked: the page just does not remember */ }
        return;
      }
      if (m.type === 'shillex:load' && typeof m.id === 'number') {
        let state: unknown = null;
        try { state = JSON.parse(localStorage.getItem(saveKey(slug)) ?? 'null'); } catch { state = null; }
        w.postMessage({ type: 'shillex:data', id: m.id, what: 'state', data: state }, '*');
        return;
      }
      if (m.type !== 'shillex:get' || typeof m.id !== 'number' || typeof m.what !== 'string' || !KINDS.has(m.what)) return;
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

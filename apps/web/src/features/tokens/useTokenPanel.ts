import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { isValidSolanaAddress } from '@shillex/shared';

// Module-level so the panel host (a different component) can return focus to the chip that opened it.
let lastTrigger: HTMLElement | null = null;

/** Token side-panel state lives in `?token=<mint>` so the underlying route stays mounted. */
export function useTokenPanel() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('token');
  const mint = raw && isValidSolanaAddress(raw) ? raw : null;
  const openToken = useCallback((m: string, trigger?: HTMLElement | null) => {
    lastTrigger = trigger ?? (document.activeElement as HTMLElement | null);
    setParams((p) => { const n = new URLSearchParams(p); n.set('token', m); return n; }, { preventScrollReset: true });
  }, [setParams]);
  const close = useCallback(() => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete('token'); return n; }, { preventScrollReset: true });
    const t = lastTrigger; lastTrigger = null;
    if (t?.isConnected) requestAnimationFrame(() => t.focus());
  }, [setParams]);
  return { mint, openToken, close };
}

import { useEffect, useId, useRef, useState } from 'react';
import { COPY, abbreviateMint } from '@shillex/shared';
import { Popover } from '../../components/ui/Popover';
import { cx } from '../../lib/cx';
import { useToken } from './tokenCache';
import { useTokenPanel } from './useTokenPanel';
import { TokenAvatar } from './TokenAvatar';
import { TokenPreview } from './TokenPreview';
import s from './tokens.module.css';

/**
 * Inline contract-address chip. Hover (300 ms) or keyboard focus shows a preview; click/Enter opens the token panel.
 * On touch, the first tap shows the preview (with an "Open token panel" button) and a second tap opens the panel.
 */
export function TokenMention({ mint }: { mint: string }) {
  const token = useToken(mint);
  const { openToken } = useTokenPanel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef(false);
  // A press focuses the button before its click; that focus must not open the preview (the click decides).
  const pressing = useRef(false);
  const previewId = useId();
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const later = (fn: () => void, ms: number) => { cancel(); timer.current = setTimeout(fn, ms); };
  useEffect(() => cancel, []);

  if (token.status === 'not_a_token') return <span className={s.plain} title="Not a token mint">{mint}</span>;
  const label = token.status === 'pending' ? 'Loading' : token.symbol ? `$${token.symbol}` : token.status === 'unindexed' ? 'Unindexed mint' : token.status === 'error' ? 'Couldn’t load' : token.name ?? 'Token';
  // The aria-label replaces the visible text, so it must carry the state too, not just the ticker.
  const state = token.status === 'pending' ? '(loading) ' : token.status === 'unindexed' ? '(unindexed mint) ' : token.status === 'error' ? '(couldn’t load) ' : '';
  const a11y = `Token ${token.symbol ? `$${token.symbol} ` : ''}${token.source === 'demo' ? '(demo) ' : ''}${state}${mint}. Open token panel`;
  const show = (v: boolean) => { cancel(); setOpen(v); };

  return (
    <>
      <button ref={ref} type="button" className={cx(s.chip, s[token.status])} aria-label={a11y}
        aria-busy={token.status === 'pending' || undefined} aria-describedby={open ? previewId : undefined} aria-expanded={open}
        onPointerDown={(e) => { touch.current = e.pointerType === 'touch'; pressing.current = true; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(true), 300); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(false), 150); }}
        onFocus={() => { if (pressing.current) pressing.current = false; else show(true); }}
        onBlur={(e) => { pressing.current = false; if (!document.getElementById(previewId)?.contains(e.relatedTarget as Node)) later(() => setOpen(false), 150); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); show(false); } }}
        onClick={(e) => {
          e.stopPropagation(); e.preventDefault();
          pressing.current = false;
          if (touch.current && !open) { show(true); return; }
          show(false); openToken(mint, ref.current);
        }}>
        {token.status === 'pending' ? <span className={s.loadingDot} aria-hidden="true" /> : <TokenAvatar token={token} size={15} />}
        <span className={s.sym}>{label}</span>
        <span className={s.addr} aria-hidden="true">{abbreviateMint(mint)}</span>
        {token.source === 'demo' && <span className={s.demo} aria-hidden="true">{COPY.demoTag}</span>}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => show(false)} id={previewId}
        onPointerEnter={cancel} onPointerLeave={() => later(() => setOpen(false), 150)}>
        <TokenPreview token={token} onOpen={() => { show(false); openToken(mint, ref.current); }} />
      </Popover>
    </>
  );
}

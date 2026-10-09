import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { COPY, abbreviateMint } from '@shillex/shared';
import { Popover } from '../../components/ui/Popover';
import { useInDialog } from '../../components/ui/Dialog';
import { cx } from '../../lib/cx';
import { spring } from '../../lib/motion';
import { useToken } from './tokenCache';
import { isPanelFocusReturn, useTokenPanel } from './useTokenPanel';
import { TokenAvatar } from './TokenAvatar';
import { TokenPreview } from './TokenPreview';
import s from './tokens.module.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Only keyboard-style focus opens the preview: a pointer press is not :focus-visible. (Programmatic focus returns, from
 * the preview or the token panel, are excluded separately since they can be focus-visible after keyboard use.) Fallbacks: if the selector is unsupported, treat the focus as keyboard focus; if the element
 * isn't actually focused (a synthetic focus event, e.g. jsdom's fireEvent.focus), there is no pointer press to exclude.
 */
function isKeyboardFocus(el: HTMLElement): boolean {
  if (document.activeElement !== el) return true;
  try { return el.matches(':focus-visible'); } catch { return true; }
}

/**
 * Inline contract-address chip. Hover (300 ms) or keyboard focus shows a preview; click/Enter opens the token panel.
 * On touch, the first tap shows the preview (with an "Open token panel" button) and a second tap opens the panel.
 * From the chip, Tab/ArrowDown moves into an open preview; leaving it either way (or Esc) returns to the chip.
 */
export function TokenMention({ mint }: { mint: string }) {
  const token = useToken(mint);
  const inDialog = useInDialog();
  const { openToken } = useTokenPanel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef(false); // set per press; consumed by the click that follows it
  const quiet = useRef(false); // our own focus return to the chip must not reopen the preview
  const previewId = useId();
  const reduced = useReducedMotion();
  // Resolved after being seen pending: the colours cross-fade (CSS) and the chip gives a tiny pop.
  const [lastStatus, setLastStatus] = useState(token.status);
  const [pops, setPops] = useState(0);
  if (lastStatus !== token.status) { setLastStatus(token.status); if (lastStatus === 'pending') setPops((n) => n + 1); }
  useEffect(() => { if (pops && ref.current && !reduced) void animate(ref.current, { scale: [1.12, 1] }, spring.bouncy); }, [pops, reduced]);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const later = (fn: () => void, ms: number) => { cancel(); timer.current = setTimeout(fn, ms); };
  useEffect(() => cancel, []);

  if (token.status === 'not_a_token') return <span className={s.plain} title="Not a token mint">{mint}</span>;
  const label = token.status === 'pending' ? 'Loading' : token.symbol ? `$${token.symbol}` : token.status === 'unindexed' ? 'Unindexed mint' : token.status === 'error' ? 'Couldn’t load' : token.name ?? 'Token';
  // The aria-label replaces the visible text, so it must carry the state too, not just the ticker.
  const state = token.status === 'pending' ? '(loading) ' : token.status === 'unindexed' ? '(unindexed mint) ' : token.status === 'error' ? '(couldn’t load) ' : '';
  const a11y = `Token ${token.symbol ? `$${token.symbol} ` : ''}${token.source === 'demo' ? '(demo) ' : ''}${state}${mint}. Open token panel`;
  const show = (v: boolean) => { cancel(); setOpen(v); };
  const focusables = () => [...(document.getElementById(previewId)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const backToChip = () => { show(false); quiet.current = true; ref.current?.focus(); quiet.current = false; };

  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    touch.current = false;
    if (e.key === 'Escape' && open) { e.stopPropagation(); show(false); return; }
    if (open && ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown')) {
      const first = focusables()[0];
      if (first) { e.preventDefault(); cancel(); first.focus(); }
    }
  };
  const onPreviewKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = focusables();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const leave = e.key === 'Escape' || (e.key === 'Tab' && (e.shiftKey ? i <= 0 : i === items.length - 1));
    if (leave) { e.preventDefault(); e.stopPropagation(); backToChip(); }
  };

  const face = (
    <>
      {token.status === 'pending' ? <span className={s.loadingDot} aria-hidden="true" /> : <TokenAvatar token={token} size={15} />}
      <span className={s.sym}>{label}</span>
      <span className={s.addr} aria-hidden="true">{abbreviateMint(mint)}</span>
      {token.source === 'demo' && <span className={s.demo} aria-hidden="true">{COPY.demoTag}</span>}
    </>
  );
  // In a modal the preview and the token panel can't be used (they render behind its top layer): same chip, inert.
  if (inDialog) {
    return (
      <span className={cx(s.chip, s.static, s[token.status])} title={mint} aria-busy={token.status === 'pending' || undefined}>
        {face}<span className="sr-only">{` ${token.source === 'demo' ? '(demo) ' : ''}${mint}`}</span>
      </span>
    );
  }

  return (
    <>
      <button ref={ref} type="button" className={cx(s.chip, s[token.status])} aria-label={a11y}
        aria-busy={token.status === 'pending' || undefined} aria-describedby={open ? previewId : undefined} aria-expanded={open}
        onPointerDown={(e) => { touch.current = e.pointerType === 'touch'; }}
        onPointerCancel={() => { touch.current = false; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(true), 300); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') later(() => setOpen(false), 150); }}
        onFocus={(e) => { if (!quiet.current && !isPanelFocusReturn() && isKeyboardFocus(e.currentTarget)) show(true); }}
        onBlur={(e) => { if (!document.getElementById(previewId)?.contains(e.relatedTarget as Node)) later(() => setOpen(false), 150); }}
        onKeyDown={onChipKey}
        onClick={(e) => {
          e.stopPropagation(); e.preventDefault();
          const wasTouch = touch.current; touch.current = false;
          if (wasTouch && !open) { show(true); return; }
          show(false); openToken(mint, ref.current);
        }}>
        {face}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => show(false)} id={previewId}
        onPointerEnter={cancel} onPointerLeave={() => later(() => setOpen(false), 150)}>
        <div onKeyDown={onPreviewKey}>
          <TokenPreview token={token} onOpen={() => { show(false); openToken(mint, ref.current); }} />
        </div>
      </Popover>
    </>
  );
}

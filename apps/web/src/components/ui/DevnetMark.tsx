import { useId, useRef, useState } from 'react';
import { Popover } from './Popover';
import s from './ui.module.css';

/** When Shillex moved to mainnet: the money before it was devnet test SOL. */
export const MAINNET_SINCE = 'October 28, 2026';

/**
 * The yellow "?" beside devnet history (owner, 2026-10-28): coins, trades and balances from before the move to mainnet stay
 * on the site, and this says what they were. Hover or focus opens it; a tap toggles it.
 */
export function DevnetMark({ what = 'these coins and trades' }: { what?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <button ref={ref} type="button" className={s.devnetMark} aria-label="Devnet history: what this means" aria-describedby={open ? id : undefined} aria-expanded={open}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>?</button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} id={id} width={280}>
        <p className={s.devnetTip} role="tooltip" id={id}>
          <strong>Devnet, test money.</strong> Until {MAINNET_SINCE} Shillex ran on Solana devnet, a test network. {what[0]!.toUpperCase() + what.slice(1)} used test SOL that was free and worth nothing. They stay here as history. From that day on, the agents trade real SOL on mainnet.
        </p>
      </Popover>
    </>
  );
}

import { lazy, Suspense, useState } from 'react';
import type { WalletProof, WalletPurpose } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FEATURED } from './wallet/featured';
import { WalletGlyph } from './wallet/WalletGlyph';
import type { WalletPickerProps } from './wallet/WalletPicker';
import type { ChallengeSource } from './wallet/sign';
import s from './wallet/wallet.module.css';

/** Shown when the picker's chunk can't load (a stale tab after a deploy, a dropped connection): a reload fixes both. */
function PickerUnavailable({ open, onClose }: WalletPickerProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Continue with a wallet" className={s.picker}>
      <div className={s.error} role="alert">Couldn’t load the wallet list. Reload the page and try again.</div>
      <p className={s.note}><Button variant="primary" onClick={() => window.location.reload()}>Reload the page</Button></p>
    </Dialog>
  );
}

// The wallet libraries load only when someone opens the picker, so the feed bundle doesn't grow (spec §4).
const WalletPicker = lazy(() => import('./wallet/WalletPicker').catch((e: unknown) => {
  console.warn('[wallet] the picker failed to load', e);
  return { default: PickerUnavailable };
}));

export function WalletButton({ purpose, onProof, label = 'Continue with a wallet', variant = 'primary', size = 'md', disabled, className, challenge }: {
  purpose: WalletPurpose; onProof: (proof: WalletProof) => Promise<void>; label?: string;
  variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; disabled?: boolean; className?: string;
  /** Open agents: a claim signs a challenge from its own route. */
  challenge?: ChallengeSource;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {size === 'md' && <span className={s.trio} aria-hidden="true">{FEATURED.map((f) => <WalletGlyph key={f.name} name={f.name} icon={null} colour={f.colour} small />)}</span>}
        {label}
      </Button>
      {open && <Suspense fallback={null}><WalletPicker open onClose={() => setOpen(false)} purpose={purpose} onProof={onProof} challenge={challenge} /></Suspense>}
    </>
  );
}

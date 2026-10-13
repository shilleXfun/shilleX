import { lazy, Suspense, useState } from 'react';
import type { WalletProof, WalletPurpose } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { FEATURED } from './wallet/featured';
import { WalletGlyph } from './wallet/WalletGlyph';
import s from './wallet/wallet.module.css';

// The wallet libraries load only when someone opens the picker, so the feed bundle doesn't grow (spec §4).
const WalletPicker = lazy(() => import('./wallet/WalletPicker'));

export function WalletButton({ purpose, onProof, label = 'Continue with a wallet', variant = 'primary', size = 'md', disabled, className }: {
  purpose: WalletPurpose; onProof: (proof: WalletProof) => Promise<void>; label?: string;
  variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {size === 'md' && <span className={s.trio} aria-hidden="true">{FEATURED.map((f) => <WalletGlyph key={f.name} name={f.name} icon={null} colour={f.colour} small />)}</span>}
        {label}
      </Button>
      {open && <Suspense fallback={null}><WalletPicker open onClose={() => setOpen(false)} purpose={purpose} onProof={onProof} /></Suspense>}
    </>
  );
}

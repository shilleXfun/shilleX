import { useEffect, useState } from 'react';
import type { Wallet } from '@wallet-standard/base';
import type { WalletProof, WalletPurpose } from '@shillex/shared';
import { ApiError } from '../../../lib/api';
import { Dialog } from '../../../components/ui/Dialog';
import { Spinner } from '../../../components/ui/Spinner';
import { arrange, lastWallet, rememberWallet, useWalletList, type PickerEntry } from './registry';
import { walletProof } from './sign';
import { isMobile, phantomBrowse, registerMobileWalletAdapter, solflareBrowse } from './mobile';
import { WalletGlyph } from './WalletGlyph';
import s from './wallet.module.css';

const TITLES: Record<WalletPurpose, string> = { login: 'Continue with a wallet', reset: 'Sign with your wallet', link: 'Add a wallet', confirm: 'Confirm with a wallet' };

export interface WalletPickerProps { open: boolean; onClose: () => void; purpose: WalletPurpose; onProof: (proof: WalletProof) => Promise<void> }

/** The wallet sheet (spec §4). Loaded lazily by WalletButton, so none of this ships with the feed. */
export default function WalletPicker({ open, onClose, purpose, onProof }: WalletPickerProps) {
  const wallets = useWalletList();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void registerMobileWalletAdapter(); }, []);
  const { recent, featured, others } = arrange(wallets, lastWallet());

  async function pick(w: Wallet) {
    setBusy(w.name); setError(null);
    try {
      const proof = await walletProof(w, purpose);
      rememberWallet(w.name);
      await onProof(proof);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The wallet didn’t sign. Try again, or pick another wallet.');
    } finally { setBusy(null); }
  }

  const row = (e: PickerEntry) => e.wallet ? (
    <li key={e.name}>
      <button type="button" className={s.row} onClick={() => void pick(e.wallet!)} disabled={busy !== null} aria-busy={busy === e.name || undefined}>
        <WalletGlyph name={e.name} icon={e.wallet.icon} colour={e.colour} />
        <span className={s.rowName}>{e.name}</span>
        {busy === e.name ? <Spinner /> : e === recent && <span className={s.rowNote}>Last used</span>}
      </button>
    </li>
  ) : (
    <li key={e.name} className={s.row}>
      <WalletGlyph name={e.name} icon={null} colour={e.colour} />
      <span className={s.rowName}>{e.name}</span>
      <a className={s.install} href={e.install!} target="_blank" rel="noopener noreferrer" aria-label={`Install ${e.name}`}>Install</a>
    </li>
  );

  return (
    <Dialog open={open} onClose={onClose} title={TITLES[purpose]} className={s.picker}>
      <ul className={s.list} aria-label="Wallets">{[...(recent ? [recent] : []), ...featured].map(row)}</ul>
      {others.length > 0 && <>
        <h3 className={s.group}>Other wallets</h3>
        <ul className={s.list} aria-label="Other wallets">{others.map(row)}</ul>
      </>}
      {wallets.length === 0 && isMobile() && (
        <div className={s.mobile}>
          <p className={s.note}>No wallet in this browser. Open Shillex inside your wallet app:</p>
          <a className={s.deep} href={phantomBrowse(window.location.href, window.location.origin)}>Open in Phantom</a>
          <a className={s.deep} href={solflareBrowse(window.location.href, window.location.origin)}>Open in Solflare</a>
        </div>
      )}
      {error && <div className={s.error} role="alert">{error}</div>}
      <p className={s.note}>Signing proves you own the wallet. It costs nothing and moves no funds.</p>
    </Dialog>
  );
}

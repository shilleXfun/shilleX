import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { relativeTime } from '@shillex/shared';
import { fmtSol, useReserves } from './mainnetApi';
import s from './mainnet.module.css';

const explorer = (address: string, network: string | null) =>
  network === 'mainnet' ? `https://solscan.io/account/${address}` : network === 'devnet' ? `https://solscan.io/account/${address}?cluster=devnet` : null;

/** Proof of reserves (mainnet spec §5): what Shillex holds on-chain against what its books owe. */
export function ReservesPage() {
  const q = useReserves();
  if (q.isLoading) return <section className={s.page}><Spinner label="Loading reserves" /></section>;
  if (!q.data) return <EmptyState title="No real SOL here" body="This world runs on devnet: nothing here is real money." />;
  const r = q.data;
  const addr = (a: string | null) => {
    if (!a) return '—';
    const href = explorer(a, r.network);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer"><code>{a}</code></a> : <code>{a}</code>;
  };
  return (
    <section className={s.page} aria-labelledby="reserves-h">
      <h1 id="reserves-h" className={s.h1}>Proof of reserves</h1>
      <p className={s.muted}>{r.mode === 'on' ? 'Real SOL on Solana mainnet.' : 'Rehearsal on Solana devnet: test SOL, no real money.'} Checked every 10 minutes.</p>
      {r.frozen && <p className={s.warn} role="alert">The last check did not pass: trading and deposits are paused while it is reviewed. Withdrawals wait for that review.</p>}
      <dl className={s.grid}>
        <div><dt>Hot vault</dt><dd>{addr(r.hot)}</dd></div>
        <div><dt>Cold wallet</dt><dd>{addr(r.cold)}</dd></div>
        <div><dt>Owed to agents and the house</dt><dd>{fmtSol(r.ledgerTotalSol)}</dd></div>
        <div><dt>Held on-chain</dt><dd>{fmtSol(r.onchainTotalSol)}</dd></div>
        <div><dt>Last check</dt><dd>{r.lastCheckAt ? relativeTime(r.lastCheckAt) : 'none yet'}</dd></div>
        <div><dt>Last passing check</dt><dd>{r.lastPassAt ? relativeTime(r.lastPassAt) : 'none yet'}</dd></div>
      </dl>
    </section>
  );
}

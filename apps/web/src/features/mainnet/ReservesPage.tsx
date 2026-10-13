import { ShieldCheck } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { relativeTime } from '@shillex/shared';
import { fmtSol, useReserves } from './mainnetApi';
import L from '../../components/ui/lumen.module.css';
import s from './mainnet.module.css';

const explorer = (address: string, network: string | null) =>
  network === 'mainnet' ? `https://solscan.io/account/${address}` : network === 'devnet' ? `https://solscan.io/account/${address}?cluster=devnet` : null;

/** Proof of reserves (mainnet spec §5): what Shillex holds on-chain against what its books owe. */
export function ReservesPage() {
  const q = useReserves();
  const r = q.data;
  const addr = (a: string | null) => {
    if (!a || !r) return 'none';
    const href = explorer(a, r.network);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer"><code>{a}</code></a> : <code>{a}</code>;
  };
  return (
    <section aria-labelledby="reserves-h" data-cards>
      <PageHeader title="Proof of reserves" titleId="reserves-h" sub="What Shillex holds on-chain against what it owes, checked every 10 minutes." />
      <div className={L.page}>
        {q.isLoading ? <div className={L.card}><Skeleton h={140} r={14} /></div>
          : !r ? (
            <div className={cx(L.card, L.hero, s.none)}>
              <span className={s.noneIcon} aria-hidden="true"><ShieldCheck size={22} /></span>
              <h2 className={L.bigTitle}>No real SOL here</h2>
              <p className={L.lede}>This world runs on Solana devnet: test SOL with no value. There is nothing to hold in reserve, so there is nothing to prove yet.</p>
            </div>
          ) : (
            <>
              {r.frozen && <p className={s.warn} role="alert">The last check did not pass: trading and deposits are paused while it is reviewed. Withdrawals wait for that review.</p>}
              <div className={cx(L.card, L.hero)}>
                <p className={L.meta}>{r.mode === 'on' ? 'Real SOL on Solana mainnet' : 'Rehearsal on Solana devnet: test SOL, no real money'}</p>
                <dl className={L.stats}>
                  <div className={L.stat}><dt>Owed to agents and the house</dt><dd>{fmtSol(r.ledgerTotalSol)}</dd></div>
                  <div className={L.stat}><dt>Held on-chain</dt><dd>{fmtSol(r.onchainTotalSol)}</dd></div>
                  <div className={L.stat}><dt>Last check</dt><dd>{r.lastCheckAt ? relativeTime(r.lastCheckAt) : 'none yet'}</dd></div>
                  <div className={L.stat}><dt>Last passing check</dt><dd>{r.lastPassAt ? relativeTime(r.lastPassAt) : 'none yet'}</dd></div>
                </dl>
              </div>
              <div className={L.card}>
                <div className={L.head}><h2 className={L.title}>Wallets</h2></div>
                <dl className={s.wallets}>
                  <div><dt>Hot vault</dt><dd>{addr(r.hot)}</dd></div>
                  <div><dt>Cold wallet</dt><dd>{addr(r.cold)}</dd></div>
                </dl>
              </div>
            </>
          )}
      </div>
    </section>
  );
}

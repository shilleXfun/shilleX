import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { adminMoney, fmtSol, useMainnetAdmin } from './mainnetApi';
import s from './mainnet.module.css';

const LEGAL_CONFIRMATION = 'I confirm a lawyer reviewed Shillex mainnet and I accept the risk';

/** /admin's real-SOL section (mainnet spec §7). Renders nothing unless this is a ledger world and the viewer is an admin. */
export function AdminMainnetPanel() {
  const q = useMainnetAdmin(), qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [field, setField] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setField((f) => ({ ...f, [k]: e.target.value }));
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => adminMoney(path, { password, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mainnet'] }),
  });
  if (!q.data) return null;
  const v = q.data, run = (path: string, body: Record<string, unknown> = {}) => act.mutate({ path, body });
  // One press is one action: every money button waits while a request is on its way (the server also refuses repeats).
  const busy = act.isPending;
  return (
    <section className={s.panel} aria-labelledby="mainnet-admin-h">
      <h2 id="mainnet-admin-h" className={s.h2}>Real SOL · {v.mode} · {v.season}</h2>
      <label className={s.field}>Admin password for money actions <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {v.frozen && <p className={s.warn} role="alert">Frozen: {v.frozen} <Button size="sm" disabled={busy} onClick={() => run('unfreeze')}>Unfreeze after a passing check</Button></p>}
      <dl className={s.grid}>
        <div><dt>Books</dt><dd>{fmtSol(v.books.ledgerTotalSol)} {v.books.ok ? '· balanced' : `· ${v.books.mismatches.length} mismatches`}</dd></div>
        <div><dt>House</dt><dd>{fmtSol(v.books.houseSol)}</dd></div>
        <div><dt>Hot vault</dt><dd>{fmtSol(v.hot?.sol)} {v.excessSol > 0 && `· ${fmtSol(v.excessSol)} above the cap`}</dd></div>
        <div><dt>Cold wallet</dt><dd>{fmtSol(v.cold?.sol)}</dd></div>
        <div><dt>Hot covers the 10 largest balances</dt><dd>{v.hotCoversTop10 ? 'yes' : 'no: top it up'}</dd></div>
        <div><dt>Last check</dt><dd>{v.lastReconciliation ? `${v.lastReconciliation.ok === true ? 'passed' : v.lastReconciliation.ok === false ? 'FAILED' : 'unreadable'} · ${v.lastReconciliation.at}` : 'none yet'}</dd></div>
      </dl>
      {v.excessSol > 0 && <Button disabled={busy} onClick={() => run('to-cold', { sol: v.excessSol })}>Move {fmtSol(v.excessSol)} to cold</Button>}

      <h3 className={s.h3}>Withdrawals waiting</h3>
      {v.withdrawals.length === 0 ? <p className={s.muted}>None.</p> : (
        <ul className={s.list}>
          {v.withdrawals.map((w) => (
            <li key={w.id}>
              <span>{fmtSol(w.sol)} → <code>{w.to}</code> · {w.status}{w.reason ? ` · ${w.reason}` : ''}</span>
              {w.status === 'queued' && <Button size="sm" disabled={busy} onClick={() => run(`withdrawals/${w.id}/approve`)}>{`Approve ${w.sol} SOL`}</Button>}
              {w.status === 'sending' && (
                <span className={s.row}>
                  <input aria-label={`Landed signature for ${w.id}`} placeholder={w.signature ?? 'signature, if it landed'} value={field[`sig-${w.id}`] ?? ''} onChange={set(`sig-${w.id}`)} />
                  <Button size="sm" disabled={busy} onClick={() => run(`withdrawals/${w.id}/resolve`, { outcome: 'sent', ...(field[`sig-${w.id}`] ? { signature: field[`sig-${w.id}`] } : {}) })}>It landed</Button>
                  <Button size="sm" disabled={busy} onClick={() => run(`withdrawals/${w.id}/resolve`, { outcome: 'return' })}>Return to the agent</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {v.fromCold.length > 0 && <>
        <h3 className={s.h3}>Transfers from the cold wallet</h3>
        <ul className={s.list}>{v.fromCold.map((t) => <li key={t.signature}><span>{fmtSol(t.sol)} · <code>{t.signature}</code></span><Button size="sm" disabled={busy} onClick={() => run('stake', { signature: t.signature })}>Record as house stake</Button></li>)}</ul>
      </>}
      {v.refundFailures.length > 0 && <>
        <h3 className={s.h3}>Payments that need you (check the chain first)</h3>
        <ul className={s.list}>{v.refundFailures.map((t) => (
          <li key={t.signature}>
            <span>{fmtSol(t.sol)} from <code>{t.from ?? 'unknown'}</code> · {t.outcome}{t.reason ? ` · ${t.reason}` : ''}{t.refundSignature ? ` · refund ${t.refundSignature}` : ''}</span>
            <span className={s.row}>
              <input aria-label={`Refund ${t.signature} to`} placeholder={t.from ?? 'address to refund'} value={field[`to-${t.signature}`] ?? ''} onChange={set(`to-${t.signature}`)} />
              <Button size="sm" disabled={busy} onClick={() => run(`payments/${t.signature}/resolve`, { action: 'refund', ...(field[`to-${t.signature}`] ? { to: field[`to-${t.signature}`] } : {}) })}>{`Refund ${t.sol} SOL`}</Button>
              {t.outcome !== 'review' && <Button size="sm" disabled={busy} onClick={() => run(`payments/${t.signature}/resolve`, { action: 'refunded' })}>It was refunded</Button>}
            </span>
          </li>
        ))}</ul>
      </>}

      {v.ownerOnly && <>
        <h3 className={s.h3}>Your test: open the season</h3>
        <p className={s.muted}>Owner test: only your stake backs the agents and deposits are closed. 1. Send SOL from your cold wallet to the hot vault <code>{v.hot?.address ?? '…'}</code>. 2. Record that transfer as house stake above. 3. Fund a few agents from it: Shillex splits the stake among them on its own books, with no more transfers. The rest sit out until you fund them.</p>
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); run('open', { perAgentSol: Number(field.open), agents: Number(field.openCount || 10) }); }}>
          <label className={s.field}>Agents to fund <input inputMode="numeric" placeholder="10" value={field.openCount ?? ''} onChange={set('openCount')} /></label>
          <label className={s.field}>SOL per agent <input inputMode="decimal" placeholder="0.01" value={field.open ?? ''} onChange={set('open')} /></label>
          <Button type="submit" disabled={busy}>Open the season</Button>
        </form>
      </>}

      <h3 className={s.h3}>House</h3>
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); run('house-withdraw', { sol: Number(field.house) }); }}>
        <label className={s.field}>SOL to the cold wallet <input inputMode="decimal" value={field.house ?? ''} onChange={set('house')} /></label>
        <Button type="submit" disabled={busy}>Withdraw to cold</Button>
      </form>

      <h3 className={s.h3}>Risk notice {v.notice ? `(${v.notice.version})` : '(none yet)'}</h3>
      <form className={s.stack} onSubmit={(e) => { e.preventDefault(); run('notice', { legalPosition: field.legal }); }}>
        <label className={s.field}>Legal position, as the review left it <textarea rows={3} value={field.legal ?? v.notice?.legalPosition ?? ''} onChange={set('legal')} /></label>
        <Button type="submit" disabled={busy}>Publish a new version</Button>
      </form>

      <h3 className={s.h3}>Legal review {v.legalReview ? `· recorded by ${v.legalReview.confirmedBy} (${v.legalReview.reviewer}, ${v.legalReview.date})` : '· not recorded'}</h3>
      <form className={s.stack} onSubmit={(e) => { e.preventDefault(); run('legal-review', { reviewer: field.reviewer, date: field.date, note: field.note, confirm: field.confirm }); }}>
        <label className={s.field}>Reviewer <input value={field.reviewer ?? ''} onChange={set('reviewer')} /></label>
        <label className={s.field}>Date <input type="date" value={field.date ?? ''} onChange={set('date')} /></label>
        <label className={s.field}>Note <textarea rows={2} value={field.note ?? ''} onChange={set('note')} /></label>
        <label className={s.field}>Type exactly: <em>{LEGAL_CONFIRMATION}</em> <input value={field.confirm ?? ''} onChange={set('confirm')} /></label>
        <Button type="submit" variant="primary" disabled={busy}>Record the legal review</Button>
      </form>

      <h3 className={s.h3}>What still blocks MAINNET=on</h3>
      {v.gate.length === 0 ? <p>Nothing: the gate is open.</p> : <ul className={s.list}>{v.gate.map((g) => <li key={g}>{g}</li>)}</ul>}
      {act.error && <p role="alert" className={s.warn}>{errorMessage(act.error)}</p>}
    </section>
  );
}

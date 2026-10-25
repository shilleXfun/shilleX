import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DepositView } from '@shillex/shared';
import { errorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { RiskNotice } from './RiskNotice';
import { PayRequest } from './PayRequest';
import { fmtSol, owner, useMainnetMe } from './mainnetApi';
import s from './mainnet.module.css';
import { LOCALE } from '../../lib/locale';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** The owner's real-SOL controls on their raised agent (mainnet spec §4, §6). Renders nothing outside a custody world. */
export function MoneyPanel() {
  const me = useMainnetMe(), qc = useQueryClient();
  const [sol, setSol] = useState(''), [out, setOut] = useState(''), [request, setRequest] = useState<DepositView | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ['mainnet'] });
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: done });
  const v = me.data;
  if (!v || v.mode === 'off' || !v.agentId) return null;
  if (!v.notice.accepted) return <RiskNotice notice={v.notice} busy={act.isPending} onAccept={() => act.mutate(() => owner.accept(v.notice.version!))} />;
  const busy = act.isPending;
  return (
    <section className={s.stack} aria-labelledby="money-h">
      <h3 id="money-h" className={s.h3}>{v.mode === 'on' ? 'Real SOL' : 'Rehearsal (devnet SOL)'} · {fmtSol(v.balanceSol)}</h3>
      {!v.payout && <p className={s.warn}>Choose a payout wallet in Settings: deposits come from it and withdrawals go back to it.</p>}
      {v.payoutChange && <p className={s.muted}>Your payout wallet changes to {v.payoutChange.address.slice(0, 4)}…{v.payoutChange.address.slice(-4)} on {new Date(v.payoutChange.effectiveAt).toLocaleString(LOCALE)}.</p>}
      {v.notice.excludedUntil ? <p className={s.muted}>Deposits locked until {new Date(v.notice.excludedUntil).toLocaleString(LOCALE)}.</p> : v.payout && (
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); act.mutate(async () => setRequest(await owner.deposit(Number(sol)))); }}>
          <label className={s.field}>SOL to add <input inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value)} /></label>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>Fund</Button>
          {v.roomSol !== null && <span className={s.muted}>up to {fmtSol(v.roomSol)} now</span>}
        </form>
      )}
      {request && <PayRequest deposit={request} />}
      {v.payout && v.balanceSol > 0 && (
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); act.mutate(() => owner.withdraw(out.trim() === 'all' ? 'all' : Number(out))); }}>
          <label className={s.field}>SOL to withdraw <input inputMode="decimal" placeholder="or all" value={out} onChange={(e) => setOut(e.target.value)} /></label>
          <Button type="submit" disabled={busy}>Withdraw</Button>
          <Button type="button" disabled={busy} onClick={() => act.mutate(() => owner.cashOut())}>Cash out everything</Button>
        </form>
      )}
      {v.withdrawals.length > 0 && <ul className={s.list}>{v.withdrawals.map((w) => (
        <li key={w.id}>{fmtSol(w.sol)} · {w.status === 'queued' ? `${ordinal(w.position ?? 1)} in line${w.reason ? ` (${w.reason})` : ''}` : w.status}</li>
      ))}</ul>}
      {!v.notice.excludedUntil && (
        <p className={s.row}><span className={s.muted}>Need a break?</span>
          <Button size="sm" disabled={busy} onClick={() => act.mutate(() => owner.exclude(7))}>Lock deposits for 7 days</Button>
          <Button size="sm" disabled={busy} onClick={() => act.mutate(() => owner.exclude(30))}>30 days</Button></p>
      )}
      {act.error && <p role="alert" className={s.warn}>{errorMessage(act.error)}</p>}
    </section>
  );
}

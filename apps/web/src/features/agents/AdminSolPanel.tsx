import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, get, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import s from './agents.module.css';

type SolAdmin = { on: boolean; ready: boolean; stopped: string | null; wallets: number; funded: number; sol: number; positions: number; openOrders: number };

/** The global stop for real SOL (2026-10-27): every trade halts at once; withdrawals and escrow payouts keep working. */
export function AdminSolPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'sol'], queryFn: ({ signal }) => get<SolAdmin>('/admin/sol', signal), refetchInterval: 15_000 });
  const stop = useMutation({ mutationFn: (stopped: boolean) => post('/admin/sol/stop', { stopped }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sol'] }) });
  if (!q.data) return null;
  const d = q.data;
  return (
    <>
      <h2 className={s.h1}>Real SOL</h2>
      <p>{d.stopped ? `Stopped: ${d.stopped}.` : 'Trading is live.'} {d.wallets} wallets, {d.funded} funded, {d.sol.toFixed(4)} SOL in all, {d.positions} open positions, {d.openOrders} open orders.</p>
      <div className={s.tabsRow}>
        {d.stopped && d.on
          ? <Button loading={stop.isPending} onClick={() => stop.mutate(false)}>Restart real trading</Button>
          : <Button variant="danger" loading={stop.isPending} disabled={!d.on} onClick={() => stop.mutate(true)}>Stop all real trading now</Button>}
      </div>
      {stop.error && <p role="alert" className={s.down}>{errorMessage(stop.error)}</p>}
    </>
  );
}

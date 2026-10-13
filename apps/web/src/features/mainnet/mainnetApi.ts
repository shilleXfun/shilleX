import { useQuery } from '@tanstack/react-query';
import type { DepositView, MainnetAdminView, MainnetMeView, ReservesView, WithdrawalView } from '@shillex/shared';
import { get, post } from '../../lib/api';

export const useReserves = () => useQuery({ queryKey: ['mainnet', 'reserves'], queryFn: () => get<ReservesView>('/mainnet/reserves'), refetchInterval: 60_000 });
/** 404 means no ledger world; 401/403 means not an admin. Either way the panel renders nothing. */
export const useMainnetAdmin = () => useQuery({ queryKey: ['mainnet', 'admin'], queryFn: () => get<MainnetAdminView>('/admin/mainnet/status'), retry: false, refetchInterval: 15_000 });
/** Every admin money action carries the admin password again (spec §7). */
export const adminMoney = <T,>(path: string, body: Record<string, unknown>) => post<T>(`/admin/mainnet/${path}`, body);
export const fmtSol = (n: number | null | undefined) => (n == null ? '—' : `${Number(n.toFixed(6))} SOL`);

/** The signed-in owner's real-SOL state; 404 (no ledger world) or 401 leaves it empty and the money panel renders nothing. */
export const useMainnetMe = () => useQuery({ queryKey: ['mainnet', 'me'], queryFn: () => get<MainnetMeView>('/mainnet/me'), retry: false, refetchInterval: 15_000 });
export const useDeposit = (id: string | null) => useQuery({
  enabled: Boolean(id), queryKey: ['mainnet', 'deposit', id], queryFn: () => get<DepositView>(`/mainnet/deposits/${id}`),
  refetchInterval: (q) => (q.state.data?.status === 'pending' ? 5_000 : false),
});
export const owner = {
  accept: (version: string) => post('/mainnet/notice', { version, adult: true }),
  deposit: (sol: number) => post<DepositView>('/mainnet/deposits', { sol }),
  withdraw: (sol: number | 'all') => post<WithdrawalView>('/mainnet/withdrawals', { sol }),
  cashOut: () => post<{ sold: string[]; withdrawal: WithdrawalView | null }>('/mainnet/cash-out', {}),
  exclude: (days: 7 | 30) => post<{ until: string }>('/mainnet/exclusion', { days }),
};

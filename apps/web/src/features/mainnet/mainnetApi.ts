import { useQuery } from '@tanstack/react-query';
import type { MainnetAdminView, ReservesView } from '@shillex/shared';
import { get, post } from '../../lib/api';

export const useReserves = () => useQuery({ queryKey: ['mainnet', 'reserves'], queryFn: () => get<ReservesView>('/mainnet/reserves'), refetchInterval: 60_000 });
/** 404 means no ledger world; 401/403 means not an admin. Either way the panel renders nothing. */
export const useMainnetAdmin = () => useQuery({ queryKey: ['mainnet', 'admin'], queryFn: () => get<MainnetAdminView>('/admin/mainnet/status'), retry: false, refetchInterval: 15_000 });
/** Every admin money action carries the admin password again (spec §7). */
export const adminMoney = <T,>(path: string, body: Record<string, unknown>) => post<T>(`/admin/mainnet/${path}`, body);
export const fmtSol = (n: number | null | undefined) => (n == null ? '—' : `${Number(n.toFixed(6))} SOL`);

import { useQuery } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { get } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<{ user: MeView | null }>('/auth/me').then((r) => r.user), staleTime: 60_000 });
export function useRequiredMe(): MeView {
  const { data } = useMe();
  if (!data) throw new Error('useRequiredMe used outside RequireAuth');
  return data;
}

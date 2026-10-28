import { useQuery } from '@tanstack/react-query';
import type { AuthMethods, OutsidersStatus, OwnerView } from '@shillex/shared';
import { ApiError, get, post } from '../../lib/api';

/** The join page's count against the cap; null when outside agents are switched off (every /api/v1 route answers 404). */
export function useOutsidersStatus() {
  return useQuery({
    queryKey: ['outsiders', 'status'],
    queryFn: async () => {
      try { return await get<OutsidersStatus>('/v1/agents/status'); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
    staleTime: 30_000,
  });
}

/** Which sign-ins the server offers (X needs X_OAUTH_CLIENT_ID on the server). */
export const useAuthMethods = () => useQuery({ queryKey: ['auth', 'methods'], queryFn: () => get<AuthMethods>('/auth/methods'), staleTime: 300_000 });

/** The owner's dashboard: their agent link key and the agents they linked. Signed-in people only. */
export const useOwner = (enabled = true) => useQuery({ queryKey: ['owner'], queryFn: () => get<OwnerView>('/owner'), enabled, refetchInterval: 30_000 });
export const regenerateLinkKey = () => post<Pick<OwnerView, 'linkKey'>>('/owner/link-key/regenerate');

export { joinInstruction } from './instruction';

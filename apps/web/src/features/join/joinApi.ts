import { useQuery } from '@tanstack/react-query';
import type { ClaimResultView, ClaimView, OutsidersStatus, WalletChallenge, WalletProof } from '@shillex/shared';
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

export function useClaim(code: string) {
  return useQuery({ queryKey: ['outsiders', 'claim', code], queryFn: () => get<ClaimView>(`/v1/agents/claim/${encodeURIComponent(code)}`), retry: false });
}

export const claimByX = (code: string, postUrl: string) => post<ClaimResultView>('/v1/agents/claim/x', { claim_code: code, post_url: postUrl });
export const claimChallenge = (code: string) => (address?: string) =>
  post<WalletChallenge>('/v1/agents/claim/wallet/challenge', address ? { claim_code: code, address } : { claim_code: code });
export const claimByWallet = (proof: WalletProof) => post<ClaimResultView>('/v1/agents/claim/wallet/verify', proof);

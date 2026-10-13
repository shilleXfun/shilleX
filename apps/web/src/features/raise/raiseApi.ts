import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HatchRequestView, NudgeInput, NudgeView, RaisedMine } from '@shillex/shared';
import { del, get, post } from '../../lib/api';

/** The signed-in human's raise state: may they raise, their request, their agent with its private description. Polls fast while hatching. */
export const useMyRaised = (enabled = true) => useQuery({
  enabled, queryKey: ['raised', 'mine'], queryFn: () => get<RaisedMine>('/raised/mine'), retry: false,
  refetchInterval: (q) => { const st = q.state.data?.request?.status; return st === 'queued' || st === 'hatching' ? 3_000 : 30_000; },
  refetchIntervalInBackground: false,
});

export function useRaiseActions() {
  const qc = useQueryClient();
  const settle = () => Promise.all([qc.invalidateQueries({ queryKey: ['raised'] }), qc.invalidateQueries({ queryKey: ['agents'] })]);
  return {
    raise: useMutation({ mutationFn: (b: { handle: string; description: string }) => post<{ request: HatchRequestView }>('/raised', b), onSuccess: settle }),
    nudge: useMutation({ mutationFn: (b: NudgeInput) => post<{ nudge: NudgeView }>('/raised/nudges', b), onSuccess: settle }),
    topUp: useMutation({ mutationFn: () => post<{ sol: number; signature: string }>('/raised/top-up'), onSuccess: settle }),
    release: useMutation({ mutationFn: () => post<{ agentId: string }>('/raised/release'), onSuccess: settle }),
    retire: useMutation({ mutationFn: () => post<{ returnedSol: number }>('/raised/retire'), onSuccess: settle }),
    // The agent's API key: made (or replaced, the old one stopping at once) and answered this once only; or switched off.
    makeKey: useMutation({ mutationFn: () => post<{ api_key: string }>('/raised/key'), onSuccess: settle }),
    dropKey: useMutation({ mutationFn: () => del<{ revoked: number }>('/raised/key'), onSuccess: settle }),
  };
}

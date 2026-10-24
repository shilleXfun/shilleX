import { useQuery } from '@tanstack/react-query';
import type { RealTradeView, TradeView, UserSummary } from '@shillex/shared';
import { get } from '../lib/api';
import { useAgentWorld, useAgentsInfo } from '../features/agents/agentsApi';

/** One line of the tape: who did what with which coin, and where it links. */
export interface TapeItem { id: string; agent: UserSummary; kind: 'buy' | 'sell' | 'launch' | 'claim'; symbol: string; amount: string; big: boolean; to: string; external: boolean; result: number | null; at: string }

/**
 * The world's latest trades for the tape and the pop-ups. In real-coin mode (the default) they are the agents' paper trades
 * of real Solana coins; otherwise the Shillex coins' own trades. One shared query, read every five seconds.
 */
export function useTape(): TapeItem[] {
  const world = useAgentWorld();
  const real = useAgentsInfo().data?.trading !== 'world';
  const q = useQuery({
    enabled: world, queryKey: ['agents', 'tape', real ? 'real' : 'world'], refetchInterval: 5_000, refetchIntervalInBackground: false, staleTime: 2_500,
    queryFn: async (): Promise<TapeItem[]> => real
      ? (await get<{ trades: RealTradeView[] }>('/real/trades?limit=24')).trades.map((t) => ({
          id: t.id, agent: t.agent, kind: t.side, symbol: t.symbol, amount: `$${t.usd >= 100 ? Math.round(t.usd) : t.usd.toFixed(2)}`, big: t.usd >= 100,
          to: `/agents/${t.agent.username}?tab=desk`, external: false, result: t.pnlPct, at: t.at,
        }))
      : (await get<{ trades: TradeView[] }>('/coins/trades?limit=24')).trades.filter((t) => t.agent && t.symbol && ['buy', 'sell', 'launch', 'claim'].includes(t.kind)).map((t) => ({
          id: t.signature + t.kind, agent: t.agent!, kind: t.kind as TapeItem['kind'], symbol: t.symbol!, amount: `${Math.abs(t.sol).toFixed(3)} SOL`, big: t.kind === 'launch' || Math.abs(t.sol) >= 0.01,
          to: t.mint ? `/coins/${t.mint}` : '#', external: false, result: null, at: t.createdAt,
        })),
  });
  return q.data ?? [];
}

import { useQuery } from '@tanstack/react-query';
import type { AgentCard, AgentDetail, AgentGraph, AgentsInfo, AgentsOverview, CoinView, ConversationView, MessageView, TradeView, TurnView, UserSummary } from '@shillex/shared';
import { get } from '../../lib/api';

export type WorldCoinDetail = { coin: CoinView; trades: TradeView[]; holders: { user: UserSummary; tokens: number }[] };
const live = (ms: number) => ({ refetchInterval: ms, refetchIntervalInBackground: false, staleTime: ms / 2 });

export const useAgentsInfo = () => useQuery({ queryKey: ['agents', 'info'], queryFn: () => get<AgentsInfo>('/agents/info'), ...live(15_000) });
export const useBackchannel = () => useQuery({ queryKey: ['agents', 'backchannel'], queryFn: () => get<{ conversations: ConversationView[] }>('/agents/backchannel').then((r) => r.conversations), ...live(5_000) });
export const useBackchannelMessages = (id: string | undefined) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'backchannel', id], queryFn: () => get<{ messages: MessageView[] }>(`/agents/backchannel/${id}/messages`).then((r) => r.messages), ...live(5_000) });
export const useCoins = () => useQuery({ queryKey: ['agents', 'coins'], queryFn: () => get<{ coins: CoinView[] }>('/coins').then((r) => r.coins), ...live(15_000) });
export const useCoin = (mint: string) => useQuery({ queryKey: ['agents', 'coin', mint], queryFn: () => get<WorldCoinDetail>(`/coins/${mint}`), ...live(5_000) });
export const useTrades = () => useQuery({ queryKey: ['agents', 'trades'], queryFn: () => get<{ trades: TradeView[] }>('/coins/trades?limit=40').then((r) => r.trades), ...live(5_000) });
export const useLeaderboard = () => useQuery({ queryKey: ['agents', 'leaderboard'], queryFn: () => get<{ agents: AgentCard[] }>('/leaderboard').then((r) => r.agents), ...live(15_000) });
export const useAgent = (username: string) => useQuery({ queryKey: ['agents', 'agent', username], queryFn: () => get<{ agent: AgentDetail }>(`/agents/${username}`).then((r) => r.agent), ...live(15_000) });
export const useAgentReceipts = (username: string) => useQuery({ queryKey: ['agents', 'receipts', username], queryFn: () => get<{ turns: TurnView[] }>(`/agents/${username}/receipts`).then((r) => r.turns), ...live(10_000) });
export const useReceipt = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'receipt', id], queryFn: () => get<{ turn: TurnView }>(`/receipts/${id}`).then((r) => r.turn), staleTime: Infinity });

/** The agent graph (public). Feeds the backdrop and the Graph page; 404 without an agent world. */
export const useAgentGraph = () => useQuery({ queryKey: ['agents', 'graph'], queryFn: () => get<AgentGraph>('/agents/graph'), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false });

/** Movers, feuds, launches, today's rugs and every mood (public). The Agents page and the World now panel read it. */
export const useOverview = () => useQuery({ queryKey: ['agents', 'overview'], queryFn: () => get<AgentsOverview>('/agents/overview'), refetchInterval: 15_000, refetchIntervalInBackground: false, staleTime: 7_500 });

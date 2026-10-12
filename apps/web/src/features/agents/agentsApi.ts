import { useQuery } from '@tanstack/react-query';
import type { AgentCard, AgentDepthView, AgentDetail, AgentGraph, AgentsInfo, AgentsOverview, CoinView, ConversationView, FactionView, LineageView, MessageView, PaperView, TradeView, TurnView, UserSummary } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';

/** A 404. The agent routes answer it for a missing thing, and for everything where there is no agent world; any other failure is a real one. */
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

export type WorldCoinDetail = { coin: CoinView; trades: TradeView[]; holders: { user: UserSummary; tokens: number }[] };
const live = (ms: number) => ({ refetchInterval: ms, refetchIntervalInBackground: false, staleTime: ms / 2 });

/** 404 means this deployment has no agent world (a demo). The app's retry policy never retries a 4xx, so the shell shows the demo chip and the classic rail at once. */
export const useAgentsInfo = () => useQuery({ queryKey: ['agents', 'info'], queryFn: () => get<AgentsInfo>('/agents/info'), ...live(15_000) });
/** True unless the server says this deployment has no agent world (404 on /agents/info). While it loads, or if it fails any other way, the world is assumed, so the nav does not flicker or vanish on a blip. */
export function useAgentWorld(): boolean {
  const info = useAgentsInfo();
  return !isNotFound(info.error);
}
export const useBackchannel = () => useQuery({ queryKey: ['agents', 'backchannel'], queryFn: () => get<{ conversations: ConversationView[] }>('/agents/backchannel').then((r) => r.conversations), ...live(5_000) });
export const useBackchannelMessages = (id: string | undefined) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'backchannel', id], queryFn: () => get<{ messages: MessageView[] }>(`/agents/backchannel/${id}/messages`).then((r) => r.messages), ...live(5_000) });
/**
 * Every coin. The top bar's ticker (symbols for fresh launches) and the backdrop keep it polled on every page of a world
 * deployment; `enabled: false` only reads what is held. `every` is the poll in ms: observers of one query poll at the fastest.
 */
export const useCoins = (enabled = true, every = 15_000) => useQuery({ enabled, queryKey: ['agents', 'coins'], queryFn: () => get<{ coins: CoinView[] }>('/coins').then((r) => r.coins), ...live(every) });
export const useCoin = (mint: string) => useQuery({ queryKey: ['agents', 'coin', mint], queryFn: () => get<WorldCoinDetail>(`/coins/${mint}`), ...live(5_000) });
export const useLeaderboard = () => useQuery({ queryKey: ['agents', 'leaderboard'], queryFn: () => get<{ agents: AgentCard[] }>('/leaderboard').then((r) => r.agents), ...live(15_000) });
/** The server answers `{ agent: null }` for a user that has no agent row; that is a 404 here, not a page that waits forever. */
export const useAgent = (username: string) => useQuery({
  queryKey: ['agents', 'agent', username],
  queryFn: () => get<{ agent: AgentDetail | null }>(`/agents/${username}`).then((r) => { if (!r.agent) throw new ApiError(404, 'NOT_FOUND', 'No such agent.'); return r.agent; }),
  ...live(15_000),
});
/** Who the agent has become: voice, traits and their drift, mood, reputation, faction, allies, enemies, said vs did (public). */
export const useAgentDepth = (username: string) => useQuery({ queryKey: ['agents', 'depth', username], queryFn: () => get<AgentDepthView>(`/agents/${username}/depth`), ...live(30_000) });
export const useAgentReceipts = (username: string) => useQuery({ queryKey: ['agents', 'receipts', username], queryFn: () => get<{ turns: TurnView[] }>(`/agents/${username}/receipts`).then((r) => r.turns), ...live(10_000) });
export const useReceipt = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'receipt', id], queryFn: () => get<{ turn: TurnView }>(`/receipts/${id}`).then((r) => r.turn), staleTime: Infinity });
/** A line's family tree: who invented it, who spread it, and its reach (public; agents only by construction). Loads only while open. */
export const useLineage = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'lineage', id], queryFn: () => get<LineageView>(`/lineage/${id}`), staleTime: 60_000 });
/** Factions (live, and any split in the last week) with their banner picture and coin (public). The overview names them; this adds what they carry. */
export const useFactions = () => useQuery({ queryKey: ['agents', 'factions'], queryFn: () => get<{ factions: FactionView[] }>('/factions').then((r) => r.factions), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false });

/** The agent graph (public). Feeds the backdrop and the Graph page; 404 without an agent world. */
const graphQuery = { queryKey: ['agents', 'graph'], queryFn: () => get<AgentGraph>('/agents/graph'), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false } as const;
export const useAgentGraph = () => useQuery(graphQuery);
const usernamesOf = (g: AgentGraph) => new Set(g.nodes.map((n) => n.username.toLowerCase()));
/** The lower-cased usernames of the agents in the world, from the same graph; undefined until it loads. A mention of anyone else names a person, whose page needs an account. */
export const useAgentUsernames = () => useQuery({ ...graphQuery, select: usernamesOf }).data;

/** Movers, feuds, launches, today's rugs and every mood (public). The Agents page and the World now panel read it. */
export const useOverview = () => useQuery({ queryKey: ['agents', 'overview'], queryFn: () => get<AgentsOverview>('/agents/overview'), refetchInterval: 15_000, refetchIntervalInBackground: false, staleTime: 7_500, retry: false });

/** The Shillex Times: the latest edition, or one day's (YYYY-MM-DD). null when there is no such edition (404). */
export const usePaper = (day?: string, enabled = true) => useQuery({
  enabled, queryKey: ['papers', day ?? 'latest'],
  queryFn: () => get<PaperView>(day ? `/papers/${day}` : '/papers/latest').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
  staleTime: 60_000, retry: false,
});

import { useQuery } from '@tanstack/react-query';
import type { AgentCard, AgentDepthView, AgentDeskView, CoinThesisView, RealCoinPageView, RealCoinView, AgentDetail, AgentGraph, AgentsInfo, AgentsOverview, CoinView, ConversationView, FactionView, LineageView, MessageView, Page, PaperView, PostView, TradeView, TurnView, UserSummary } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';

/** A 404. The agent routes answer it for a missing thing, and for everything where there is no agent world; any other failure is a real one. */
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** `site`: the product (or faction product, or coin page) this coin belongs to, linked from its page (Phase 4). */
export type WorldCoinDetail = { coin: CoinView; trades: TradeView[]; holders: { user: UserSummary; tokens: number }[]; site?: { slug: string; title: string; kind: string } | null };
const live = (ms: number) => ({ refetchInterval: ms, refetchIntervalInBackground: false, staleTime: ms / 2 });

/** 404 means this deployment has no agent world (a demo). The app's retry policy never retries a 4xx, so the shell shows the demo chip and the classic rail at once. */
export const useAgentsInfo = () => useQuery({ queryKey: ['agents', 'info'], queryFn: () => get<AgentsInfo>('/agents/info'), ...live(15_000) });
/** True when agents trade only real Solana coins on paper (the server's TRADING_MODE, real unless set to world). */
export const useRealMode = () => useAgentsInfo().data?.trading !== 'world';
/** True when an agent's worth is its $1,000 paper book: real-coin mode before real money. On mainnet it is the agent's own SOL wallet. */
export const usePaperBook = () => { const i = useAgentsInfo().data; return i?.trading !== 'world' && i?.realMoney !== true; };
/** True on mainnet, where agents trade real SOL from their own wallets. */
export const useRealMoney = () => useAgentsInfo().data?.realMoney === true;
/** True in hybrid mode: real coins on the paper desks, and Shillex coins launched by dev agents on devnet again. */
export const useHybridMode = () => useAgentsInfo().data?.trading === 'hybrid';
/** True unless the server says this deployment has no agent world (404 on /agents/info). While it loads, or if it fails any other way, the world is assumed, so the nav does not flicker or vanish on a blip. */
export function useAgentWorld(): boolean {
  const info = useAgentsInfo();
  return !isNotFound(info.error);
}
export const useBackchannel = () => useQuery({ queryKey: ['agents', 'backchannel'], queryFn: () => get<{ conversations: ConversationView[] }>('/agents/backchannel').then((r) => r.conversations), ...live(5_000) });
/** One agents-only chat: its messages, oldest first, and what its members pinned (2026-10-28). */
export const useBackchannelMessages = (id: string | undefined) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'backchannel', id], queryFn: () => get<{ messages: MessageView[]; pins?: MessageView[] }>(`/agents/backchannel/${id}/messages`).then((r) => ({ messages: r.messages, pins: r.pins ?? [] })), ...live(5_000) });
/** Words across every agents-only chat. */
export const useBackchannelSearch = (q: string) => useQuery({ enabled: q.trim().length >= 2, queryKey: ['agents', 'backchannel', 'search', q.trim()], queryFn: () => get<{ hits: MessageView[] }>(`/agents/backchannel/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.hits), staleTime: 10_000 });
/**
 * Every coin. The top bar's ticker (symbols for fresh launches) and the backdrop keep it polled on every page of a world
 * deployment; `enabled: false` only reads what is held. `every` is the poll in ms: observers of one query poll at the fastest.
 */
export const useCoins = (enabled = true, every = 15_000) => useQuery({ enabled, queryKey: ['agents', 'coins'], queryFn: () => get<{ coins: CoinView[] }>('/coins').then((r) => r.coins), ...live(every) });
export const useCoin = (mint: string) => useQuery({ queryKey: ['agents', 'coin', mint], queryFn: () => get<WorldCoinDetail>(`/coins/${mint}`), ...live(5_000) });
/** Public posts that name a coin's $SYMBOL, newest first (outside communities; the server shares the list for 15 s). */
export const useCoinPosts = (mint: string) => useQuery({
  queryKey: ['agents', 'coin', mint, 'posts'],
  queryFn: () => get<Page<PostView>>(`/coins/${mint}/posts?limit=10`).then((p) => p.items ?? []),
  ...live(30_000),
});
export const useLeaderboard = () => useQuery({ queryKey: ['agents', 'leaderboard'], queryFn: () => get<{ agents: AgentCard[] }>('/leaderboard').then((r) => r.agents), ...live(15_000) });
/** The server answers `{ agent: null }` for a user that has no agent row; that is a 404 here, not a page that waits forever. */
export const useAgent = (username: string) => useQuery({
  queryKey: ['agents', 'agent', username],
  queryFn: () => get<{ agent: AgentDetail | null }>(`/agents/${username}`).then((r) => { if (!r.agent) throw new ApiError(404, 'NOT_FOUND', 'No such agent.'); return r.agent; }),
  ...live(15_000),
});
/** Who the agent has become: voice, traits and their drift, mood, reputation, faction, allies, enemies, said vs did (public). */
/** The real Solana coins the paper desks watch, live. */
export const useRealMarket = () => useQuery({ queryKey: ['agents', 'real'], queryFn: () => get<{ coins: RealCoinView[] }>('/real/market').then((r) => r.coins), ...live(60_000) });
/** Every agent's written plan on one coin, open ones first. */
/** The newest written plans across every agent (home's desk section). */
export const useLatestTheses = (limit = 6) => useQuery({ queryKey: ['agents', 'theses', 'latest', limit], queryFn: () => get<{ items: CoinThesisView[] }>(`/theses/latest?limit=${limit}`).then((r) => r.items), ...live(30_000) });
export const useCoinTheses = (mint: string) => useQuery({ queryKey: ['agents', 'coin', mint, 'theses'], queryFn: () => get<{ items: CoinThesisView[] }>(`/coins/${mint}/theses`).then((r) => r.items), ...live(30_000) });
/** An agent's desk: today's plan, its theses and its real-market paper book. */
export const useAgentDesk = (username: string) => useQuery({ queryKey: ['agents', 'desk', username], queryFn: () => get<AgentDeskView>(`/agents/${username}/desk`), ...live(30_000) });
export const useAgentDepth = (username: string) => useQuery({ queryKey: ['agents', 'depth', username], queryFn: () => get<AgentDepthView>(`/agents/${username}/depth`), ...live(30_000) });
/** One agent's own trades, newest first (its page draws its wallet's SOL over them). */
export const useAgentTrades = (username: string) => useQuery({
  queryKey: ['agents', 'trades', username],
  queryFn: () => get<{ trades?: TradeView[] }>(`/agents/${username}/trades?limit=50`).then((r) => r.trades ?? []),
  ...live(30_000),
});
export const useAgentReceipts = (username: string) => useQuery({ queryKey: ['agents', 'receipts', username], queryFn: () => get<{ turns: TurnView[] }>(`/agents/${username}/receipts`).then((r) => r.turns), ...live(10_000) });
export const useReceipt = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'receipt', id], queryFn: () => get<{ turn: TurnView }>(`/receipts/${id}`).then((r) => r.turn), staleTime: Infinity });
/** A line's family tree: who invented it, who spread it, and its reach (public; agents only by construction). Loads only while open. */
export const useLineage = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['agents', 'lineage', id], queryFn: () => get<LineageView>(`/lineage/${id}`), staleTime: 60_000 });
/** Factions (live, and any split in the last week) with their banner picture and coin (public). The overview names them; this adds what they carry. */
export const useFactions = () => useQuery({ queryKey: ['agents', 'factions'], queryFn: () => get<{ factions: FactionView[] }>('/factions').then((r) => r.factions), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false });

/** The agent graph (public). Feeds the backdrop and the Graph page; 404 without an agent world. */
export const graphQuery = { queryKey: ['agents', 'graph'], queryFn: () => get<AgentGraph>('/agents/graph'), refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000, retry: false } as const;
/** Every tie with any feeling in it (the graph page's All ties toggle): thousands of lines, so only on request. */
export const graphAllQuery = { ...graphQuery, queryKey: ['agents', 'graph', 'all'], queryFn: () => get<AgentGraph>('/agents/graph?all=1') } as const;
export const useAgentGraph = (all = false) => useQuery<AgentGraph>(all ? graphAllQuery : graphQuery);
const usernamesOf = (g: AgentGraph) => new Set(g.nodes.map((n) => n.username.toLowerCase()));
/** The lower-cased usernames of the agents in the world, from the same graph; undefined until it loads. A mention of anyone else names a person, whose page needs an account. */
export const useAgentUsernames = () => useQuery({ ...graphQuery, select: usernamesOf }).data;

/** Movers, feuds, launches, today's rugs and every mood (public). The Agents page and the World now panel read it. */
export const useOverview = (enabled = true) => useQuery({ enabled, queryKey: ['agents', 'overview'], queryFn: () => get<AgentsOverview>('/agents/overview'), refetchInterval: 15_000, refetchIntervalInBackground: false, staleTime: 7_500, retry: false });

/** The Shillex Times: the latest edition, or one day's (YYYY-MM-DD). null when there is no such edition (404). */
export const usePaper = (day?: string, enabled = true) => useQuery({
  enabled, queryKey: ['papers', day ?? 'latest'],
  queryFn: () => get<PaperView>(day ? `/papers/${day}` : '/papers/latest').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
  staleTime: 60_000, retry: false,
});
/** One real coin's page: its market, the agents holding it on paper, their plans and paper trades. */
export const useRealCoin = (address: string) => useQuery({ queryKey: ['agents', 'real', 'coin', address], queryFn: () => get<RealCoinPageView>(`/real/coins/${address}`), ...live(30_000) });
export const useRealCoinPosts = (address: string) => useQuery({
  queryKey: ['agents', 'real', 'coin', address, 'posts'],
  queryFn: () => get<Page<PostView>>(`/real/coins/${address}/posts?limit=10`).then((p) => p.items ?? []),
  ...live(30_000),
});

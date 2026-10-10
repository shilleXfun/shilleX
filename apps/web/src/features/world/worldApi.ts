import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentCard, AgentDetail, ChannelView, CoinView, CommunitySummary, ConversationView, MessageView, PostView, TradeView, TurnView, UserSummary, WorldInfo } from '@shillex/shared';
import { get } from '../../lib/api';
import { pulseAtmosphere } from '../../components/atmosphere/Atmosphere';

export type WorldCommunity = CommunitySummary & { owner: UserSummary | null; channels: ChannelView[] };
export type WorldCommunityDetail = { community: CommunitySummary; owner: UserSummary | null; channels: ChannelView[]; members: { user: UserSummary; role: string }[] };
export type WorldCoinDetail = { coin: CoinView; trades: TradeView[]; holders: { user: UserSummary; tokens: number }[] };
const live = (ms: number) => ({ refetchInterval: ms, refetchIntervalInBackground: false, staleTime: ms / 2 });

export const useWorldInfo = () => useQuery({ queryKey: ['world', 'info'], queryFn: () => get<WorldInfo>('/world/info'), ...live(15_000) });
export const useWorldFeed = (author?: string) => useQuery({ queryKey: ['world', 'feed', author ?? ''], queryFn: () => get<{ posts: PostView[] }>(`/world/feed${author ? `?author=${encodeURIComponent(author)}` : ''}`).then((r) => r.posts), ...live(5_000) });
export const useWorldThread = (id: string) => useQuery({ queryKey: ['world', 'thread', id], queryFn: () => get<{ post: PostView; ancestors: PostView[]; replies: PostView[] }>(`/world/posts/${id}`), ...live(5_000) });
export const useWorldCommunities = () => useQuery({ queryKey: ['world', 'communities'], queryFn: () => get<{ communities: WorldCommunity[] }>('/world/communities').then((r) => r.communities), ...live(15_000) });
export const useWorldCommunity = (slug: string | undefined) => useQuery({ enabled: Boolean(slug), queryKey: ['world', 'community', slug], queryFn: () => get<WorldCommunityDetail>(`/world/communities/${slug}`), ...live(15_000) });
export const useWorldMessages = (scope: 'channel' | 'conversation', id: string | undefined) => useQuery({ enabled: Boolean(id), queryKey: ['world', 'messages', scope, id], queryFn: () => get<{ messages: MessageView[] }>(`/world/${scope}s/${id}/messages`).then((r) => r.messages), ...live(5_000) });
export const useWorldConversations = () => useQuery({ queryKey: ['world', 'conversations'], queryFn: () => get<{ conversations: ConversationView[] }>('/world/conversations').then((r) => r.conversations), ...live(5_000) });
export const useWorldCoins = () => useQuery({ queryKey: ['world', 'coins'], queryFn: () => get<{ coins: CoinView[] }>('/world/coins').then((r) => r.coins), ...live(15_000) });
export const useWorldCoin = (mint: string) => useQuery({ queryKey: ['world', 'coin', mint], queryFn: () => get<WorldCoinDetail>(`/world/coins/${mint}`), ...live(5_000) });
export const useWorldTrades = () => useQuery({ queryKey: ['world', 'trades'], queryFn: () => get<{ trades: TradeView[] }>('/world/trades?limit=40').then((r) => r.trades), ...live(5_000) });
export const useLeaderboard = () => useQuery({ queryKey: ['world', 'leaderboard'], queryFn: () => get<{ agents: AgentCard[] }>('/world/leaderboard').then((r) => r.agents), ...live(15_000) });
export const useWorldAgent = (username: string) => useQuery({ queryKey: ['world', 'agent', username], queryFn: () => get<{ agent: AgentDetail }>(`/world/agents/${username}`).then((r) => r.agent), ...live(15_000) });
export const useAgentTurns = (username: string) => useQuery({ queryKey: ['world', 'turns', username], queryFn: () => get<{ turns: TurnView[] }>(`/world/agents/${username}/turns`).then((r) => r.turns), ...live(10_000) });
export const useTurn = (id: string | null) => useQuery({ enabled: Boolean(id), queryKey: ['world', 'turn', id], queryFn: () => get<{ turn: TurnView }>(`/world/turns/${id}`).then((r) => r.turn), staleTime: Infinity });

/** Lights the sky when something new arrives (not on first load). */
export function usePulseOnNew(key: string | undefined, hue: 'up' | 'accent' = 'up') {
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (key && prev.current && key !== prev.current) pulseAtmosphere(hue);
    prev.current = key ?? prev.current;
  }, [key, hue]);
}

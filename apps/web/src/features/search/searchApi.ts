import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AgentSearchHit, ChatSearchPage } from '@shillex/shared';
import { get } from '../../lib/api';

const enc = (q: string) => encodeURIComponent(q.trim());

/** Agents by handle, name or bio; the bar's typeahead asks for a few, the Agents tab for more. */
export const useAgentSearch = (q: string, limit = 30) => useQuery<AgentSearchHit[]>({
  enabled: q.trim().length > 0, queryKey: ['search', 'agents', q.trim(), limit],
  queryFn: ({ signal }) => get<{ agents: AgentSearchHit[] }>(`/search/agents?q=${enc(q)}&limit=${limit}`, signal).then((r) => r.agents),
  staleTime: 30_000, placeholderData: keepPreviousData,
});

/** Lines from the agents' chats, newest first, a page at a time. */
export const useChatSearch = (q: string, limit = 20) => useInfiniteQuery({
  enabled: q.trim().length >= 2, queryKey: ['search', 'chats', q.trim(), limit], initialPageParam: null as string | null,
  queryFn: ({ pageParam, signal }) => get<ChatSearchPage>(`/search/chats?q=${enc(q)}&limit=${limit}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
  getNextPageParam: (last) => last.nextCursor, staleTime: 30_000,
});

/** Posts holding every word: a page shaped like the public feed's, for the feed lists. */
export const searchPostsPath = (q: string) => `/search/posts?q=${enc(q)}`;

export const searchHref = (q: string, f?: string) => `/search?q=${enc(q)}${f && f !== 'top' ? `&f=${f}` : ''}`;

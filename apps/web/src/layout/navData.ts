import { useQuery } from '@tanstack/react-query';
import type { CommunitySummary, ConversationView } from '@shillex/shared';
import { get } from '../lib/api';

export function useJoinedCommunities(enabled = true) {
  return useQuery({ enabled, queryKey: ['communities', 'joined'], queryFn: () => get<{ communities: CommunitySummary[] }>('/communities?filter=joined').then((r) => r.communities) });
}
export function useConversations(enabled = true) {
  return useQuery({ enabled, queryKey: ['conversations'], queryFn: () => get<{ conversations: ConversationView[] }>('/conversations').then((r) => r.conversations) });
}

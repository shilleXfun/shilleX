import { useQueryClient, type QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CommunityDetail, CommunitySummary, MeView, MemberView, NotificationView, Page, ScopeRef } from '@shillex/shared';
import { useSocketEvent } from '../lib/socket';
import { useRequiredMe } from '../lib/useMe';
import { activeScope } from '../features/chat/activeScope';
import { toast } from '../components/ui/Toaster';
import { addMentionDot } from './unreadStore';

/** Zeroes a scope's unread count everywhere it is shown (channel list, joined communities, conversations). */
export function clearUnread(qc: QueryClient, scope: ScopeRef) {
  if (scope.type === 'conversation') {
    qc.setQueryData<{ id: string; unread: number }[]>(['conversations'], (l) => l?.map((c) => (c.id === scope.id ? { ...c, unread: 0 } : c)));
    return;
  }
  let communityId: string | null = null; let cleared = 0;
  qc.setQueriesData<CommunityDetail>({ queryKey: ['community'] }, (d) => {
    if (!d?.channels.some((c) => c.id === scope.id)) return d;
    communityId = d.community.id;
    cleared = d.channels.find((c) => c.id === scope.id)!.unread;
    return { ...d, channels: d.channels.map((c) => (c.id === scope.id ? { ...c, unread: 0 } : c)), community: { ...d.community, unread: Math.max(0, d.community.unread - cleared) } };
  });
  if (communityId) qc.setQueryData<CommunitySummary[]>(['communities', 'joined'], (l) => l?.map((c) => (c.id === communityId ? { ...c, unread: Math.max(0, c.unread - cleared) } : c)));
}

/** Global socket → cache wiring: channel unread counts and mention dots, community changes, presence, notifications. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const me = useRequiredMe();

  useSocketEvent('channel:activity', ({ communityId, channelId, authorId, mentions }) => {
    if (authorId === me.id) return;
    const active = activeScope.get();
    if (active?.type === 'channel' && active.id === channelId && document.visibilityState === 'visible') return;
    qc.setQueryData<CommunitySummary[]>(['communities', 'joined'], (l) => l?.map((c) => (c.id === communityId ? { ...c, unread: Math.min(99, c.unread + 1) } : c)));
    qc.setQueriesData<CommunityDetail>({ queryKey: ['community'] }, (d) => d && d.community.id === communityId
      ? { ...d, channels: d.channels.map((c) => (c.id === channelId ? { ...c, unread: Math.min(99, c.unread + 1) } : c)) } : d);
    if (mentions.includes(me.username.toLowerCase())) addMentionDot(communityId);
  });
  useSocketEvent('community:update', ({ communityId }) => {
    void qc.invalidateQueries({ queryKey: ['communities'] });
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'community' && (q.state.data as CommunityDetail | undefined)?.community.id === communityId });
    void qc.invalidateQueries({ queryKey: ['pins'] });
  });
  useSocketEvent('presence', ({ userId, online }) => {
    qc.setQueriesData<{ members: MemberView[] }>({ queryKey: ['members'] }, (d) => d && { members: d.members.map((m) => (m.user.id === userId ? { ...m, online } : m)) });
  });
  useSocketEvent('notification:new', ({ notification, unreadCount }) => {
    qc.setQueryData<MeView | null>(['me'], (m) => m && { ...m, unreadNotifications: unreadCount });
    qc.setQueriesData<InfiniteData<Page<NotificationView>>>({ queryKey: ['notifications'] }, (d) => d && { ...d, pages: d.pages.map((p, i) => (i === 0 ? { ...p, items: [notification, ...p.items] } : p)) });
    if (['mention', 'reply', 'dm', 'call_update', 'join_request'].includes(notification.type)) toast(notification.text);
  });
}

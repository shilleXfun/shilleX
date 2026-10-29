import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Bell, Bot, CheckCheck, Flag, Heart, MessageCircle, Quote, Repeat2, ShieldAlert, Sparkles, TrendingUp, UserPlus, Users } from 'lucide-react';
import { relativeTime, type MeView, type NotificationType, type NotificationView, type Page } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { cx } from '../../lib/cx';
import { dur } from '../../lib/motion';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { PageHeader } from '../../layout/PageHeader';
import { useAgentsInfo } from '../agents/agentsApi';
import { groupNotifications } from './groupNotifications';
import { Meanwhile } from './Meanwhile';
import L from '../../components/ui/lumen.module.css';
import s from './notifications.module.css';

const ICON: Record<NotificationType, typeof Bell> = { reply: MessageCircle, mention: AtSign, follow: UserPlus, reaction: Heart, quote: Quote, repost: Repeat2, dm: MessageCircle, call_update: TrendingUp, token_discussion: TrendingUp, invite: Users, join_request: Users, report_resolved: Flag, agent_moment: Sparkles, sign_in_change: ShieldAlert, agent_linked: Bot, sol_withdrawn: ShieldAlert };
/** Icon tint by kind: token/call activity is teal, everything social is violet. */
const TONE: Partial<Record<NotificationType, string>> = { call_update: s.toneToken, token_discussion: s.toneToken, report_resolved: s.toneWarn, agent_moment: s.toneToken, sign_in_change: s.toneWarn, agent_linked: s.toneToken, sol_withdrawn: s.toneWarn };
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'mentions', label: 'Mentions' }, { id: 'calls', label: 'Calls and tokens' }] as const;
type Filter = (typeof FILTERS)[number]['id'];

export function NotificationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // "Calls and tokens" is the demo's token side; an agent world has no calls, so the tab goes (a stale ?filter=calls falls back to All).
  const world = useAgentsInfo().isSuccess;
  const filters = world ? FILTERS.filter((f) => f.id !== 'calls') : [...FILTERS];
  const filter: Filter = filters.find((f) => f.id === params.get('filter'))?.id ?? 'all';
  const q = useInfiniteQuery({
    queryKey: ['notifications', filter], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => get<Page<NotificationView>>(`/notifications?filter=${filter}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const groups = groupNotifications(items);
  const arrival = useArrivals(groups.map((g) => g.key));
  const unread = items.some((n) => !n.read);
  const markAll = async () => {
    try {
      const r = await post<{ unread: number }>('/notifications/read', {});
      qc.setQueryData<MeView | null>(['me'], (m) => m && { ...m, unreadNotifications: r.unread });
      qc.setQueriesData<InfiniteData<Page<NotificationView>>>({ queryKey: ['notifications'] }, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((n) => ({ ...n, read: true })) })) });
      toast('All caught up', { tone: 'success' });
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <section aria-labelledby="notif-title" data-cards>
      {/* The filter tabs and Mark all read share one bar under the title (owner, 2026-10-29: the button sat squeezed between them). */}
      <PageHeader title="Notifications" titleId="notif-title" sub="Replies, mentions, follows and news about your agents."
        below={<div className={s.bar}>
          <Tabs label="Notification filter" idPrefix="notif" value={filter} onChange={(id) => setParams({ filter: id })} tabs={filters} />
          <Button size="sm" variant="secondary" icon={<CheckCheck size={15} />} className={s.markAll} disabled={!unread || q.isPending} onClick={markAll}>Mark all read</Button>
        </div>} />
      <TabPanel id="notif-panel" aria-labelledby={`notif-${filter}`} value={filter} order={filters.map((f) => f.id)}>
        <div className={L.page}>
        {q.isPending ? <div className={cx(L.card, s.card)} aria-busy="true" aria-label="Loading notifications">{Array.from({ length: 6 }, (_, i) => <div key={i} className={s.row}><Skeleton w={30} h={30} r={15} /><Skeleton w={34} h={34} r={17} /><Skeleton w={`${50 + ((i * 13) % 35)}%`} h={12} /></div>)}</div>
          : q.isError ? <div className={L.card}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
          : !items.length ? <><div className={L.card}><EmptyState icon={<Bell size={26} />} title="You’re all caught up" body="Replies, mentions, follows and moments from agents you follow show up here." /></div>{world && filter === 'all' && <Meanwhile />}</>
          : (
            <div role="list" className={cx(L.card, s.card, s.list)}>
              <AnimatePresence initial={false}>
                {groups.map((n, i) => {
                  const Icon = ICON[n.type] ?? Bell;
                  return (
                    <Arrival key={n.key} as={arrival(n.key, i)} glow={TONE[n.type] === s.toneToken ? 'token' : 'accent'}>
                      <div role="listitem">
                        <Link to={n.href} className={cx(s.row, !n.read && s.unread)}>
                          <span className={cx(s.icon, TONE[n.type])} aria-hidden="true"><Icon size={15} /></span>
                          {n.actors.length > 1
                            ? <span className={s.stack} data-count={Math.min(3, n.actors.length)} aria-hidden="true">{n.actors.slice(0, 3).map((a) => <Avatar key={a.id} src={a.avatarUrl} size={n.actors.length > 2 ? 20 : 24} agent={a.isAgent} />)}</span>
                            : n.actors[0] ? <Avatar src={n.actors[0].avatarUrl} size={34} agent={n.actors[0].isAgent} /> : <span />}
                          <span className={s.text}>
                            <span>{n.text}{!n.read && <span className="sr-only"> (unread)</span>}</span>
                            {n.excerpt && <span className={s.excerpt}>{n.excerpt}</span>}
                          </span>
                          <span className={s.side}>
                            <time className={s.time} dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
                            <AnimatePresence>{!n.read && <motion.span key="dot" className={s.dot} aria-hidden="true" exit={{ scale: 0, opacity: 0, transition: { duration: dur.standard } }} />}</AnimatePresence>
                          </span>
                        </Link>
                      </div>
                    </Arrival>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        {q.hasNextPage && <div className={s.more}><Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older notifications</Button></div>}
        </div>
      </TabPanel>
    </section>
  );
}

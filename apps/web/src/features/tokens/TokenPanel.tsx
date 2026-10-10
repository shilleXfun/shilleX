import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { Bell, BellRing, Copy, ExternalLink, Send, X } from 'lucide-react';
import { COPY, formatAge, formatUsd, type ExternalLink as Ext, type Page, type PostView, type PublicChatMention, type TokenDiscussionStats, type TokenView } from '@shillex/shared';
import { del, errorMessage, get, put } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { useConversations } from '../../layout/LeftNav';
import { Menu } from '../../components/ui/Menu';
import { conversationName } from '../messages/conversationName';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { CountUp } from '../../components/ui/CountUp';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { PostCard } from '../feed/PostCard';
import { PostSkeleton } from '../feed/PostSkeleton';
import { primeTokens, tokenKey } from './tokenCache';
import { TokenAvatar } from './TokenAvatar';
import { copyAddress, provenance } from './TokenPreview';
import { ChatMentionItem } from './ChatMentionItem';
import { MentionHeat } from './MentionHeat';
import s from './panel.module.css';

interface Detail { token: TokenView; links: Ext[]; stats: TokenDiscussionStats }
const TABS = ['posts', 'chat'] as const;
type Tab = (typeof TABS)[number];

/**
 * The token's identity, honest provenance, verified links and its public discussion. Rendered by TokenPanelHost as a
 * right-hand aside (desktop) or inside a bottom-sheet dialog (`asSheet`, mobile; `onHandleDown` starts a drag-to-dismiss).
 */
export function TokenPanel({ mint, onClose, asSheet, onHandleDown }: { mint: string; onClose: () => void; asSheet?: boolean; onHandleDown?: (e: ReactPointerEvent) => void }) {
  const qc = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const me = useRequiredMe();
  const nav = useNavigate();
  const { data: convs } = useConversations();
  const [tab, setTab] = useState<Tab>('posts');
  const d = useQuery({
    queryKey: ['tokenDetail', mint],
    queryFn: async () => { const r = await get<Detail>(`/tokens/${mint}`); qc.setQueryData(tokenKey(mint), r.token); return r; },
    refetchInterval: (q) => (q.state.data?.token.status === 'pending' ? 4000 : false),
  });
  // The host keys the panel by mint, so opening another token starts fresh (tab, lists, focus).
  useEffect(() => { closeRef.current?.focus(); }, []);

  const list = <T,>(kind: Tab) => ({
    queryKey: [kind === 'posts' ? 'tokenPosts' : 'tokenChat', mint], initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => { const p = await get<Page<T>>(`/tokens/${mint}/${kind}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`); primeTokens(qc, p.tokens); return p; },
    getNextPageParam: (l: Page<T>) => l.nextCursor,
  });
  const posts = useInfiniteQuery({ ...list<PostView>('posts'), enabled: tab === 'posts' });
  const chat = useInfiniteQuery({ ...list<PublicChatMention>('chat'), enabled: tab === 'chat' });
  const postItems = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const chatItems = chat.data?.pages.flatMap((p) => p.items) ?? [];
  const postArrival = useArrivals(postItems.map((p) => p.id));
  const chatArrival = useArrivals(chatItems.map((m) => m.message.id));

  async function toggleFollow() {
    if (!d.data) return;
    const on = !d.data.stats.subscribed;
    const set = (v: boolean) => qc.setQueryData<Detail>(['tokenDetail', mint], (x) => x && { ...x, stats: { ...x.stats, subscribed: v } });
    set(on);
    try { await (on ? put(`/tokens/${mint}/subscription`) : del(`/tokens/${mint}/subscription`)); toast(on ? 'You’ll be notified about new public discussion' : 'Stopped following this discussion'); }
    catch (e) { set(!on); toast(errorMessage(e), { tone: 'error' }); }
  }

  const t = d.data?.token;
  const demo = t?.source === 'demo';
  const hasStats = t?.status === 'resolved' || t?.status === 'unindexed';
  return (
    <div role={asSheet ? undefined : 'complementary'} aria-labelledby="token-panel-title" className={s.panel}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      {asSheet && <div className={s.grab} onPointerDown={onHandleDown} aria-hidden="true"><span className={s.handle} /></div>}
      <div className={s.head} onPointerDown={asSheet ? onHandleDown : undefined}>
        {t ? <TokenAvatar token={t} size={44} /> : <Skeleton w={44} h={44} r={22} />}
        <div className={s.identity}>
          <h2 id="token-panel-title" className={s.title}>{t?.name ?? (t?.status === 'unindexed' ? 'Unindexed mint' : t?.status === 'error' ? 'Token unavailable' : 'Token')}</h2>
          <div className={s.tags}>
            {t?.symbol && <span className={s.sym}>${t.symbol}</span>}
            {demo && <Badge tone="demo">{COPY.demoTag}</Badge>}
            {t?.promoted && <Badge tone="promoted" title="Paid placement">{COPY.promoted}</Badge>}
          </div>
        </div>
        <IconButton ref={closeRef} label="Close token panel" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className={s.scroll}>
        <div className={s.addr}><span className={s.addrText}>{mint}</span><IconButton label="Copy full address" onClick={() => copyAddress(mint)}><Copy size={14} /></IconButton></div>
        {d.isPending ? (
          <div className={s.loading} aria-busy="true" aria-label="Loading token data"><Skeleton w="70%" /><Skeleton h={64} r={10} /><Skeleton h={34} r={10} /></div>
        ) : d.isError ? <ErrorState error={d.error} onRetry={() => void d.refetch()} title="Couldn’t load token data" />
          : (
            <>
              <p className={s.prov}><span className={demo ? s.provDemo : t!.status === 'resolved' ? s.provLive : s.provDot} aria-hidden="true" />{provenance(d.data.token)}</p>
              {hasStats && (
                <div className={s.stats}>
                  {/* Market cap is the headline number; age and liquidity sit beside it. */}
                  <div className={s.hero}>
                    <div className={s.statLabel}>Market cap</div>
                    <div className={s.heroValue} title={t!.marketCapUsd === null ? 'Not reported' : undefined}><CountUp value={t!.marketCapUsd} format={formatUsd} /></div>
                  </div>
                  <div className={s.stat}>
                    <div className={s.statLabel}>Liquidity</div>
                    <div className={s.statValue} title={t!.liquidityUsd === null ? 'Not reported' : undefined}><CountUp value={t!.liquidityUsd} format={formatUsd} /></div>
                  </div>
                  <div className={s.stat}>
                    <div className={s.statLabel}>Age</div>
                    <div className={s.statValue} title={t!.pairCreatedAt ? 'Since the trading pair was created' : 'No trading pair found'}>{formatAge(t!.pairCreatedAt)}</div>
                  </div>
                </div>
              )}
              {d.data.links.length > 0 && (
                <>
                  <div className={s.links}>
                    {d.data.links.map((l) => l.url
                      ? <a key={l.id} className={s.link} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<ExternalLink size={12} aria-hidden="true" /></a>
                      : <span key={l.id} className={s.link} aria-disabled="true" title={l.unavailableReason ?? undefined}>{l.label}</span>)}
                  </div>
                  {demo ? <p className={s.linkReason}>{COPY.demoLinkReason}.</p>
                    : d.data.links.some((l) => !l.url) && <p className={s.linkReason}>{d.data.links.find((l) => !l.url)?.unavailableReason}.</p>}
                </>
              )}
              <div className={s.row}>
                <Button size="sm" aria-pressed={d.data.stats.subscribed} className={s.follow} icon={d.data.stats.subscribed ? <BellRing size={14} /> : <Bell size={14} />} onClick={toggleFollow}>
                  {d.data.stats.subscribed ? 'Following discussion' : 'Follow discussion'}
                </Button>
                {/* Shared cards are private messages: they never create public mentions (server rule). */}
                <Menu label="Share to chat" items={[
                  ...(convs ?? []).slice(0, 8).map((c) => ({ label: conversationName(c, me.id), onSelect: () => nav(`/messages/${c.id}?share=${mint}`) })),
                  { label: 'All messages…', onSelect: () => nav(`/messages?share=${mint}`) },
                ]} trigger={(t) => <Button {...t} size="sm" className={s.follow} icon={<Send size={14} />}>Share to chat</Button>} />
              </div>
              <p className={s.note}>{COPY.tokenPanelNote}</p>
              <div className={s.discussion}>
                <h3 className={s.discTitle}>Public discussion</h3>
                {Array.isArray(d.data.stats.hourly) && <MentionHeat hourly={d.data.stats.hourly} />}
                <Tabs label="Discussion" idPrefix="tokdisc" value={tab} onChange={(v) => setTab(v as Tab)}
                  tabs={[{ id: 'posts', label: 'Posts', count: d.data.stats.posts24h }, { id: 'chat', label: 'Community chat', count: d.data.stats.chat24h }]} />
                <p className="sr-only">Counts are public mentions in the last 24 hours.</p>
                <TabPanel id="tokdisc-panel" aria-labelledby={`tokdisc-${tab}`} value={tab} order={[...TABS]}>
                  {tab === 'posts'
                    ? posts.isPending ? <div aria-busy="true" aria-label="Loading posts"><PostSkeleton /><PostSkeleton lines={1} /></div>
                      : posts.isError ? <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
                      : postItems.length === 0 ? <EmptyState title="No public posts mention this exact address yet." />
                      : (
                        <>
                          <AnimatePresence initial={false}>
                            {postItems.map((p, i) => <Arrival key={p.id} as={postArrival(p.id, i)} glow="token"><PostCard post={p} compact /></Arrival>)}
                          </AnimatePresence>
                          {posts.hasNextPage && <div className={s.more}><Button size="sm" variant="ghost" onClick={() => void posts.fetchNextPage()} loading={posts.isFetchingNextPage}>Load more posts</Button></div>}
                        </>
                      )
                    : chat.isPending ? <div aria-busy="true" aria-label="Loading chat"><PostSkeleton /><PostSkeleton lines={1} /></div>
                      : chat.isError ? <ErrorState error={chat.error} onRetry={() => void chat.refetch()} />
                      : chatItems.length === 0 ? <EmptyState title="No public community chat mentions this address yet." />
                      : (
                        <>
                          <AnimatePresence initial={false}>
                            {chatItems.map((m, i) => <Arrival key={m.message.id} as={chatArrival(m.message.id, i)} glow="token"><ChatMentionItem item={m} /></Arrival>)}
                          </AnimatePresence>
                          {chat.hasNextPage && <div className={s.more}><Button size="sm" variant="ghost" onClick={() => void chat.fetchNextPage()} loading={chat.isFetchingNextPage}>Load more messages</Button></div>}
                        </>
                      )}
                </TabPanel>
              </div>
            </>
          )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, Ellipsis, Link2, UserRound, UsersRound, Wallet } from 'lucide-react';
import { COPY, abbreviateMint, type CommunitySummary, type ConversationView, type UserProfile } from '@shillex/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { CountUp } from '../../components/ui/CountUp';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { toast } from '../../components/ui/Toaster';
import { FeedList } from '../feed/FeedList';
import { ReportDialog } from '../feed/ReportDialog';
import { useUserActions } from '../feed/postActions';
import { CommunityCard } from '../communities/CommunitiesPage';
import { copyAddress } from '../tokens/TokenPreview';
import s from './profile.module.css';
import cs from '../communities/communities.module.css';

const TABS = [{ id: 'posts', label: 'Posts' }, { id: 'calls', label: 'Calls' }, { id: 'replies', label: 'Replies' }, { id: 'communities', label: 'Communities' }] as const;
const EMPTY: Record<'posts' | 'calls' | 'replies', { title: string; self: string }> = {
  posts: { title: 'No posts yet', self: 'Your posts will show up here.' },
  calls: { title: 'No calls yet', self: 'Mention a token in a post, then use Update call on it to log watching, bought, taking profit or out.' },
  replies: { title: 'No replies yet', self: 'Your replies will show up here.' },
};
type Tab = (typeof TABS)[number]['id'];
const whole = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString());

export function ProfilePage() {
  const { username = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'posts';
  const q = useQuery({ queryKey: ['profile', username], queryFn: () => get<{ profile: UserProfile }>(`/users/${username}`).then((r) => r.profile) });
  if (q.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading profile">
        <div className={s.banner} />
        <div className={s.top}><span className={s.avatarRing}><Skeleton w={88} h={88} r={44} /></span></div>
        <div className={s.info}><Skeleton w={200} h={30} /><Skeleton w={140} h={12} /><Skeleton w="70%" h={12} /></div>
      </div>
    );
  }
  if (q.isError) {
    return q.error instanceof ApiError && q.error.status === 404
      ? <EmptyState icon={<UserRound size={26} />} title="This account doesn’t exist" body="Check the handle, or search for people from Messages." />
      : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const p = q.data;
  return (
    <section aria-labelledby="profile-name">
      <div className={s.banner} style={{ backgroundImage: p.bannerUrl ? `url(${p.bannerUrl})` : undefined }} />
      <div className={s.top}>
        <span className={s.avatarRing}><Avatar src={p.avatarUrl} size={88} me={p.isSelf} /></span>
        <ProfileActions p={p} />
      </div>
      <div className={s.info}>
        <div className={s.nameRow}>
          <h1 id="profile-name" className={s.name}>{p.displayName}</h1>
          <div className={s.handleRow}>@{p.username}{p.followsYou && <Badge tone="muted">Follows you</Badge>}</div>
        </div>
        {p.isDemo && !p.isSelf && <div className={s.demoNote}><Badge tone="demo">{COPY.demoTag}</Badge>Fictional demo persona, part of the seeded demo world.</div>}
        {p.bio && <p className={s.bio}>{p.bio}</p>}
        <div className={s.meta}>
          {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow"><Link2 size={13} aria-hidden="true" />{l.label}</a>)}
          <span><CalendarDays size={13} aria-hidden="true" />Joined {new Date(p.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className={s.counts}>
          <span className={s.count}><strong className={s.countValue}><CountUp value={p.following} format={whole} /></strong><span className={s.countLabel}>following</span></span>
          <span className={s.count}><strong className={s.countValue}><CountUp value={p.followers} format={whole} /></strong><span className={s.countLabel}>followers</span></span>
        </div>
        {p.wallet && (
          <div className={s.wallet}>
            <div className={s.walletHead}><Wallet size={15} aria-hidden="true" />Wallet</div>
            <div className={s.walletAddr}>{abbreviateMint(p.wallet.address, 6, 6)}<IconButton label="Copy wallet address" onClick={() => copyAddress(p.wallet!.address)}><Copy size={13} /></IconButton></div>
            <div className={s.walletNote}>{COPY.holdingsNote}</div>
          </div>
        )}
      </div>
      <div className={s.tabsWrap}>
        <Tabs label="Profile sections" idPrefix="prof" value={tab} onChange={(id) => setParams({ tab: id })} tabs={[...TABS]} />
      </div>
      <TabPanel id="prof-panel" aria-labelledby={`prof-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        {tab === 'communities' ? <UserCommunities username={p.username} />
          : <>
            {tab === 'calls' && <p className={s.callsNote}>{COPY.callsNote}</p>}
            <FeedList key={tab} queryKey={['userPosts', p.username, tab]} path={`/users/${p.username}/posts?tab=${tab}`}
              empty={<EmptyState title={EMPTY[tab].title} body={p.isSelf ? EMPTY[tab].self : undefined} />} />
          </>}
      </TabPanel>
    </section>
  );
}

function ProfileActions({ p }: { p: UserProfile }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const a = useUserActions(p);
  const [report, setReport] = useState(false);
  if (p.isSelf) return <div className={s.actions}><Button size="sm" onClick={() => nav('/settings')}>Edit profile</Button></div>;
  const message = async () => {
    try { const r = await post<{ conversation: ConversationView }>('/conversations', { kind: 'dm', username: p.username }); await qc.invalidateQueries({ queryKey: ['conversations'] }); nav(`/messages/${r.conversation.id}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <div className={s.actions}>
      {!p.isBlocked && <Button size="sm" onClick={message}>Message</Button>}
      {!p.isBlocked && <Button size="sm" variant={p.isFollowing ? 'secondary' : 'primary'} onClick={() => void a.follow(!p.isFollowing)}>{p.isFollowing ? 'Following' : 'Follow'}</Button>}
      <Menu label="More" items={[
        { label: p.isMuted ? `Unmute @${p.username}` : `Mute @${p.username}`, onSelect: () => void a.mute(!p.isMuted) },
        { label: p.isBlocked ? `Unblock @${p.username}` : `Block @${p.username}`, onSelect: () => void a.block(!p.isBlocked), danger: !p.isBlocked },
        { label: 'Report account', onSelect: () => setReport(true), danger: true },
      ]} trigger={(t) => <IconButton {...t} label="More"><Ellipsis size={18} /></IconButton>} />
      <ReportDialog target={report ? { type: 'user', id: p.id } : null} onClose={() => setReport(false)} />
    </div>
  );
}

function UserCommunities({ username }: { username: string }) {
  const q = useQuery({ queryKey: ['userCommunities', username], queryFn: () => get<{ communities: CommunitySummary[] }>(`/users/${username}/communities`).then((r) => r.communities) });
  const arrival = useArrivals(q.data?.map((c) => c.id) ?? []);
  if (q.isPending) return <div className={s.communityGrid} aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} h={128} r={14} />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<UsersRound size={26} />} title="No public communities" body="Communities this account is in publicly show up here." />;
  return <div className={cs.grid}>{q.data.map((c, i) => <Arrival key={c.id} as={arrival(c.id, i)} className={cs.cardCell}><CommunityCard c={c} /></Arrival>)}</div>;
}

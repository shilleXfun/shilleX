import { useEffect, type CSSProperties } from 'react';
import { Link, NavLink, Navigate, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGroup, motion } from 'motion/react';
import { ArrowLeft, Hash, Info, Lock, MailPlus, MessageSquareText, Pin, Shield, Users } from 'lucide-react';
import { plural, generatedBannerUrl, type CommunityDetail } from '@shillex/shared';
import { ApiError, del, errorMessage, get, post } from '../../lib/api';
import { useRoom } from '../../lib/socket';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { spring } from '../../lib/motion';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { clearMentionDot } from '../../layout/unreadStore';
import { ChannelView } from './ChannelView';
import { ThreadsTab } from './ThreadsTab';
import { PinnedTab } from './PinnedTab';
import { MembersTab } from './MembersTab';
import { AboutTab } from './AboutTab';
import { ModPanel } from './ModPanel';
import s from './communities.module.css';

export function useCommunity(slug: string) {
  return useQuery({ queryKey: ['community', slug], queryFn: () => get<{ community: CommunityDetail }>(`/communities/${slug}`).then((r) => r.community) });
}

const pill = <motion.span layoutId="chan-pill" className={s.chanPill} transition={spring.snappy} />;

export function CommunityPage() {
  const { slug = '', channelId } = useParams();
  const [params] = useSearchParams();
  const tab = params.get('tab');
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useCommunity(slug);
  // On desktop, /c/:slug without a sub-view opens the first channel; on mobile it is the channel index.
  const desktop = useMediaQuery('(min-width: 768px)');
  // While this page animates out, its hooks already see the next location (no ?tab=), so the redirect below must
  // only run while the community index is really the current URL — otherwise leaving a tab bounces into #general.
  const atIndex = !!useMatch('/c/:slug');
  const d = q.data;
  useRoom('community', d?.canRead ? d.community.id : null);
  useEffect(() => { if (d) clearMentionDot(d.community.id); }, [d?.community.id]);

  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['community', slug] }); await qc.invalidateQueries({ queryKey: ['communities'] }); };
  const join = async () => {
    try { const r = await post<{ status: string }>(`/communities/${slug}/join`); toast(r.status === 'pending' ? 'Request sent to moderators' : `Joined ${d!.community.name}`, { tone: 'success' }); await refresh(); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const leave = async () => {
    try { await del(`/communities/${slug}/membership`); toast(`Left ${d!.community.name}`); await refresh(); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };

  if (q.isPending) {
    return (
      <div className={s.page} aria-busy="true" aria-label="Loading community">
        <div className={s.header}><Skeleton w={40} h={40} r={10} /><div style={{ display: 'grid', gap: 6 }}><Skeleton w={180} h={18} /><Skeleton w={120} h={11} /></div></div>
      </div>
    );
  }
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState icon={<Users size={26} />} title="Community not found" body="It may be invite-only, or it no longer exists." action={<Link to="/communities" style={{ color: 'var(--accent-hover)', fontWeight: 600 }}>Browse communities</Link>} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const detail = d!;
  const c = detail.community;
  const isMember = c.myStatus === 'active';
  if (atIndex && detail.canRead && !channelId && !tab && desktop && detail.channels[0]) return <Navigate to={{ pathname: `/c/${slug}/${detail.channels[0].id}`, search: params.toString() }} replace />;
  const channel = detail.channels.find((x) => x.id === channelId);
  const showIndex = !channelId && !tab;
  const sections = [
    { id: 'threads', label: 'Threads', icon: MessageSquareText }, { id: 'pins', label: 'Pinned', icon: Pin },
    { id: 'members', label: 'Members', icon: Users }, { id: 'about', label: 'About', icon: Info },
    ...(detail.isMod ? [{ id: 'mod', label: 'Mod tools', icon: Shield }] : []),
  ];

  return (
    <div className={s.page} data-channel={!!channelId}>
      {/* The community skyline glows in from the right, behind the name. */}
      <header className={s.header} data-banner style={{ '--banner': `url(${detail.bannerUrl ?? generatedBannerUrl(`c${c.id}`)})` } as CSSProperties}>
        {(channelId || tab) && <IconButton label="Back to community" className="mobile-only" onClick={() => nav(`/c/${slug}`)}><ArrowLeft size={18} /></IconButton>}
        <img src={c.avatarUrl} alt="" />
        <div className={s.headText}>
          <h1 className={s.title}><span className={s.titleText}>{c.name}</span>{c.visibility !== 'public' && <Badge tone="muted">{c.visibility === 'private' ? 'Private' : 'Invite-only'}</Badge>}</h1>
          <div className={s.sub}><span>{plural(c.memberCount, 'member')}</span>{c.onlineCount > 0 && <span className={s.online}>{c.onlineCount} online</span>}</div>
        </div>
        {c.myStatus === 'pending' ? <Badge tone="muted">Request pending</Badge>
          : !isMember ? <Button variant="primary" size="sm" onClick={join}>{c.visibility === 'private' ? 'Request to join' : 'Join'}</Button>
          : c.myRole !== 'owner' && <Button size="sm" variant="ghost" onClick={leave}>Leave</Button>}
      </header>
      {!detail.canRead ? (
        <EmptyState icon={<Lock size={26} />} title="This community is private" body={c.description || 'Request to join to see its channels and threads.'} />
      ) : (
        <div className={s.body} data-index={showIndex}>
          <LayoutGroup id={`community-${c.id}`}>
            <nav className={s.side} aria-label={`${c.name} channels`}>
              <div className={s.sideLabel}>Channels</div>
              {detail.channels.map((ch) => (
                <NavLink key={ch.id} to={`/c/${slug}/${ch.id}`} className={s.chan}>
                  {ch.id === channelId && pill}
                  <Hash size={15} aria-hidden="true" />
                  <span className={s.chanText}>
                    <span className={`${s.chanName} ${ch.unread ? s.chanUnread : ''}`}>{ch.name}</span>
                    {ch.topic && <span className={s.chanTopic}>{ch.topic}</span>}
                  </span>
                  {ch.unread > 0 && ch.id !== channelId && <span className={s.unread} aria-label={`${ch.unread} unread`}>{ch.unread > 99 ? '99+' : ch.unread}</span>}
                </NavLink>
              ))}
              <div className={s.sideLabel}>Community</div>
              {sections.map((t) => (
                <Link key={t.id} to={`/c/${slug}?tab=${t.id}`} className={s.chan} aria-current={!channelId && tab === t.id ? 'page' : undefined}>
                  {!channelId && tab === t.id && pill}
                  <t.icon size={15} aria-hidden="true" /><span className={s.chanName}>{t.label}</span>
                </Link>
              ))}
              {detail.isMod && c.visibility === 'invite' && <Link to={`/c/${slug}?tab=mod`} className={s.chan}><MailPlus size={15} aria-hidden="true" /><span className={s.chanName}>Invite people</span></Link>}
            </nav>
          </LayoutGroup>
          <section className={s.main} aria-label={channel ? `#${channel.name}` : sections.find((x) => x.id === tab)?.label ?? 'Community'}>
            {channel ? <ChannelView key={channel.id} detail={detail} channel={channel} />
              : tab === 'threads' ? <ThreadsTab detail={detail} />
              : tab === 'pins' ? <PinnedTab slug={slug} />
              : tab === 'members' ? <MembersTab detail={detail} />
              : tab === 'about' ? <AboutTab detail={detail} />
              : tab === 'mod' && detail.isMod ? <ModPanel detail={detail} />
              : channelId ? <EmptyState icon={<Hash size={26} />} title="Channel not found" body="It may have been removed. Pick another channel." />
              : <EmptyState icon={<Hash size={26} />} title={c.name} body="Pick a channel to join the conversation." />}
          </section>
        </div>
      )}
    </div>
  );
}

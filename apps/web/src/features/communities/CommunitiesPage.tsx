import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, UsersRound } from 'lucide-react';
import { plural, generatedBannerUrl, type CommunitySummary } from '@shillex/shared';
import { get } from '../../lib/api';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { PageHeader } from '../../layout/PageHeader';
import { CreateCommunityDialog } from './CreateCommunityDialog';
import s from './communities.module.css';

export function CommunityCard({ c }: { c: CommunitySummary }) {
  return (
    <Link to={`/c/${c.slug}`} className={s.card}>
      {/* The community's skyline banner (same generated art as its page header). */}
      <span className={s.cardBanner} style={{ backgroundImage: `url(${generatedBannerUrl(`c${c.id}`)})` }} aria-hidden="true" />
      <div className={s.cardTop}>
        <img src={c.avatarUrl} alt="" />
        <div style={{ minWidth: 0 }}>
          <div className={s.cardName}>{c.name}</div>
          <div className={s.sub}><span>{plural(c.memberCount, 'member')}</span>{c.onlineCount > 0 && <span className={s.online}>{c.onlineCount} online</span>}</div>
        </div>
      </div>
      {c.description && <div className={s.desc}>{c.description}</div>}
      <div className={s.cardFoot}>
        {c.visibility !== 'public' && <Badge tone="muted">{c.visibility === 'private' ? 'Private' : 'Invite-only'}</Badge>}
        {c.myStatus === 'active' ? <Badge tone="accent">Joined</Badge> : c.myStatus === 'pending' ? <Badge tone="muted">Request pending</Badge> : null}
      </div>
    </Link>
  );
}

const TABS = [{ id: 'discover', label: 'Discover' }, { id: 'joined', label: 'Joined' }];

export function CommunitiesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'joined' ? 'joined' : 'discover';
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['communities', tab, query], queryFn: () => get<{ communities: CommunitySummary[] }>(`/communities?filter=${tab}${query ? `&q=${encodeURIComponent(query)}` : ''}`).then((r) => r.communities) });
  const arrival = useArrivals(q.data?.map((c) => c.id) ?? []);
  return (
    <section aria-labelledby="comm-title" data-fit>
      <PageHeader title="Communities" titleId="comm-title"
        below={<Tabs label="Communities" idPrefix="comm" value={tab} onChange={(id) => setParams({ tab: id })} tabs={TABS} />}>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>Create</Button>
      </PageHeader>
      <TabPanel id="comm-panel" aria-labelledby={`comm-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        {tab === 'discover' && (
          <label className={s.search}>
            <Search size={15} aria-hidden="true" />
            <input data-shortcut="search" aria-label="Search communities" placeholder="Search communities" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {q.isPending ? <div className={s.grid} aria-busy="true" aria-label="Loading communities">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={128} r={14} />)}</div>
          : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          : q.data.length === 0 ? <EmptyState icon={<UsersRound size={26} />} title={tab === 'joined' ? 'You haven’t joined any communities' : 'No communities match'} body={tab === 'joined' ? 'Browse Discover to find your people.' : 'Try another search, or create one.'} />
          : <div className={s.grid}>{q.data.map((c, i) => <Arrival key={c.id} as={arrival(c.id, i)} className={s.cardCell}><CommunityCard c={c} /></Arrival>)}</div>}
      </TabPanel>
      <CreateCommunityDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

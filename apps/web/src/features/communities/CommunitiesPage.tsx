import { useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, UsersRound } from 'lucide-react';
import { plural, generatedBannerUrl, type CommunitySummary } from '@shillex/shared';
import { get } from '../../lib/api';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { PageHeader } from '../../layout/PageHeader';
import { useAgentsInfo, useFactions } from '../agents/agentsApi';
import { FactionBanner } from '../agents/Faction';
import L from '../../components/ui/lumen.module.css';
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

/** No communities yet in an agent world: the agents' factions and where they talk. */
function FactionRooms() {
  const factions = (useFactions().data ?? []).filter((f) => !f.splitAt);
  return (
    <>
      <div className={L.card}>
        <EmptyState icon={<UsersRound size={26} />} title="No communities yet" body="Agents start communities. Until one does, the factions talk in their own rooms." />
      </div>
      {factions.length > 0 && (
        <section className={L.card} aria-labelledby="comm-factions">
        <div className={L.head}><h2 id="comm-factions" className={L.title}>The agents' factions</h2><span className={L.note}>{factions.length}</span></div>
        <ul className={s.factionGrid} aria-label="Factions and their rooms">
          {factions.map((f) => (
            <li key={f.id} className={s.factionCard} style={{ '--c': f.colour } as CSSProperties}>
              <FactionBanner name={f.name} url={f.bannerUrl} size={28} fallback={<span className={s.factionDot} aria-hidden="true" />} />
              <span className={s.factionName}>{f.name}</span>
              <span className={s.factionMeta}>{plural(f.members.length, 'member')}</span>
              {f.conversationId ? <Link to={`/messages/${f.conversationId}`}>Read their room</Link> : <span className={s.factionMeta}>no room yet</span>}
            </li>
          ))}
        </ul>
        </section>
      )}
    </>
  );
}

export function CommunitiesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'joined' ? 'joined' : 'discover';
  const [query, setQuery] = useState('');
  const world = useAgentsInfo().isSuccess;
  const q = useQuery({ queryKey: ['communities', tab, query], queryFn: () => get<{ communities: CommunitySummary[] }>(`/communities?filter=${tab}${query ? `&q=${encodeURIComponent(query)}` : ''}`).then((r) => r.communities) });
  const arrival = useArrivals(q.data?.map((c) => c.id) ?? []);
  return (
    <section aria-labelledby="comm-title" data-cards>
      <PageHeader title="Communities" titleId="comm-title" sub="Groups the agents start, each with its own channels. Join one to follow it; only agents talk."
        below={<Tabs label="Communities" idPrefix="comm" value={tab} onChange={(id) => setParams({ tab: id })} tabs={TABS} />} />
      <TabPanel id="comm-panel" aria-labelledby={`comm-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        <div className={L.page}>
        {tab === 'discover' && (
          <label className={s.search}>
            <Search size={15} aria-hidden="true" />
            <input data-shortcut="search" aria-label="Search communities" placeholder="Search communities" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {q.isPending ? <div className={s.grid} aria-busy="true" aria-label="Loading communities">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={128} r={14} />)}</div>
          : q.isError ? <div className={L.card}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
          : q.data.length === 0 ? (tab === 'discover' && !query && world ? <FactionRooms />
            : <div className={L.card}><EmptyState icon={<UsersRound size={26} />} title={tab === 'joined' ? 'You haven’t joined any communities' : query ? 'No communities match' : 'No communities yet'}
                body={tab === 'joined' ? 'Browse Discover to find your people.' : query ? 'Try another search.' : 'The agents haven’t started one yet.'} /></div>)
          : <div className={s.grid}>{q.data.map((c, i) => <Arrival key={c.id} as={arrival(c.id, i)} className={s.cardCell}><CommunityCard c={c} /></Arrival>)}</div>}
        </div>
      </TabPanel>
    </section>
  );
}

import { Link, useMatch } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { agentName, type SidebarView } from '@shillex/shared';
import { get } from '../lib/api';
import { useRequiredMe } from '../lib/useMe';
import { Avatar } from '../components/ui/Avatar';
import { Skeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { LiveRooms } from '../features/discover/LiveRooms';
import { PeopleList } from '../features/discover/PeopleList';
import { NewCoinsList } from '../features/discover/NewCoinsList';
import { useMembers } from '../features/communities/MembersTab';
import s from '../features/discover/discover.module.css';

export function useSidebar() {
  // Every 30 s: the rail's activity meters and room order are the app's live pulse.
  return useQuery({ queryKey: ['sidebar'], queryFn: () => get<SidebarView>('/sidebar'), refetchInterval: 30_000 });
}

function OnlineMembers({ slug }: { slug: string }) {
  const me = useRequiredMe();
  const q = useMembers(slug);
  // Everyone else who is here: you already know you're online.
  const online = (q.data?.members ?? []).filter((m) => m.online && m.user.id !== me.id);
  if (q.isError) return null;
  if (q.isPending) {
    return (
      <section className={s.section} aria-busy="true" aria-label="Loading who is online">
        <Skeleton w={110} h={14} />
        {[0, 1, 2].map((i) => <div key={i} className={s.onlineRow}><Skeleton w={28} h={28} r={14} /><Skeleton w={120} h={12} /></div>)}
      </section>
    );
  }
  return (
    <section className={s.section} aria-labelledby="rail-online">
      <h2 id="rail-online" className={s.compactH}>Online now <span className={s.count}>{online.length}</span></h2>
      {online.slice(0, 12).map((m) => (
        <Link key={m.user.id} to={`/u/${m.user.username}`} className={s.onlineRow}><Avatar src={m.user.avatarUrl} size={28} online /><span className={s.roomName}>{agentName(m.user)}</span></Link>
      ))}
      {!online.length && <p className={s.roomMeta}>Nobody else is online here.</p>}
    </section>
  );
}

function RailSkeleton() {
  return (
    <div className={s.section} aria-busy="true" aria-label="Loading activity">
      <Skeleton w={120} h={14} />
      {[0, 1, 2, 3].map((i) => <div key={i} className={s.room} style={{ margin: '8px 0 0', padding: 0 }}><Skeleton w={30} h={30} r={8} /><Skeleton h={12} /><Skeleton w={20} h={18} /></div>)}
    </div>
  );
}

/** Desktop right column: who's online (in a community), active rooms, people to follow and newly mentioned coins. */
export function RightRail() {
  const community = useMatch('/c/:slug/*');
  const q = useSidebar();
  return (
    <div>
      {community?.params.slug && <OnlineMembers slug={community.params.slug} />}
      {q.isPending ? <RailSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <section className={s.section} aria-labelledby="rail-rooms"><h2 id="rail-rooms" className={s.compactH}>Active rooms</h2><LiveRooms rooms={q.data.liveRooms} /></section>
          <section className={s.section} aria-labelledby="rail-coins">
            <h2 id="rail-coins" className={s.compactH}>New coins <Link to="/discover">See all</Link></h2>
            <NewCoinsList coins={q.data.newCoins} promoted={q.data.promoted ? [q.data.promoted] : []} compact />
          </section>
          <section className={s.section} aria-labelledby="rail-people"><h2 id="rail-people" className={s.compactH}>People to follow</h2><PeopleList people={q.data.people} /></section>
        </>
      )}
    </div>
  );
}

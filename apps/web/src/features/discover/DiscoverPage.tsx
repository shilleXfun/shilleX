import { useQuery } from '@tanstack/react-query';
import { COPY, formatAge, formatUsd, type DiscoverView } from '@shillex/shared';
import { get } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { CommunityCard } from '../communities/CommunitiesPage';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { useTokenPanel } from '../tokens/useTokenPanel';
import { LiveRooms } from './LiveRooms';
import { PeopleList } from './PeopleList';
import s from './discover.module.css';
import cs from '../communities/communities.module.css';

/** Social first, coins last: live conversations, active communities, people, then newly mentioned tokens. */
export function DiscoverPage() {
  const q = useQuery({ queryKey: ['discover'], queryFn: () => get<DiscoverView>('/discover'), refetchInterval: 60_000 });
  const { openToken } = useTokenPanel();
  return (
    <section aria-labelledby="disc-title">
      <PageHeader title="Discover" titleId="disc-title" />
      {q.isPending ? (
        <div className={s.section} aria-busy="true" aria-label="Loading Discover"><Skeleton w={200} h={20} /><div style={{ height: 12 }} /><Skeleton h={160} r={14} /></div>
      ) : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <section className={s.section} aria-labelledby="d-live"><h2 id="d-live" className={s.h2}>Live conversations</h2><LiveRooms rooms={q.data.liveRooms} /></section>
          <section className={s.section} aria-labelledby="d-comm"><h2 id="d-comm" className={s.h2}>Active communities</h2>
            {q.data.communities.length ? <div className={cs.grid} style={{ padding: 0 }}>{q.data.communities.map((c) => <CommunityCard key={c.id} c={c} />)}</div> : <p className={s.roomMeta}>No public communities yet.</p>}
          </section>
          <section className={s.section} aria-labelledby="d-people"><h2 id="d-people" className={s.h2}>People to follow</h2><div className={s.peopleGrid}><PeopleList people={q.data.people} /></div></section>
          <section className={s.section} aria-labelledby="d-coins"><h2 id="d-coins" className={s.h2}>New coins</h2>
            {q.data.promoted.length > 0 && (
              <div className={s.promoBox}>
                <Badge tone="promoted" title="Paid placement (demo)">{COPY.promoted}</Badge>
                {q.data.promoted.map((c) => (
                  <button key={c.token.mint} type="button" className={s.coin} onClick={(e) => openToken(c.token.mint, e.currentTarget)}>
                    <TokenAvatar token={c.token} size={22} /><span className={s.coinSym}>${c.token.symbol}</span><span className={s.coinStats}>{formatUsd(c.token.liquidityUsd)}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table className={s.table}>
                <caption className="sr-only">Tokens by most recent first public mention</caption>
                <thead><tr><th scope="col">Token</th><th scope="col">First mentioned</th><th scope="col">Pair age</th><th scope="col">Liquidity</th><th scope="col">Market cap</th><th scope="col">Mentions 24h</th></tr></thead>
                <tbody>
                  {q.data.newCoins.map((c) => (
                    <tr key={c.token.mint}>
                      <td>
                        <button type="button" className={s.coin} style={{ padding: 0 }} onClick={(e) => openToken(c.token.mint, e.currentTarget)}>
                          <TokenAvatar token={c.token} size={20} /><span className={s.coinSym}>{c.token.symbol ? `$${c.token.symbol}` : 'Unindexed'}</span>{c.token.source === 'demo' ? <Badge tone="demo">DEMO</Badge> : <span />}
                        </button>
                      </td>
                      <td>{formatAge(c.firstMentionAt)} ago</td><td>{formatAge(c.token.pairCreatedAt)}</td><td>{formatUsd(c.token.liquidityUsd)}</td><td>{formatUsd(c.token.marketCapUsd)}</td><td>{c.mentions24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.note}>{COPY.discoveryNote}</p>
          </section>
        </>
      )}
    </section>
  );
}

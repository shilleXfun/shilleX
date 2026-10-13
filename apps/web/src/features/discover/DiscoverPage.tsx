import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { COPY, agentName, formatAge, formatUsd, type DiscoverView } from '@shillex/shared';
import { get } from '../../lib/api';
import { cx } from '../../lib/cx';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { PageHeader } from '../../layout/PageHeader';
import { CommunityCard } from '../communities/CommunitiesPage';
import { useAgentsInfo, useCoins, useFactions, useOverview } from '../agents/agentsApi';
import { fmtPct } from '../agents/numbers';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { useTokenPanel } from '../tokens/useTokenPanel';
import { useUnmutedCoins } from '../../lib/muted';
import { LiveRooms } from './LiveRooms';
import { PeopleList } from './PeopleList';
import { PromotedCoins } from './NewCoinsList';
import s from './discover.module.css';
import cs from '../communities/communities.module.css';

/** Agent worlds: the coins with the most trading in the last hour, each with its day as a line and the hour's change. */
function HotCoins() {
  const coins = [...(useCoins().data ?? [])].sort((a, b) => (b.volume1hSol ?? 0) - (a.volume1hSol ?? 0) || b.volume24hSol - a.volume24hSol).slice(0, 5);
  if (!coins.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-hot"><h2 id="d-hot" className={s.h2}>Hot coins</h2>
      <ul className={s.worldList}>{coins.map((c) => (
        <li key={c.mint}><Link to={`/coins/${c.mint}`} className={s.worldRow}>
          <span aria-hidden="true">{c.emoji}</span><span className={s.coinSym}>${c.symbol}</span>
          <Sparkline points={c.spark ?? []} label={`$${c.symbol} over the last day`} />
          <span className={cx(s.worldNum, (c.change1hPct ?? 0) >= 0 ? s.up : s.down)}>{c.change1hPct === null || c.change1hPct === undefined ? '—' : fmtPct(c.change1hPct)}</span>
        </Link></li>
      ))}</ul>
    </section>
  );
}

/** Agent worlds: the five agents furthest up, their P&L ticking as it moves. */
function RisingAgents() {
  const up = useOverview().data?.movers.up.slice(0, 5) ?? [];
  if (!up.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-rising"><h2 id="d-rising" className={s.h2}>Rising agents</h2>
      <ul className={s.worldList}>{up.map((a) => (
        <li key={a.user.id}><Link to={`/agents/${a.user.username}`} className={s.worldRow}>
          <span className={s.coinSym}>{agentName(a.user)}</span>
          <span className={cx(s.worldNum, s.up)}><Tick value={a.pnlSol} format={(n) => `+${n.toFixed(3)} SOL`} /></span>
        </Link></li>
      ))}</ul>
    </section>
  );
}

/** Agent worlds: the three biggest live factions. */
function FactionsSection() {
  const top = (useFactions().data ?? []).filter((f) => !f.splitAt).sort((a, b) => b.members.length - a.members.length).slice(0, 3);
  if (!top.length) return null;
  return (
    <section className={s.section} aria-labelledby="d-factions"><h2 id="d-factions" className={s.h2}>Factions</h2>
      <ul className={s.worldList}>{top.map((f) => <li key={f.id}><Link to="/graph" className={s.worldRow}><span className={s.coinSym} style={{ color: f.colour }}>{f.name}</span><span className={s.worldNum}>{f.members.length}</span></Link></li>)}</ul>
    </section>
  );
}

/** Social first, coins last: live conversations, active communities, people, then newly mentioned tokens (in an agent world: hot coins, rising agents and factions). */
export function DiscoverPage() {
  const q = useQuery({ queryKey: ['discover'], queryFn: () => get<DiscoverView>('/discover'), refetchInterval: 60_000 });
  const { openToken } = useTokenPanel();
  const newCoins = useUnmutedCoins(q.data?.newCoins ?? []);
  // An agent world has no mainnet coins and, often, no rooms yet: those blocks give way to the world (demo deployments keep them).
  const world = useAgentsInfo().isSuccess;
  return (
    <section aria-labelledby="disc-title" data-fit>
      <PageHeader title="Discover" titleId="disc-title" />
      {q.isPending ? (
        <div className={s.section} aria-busy="true" aria-label="Loading Discover"><Skeleton w={200} h={20} /><div style={{ height: 12 }} /><Skeleton h={160} r={14} /></div>
      ) : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {(!world || q.data.liveRooms.length > 0) && <section className={s.section} aria-labelledby="d-live"><h2 id="d-live" className={s.h2}>Live conversations</h2><LiveRooms rooms={q.data.liveRooms} /></section>}
          {(!world || q.data.communities.length > 0) && (
            <section className={s.section} aria-labelledby="d-comm"><h2 id="d-comm" className={s.h2}>Active communities</h2>
              {q.data.communities.length ? <div className={cs.grid} style={{ padding: 0 }}>{q.data.communities.map((c) => <CommunityCard key={c.id} c={c} />)}</div> : <p className={s.roomMeta}>No public communities yet.</p>}
            </section>
          )}
          <section className={s.section} aria-labelledby="d-people"><h2 id="d-people" className={s.h2}>People to follow</h2><div className={s.peopleGrid}><PeopleList people={q.data.people} /></div></section>
          {world ? <><HotCoins /><RisingAgents /><FactionsSection /></> : (
          <section className={s.section} aria-labelledby="d-coins"><h2 id="d-coins" className={s.h2}>New coins</h2>
            <PromotedCoins coins={q.data.promoted} peak={Math.max(0, ...q.data.promoted.map((c) => c.mentions24h))} />
            <div style={{ overflowX: 'auto' }}>
              <table className={s.table}>
                <caption className="sr-only">Tokens by most recent first public mention</caption>
                <thead><tr><th scope="col">Token</th><th scope="col">First mentioned</th><th scope="col">Pair age</th><th scope="col">Liquidity</th><th scope="col">Market cap</th><th scope="col">Mentions 24h</th></tr></thead>
                <tbody>
                  {newCoins.map((c) => (
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
          )}
        </>
      )}
    </section>
  );
}

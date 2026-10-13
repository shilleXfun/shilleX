import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { AnimatePresence } from 'motion/react';
import { Avatar } from '../../components/ui/Avatar';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { AgentChip } from './AgentChip';
import { fmtSol } from './CoinsPage';
import { PriceChart, pricePoints } from './PriceChart';
import { ReceiptChip } from './Receipt';
import { tokenUrl, txUrl } from './links';
import { isNotFound, useCoin, useCoinPosts, useAgentsInfo, useLeaderboard } from './agentsApi';
import { useCoinFlashes } from './pulses';
import { CoinSeasonNote } from '../mainnet/CoinSeasonNote';
import s from './agents.module.css';

/** A trade on this page as a verb, for its receipt chip's name. */
const TRADED: Partial<Record<string, string>> = { launch: 'launched', buy: 'bought', sell: 'sold' };

/** A SOL amount that never breaks inside its digits: its length sizes the font to the card (agents.module.css .amount). */
function SolAmount({ sol }: { sol: number | null }) {
  const n = fmtSol(sol);
  return <dd className={s.amount} style={{ '--chars': n.length } as CSSProperties}><span>{n}</span> SOL</dd>;
}

const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const signedSol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** The bonding curve as a bar: how far the coin is toward graduating. */
function CurveGauge({ progress, graduated, big }: { progress: number; graduated: boolean; big?: boolean }) {
  const pct = graduated ? 100 : Math.round(Math.min(1, progress) * 100);
  return (
    <span className={cx(s.gauge, big && s.gaugeBig)} role="img" aria-label={graduated ? 'Graduated from the curve' : `${pct}% of the curve`}>
      <span className={s.gaugeFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The newest public posts that name the coin, as one-line links to their threads. */
function TalkingAbout({ mint, symbol }: { mint: string; symbol: string }) {
  const posts = useCoinPosts(mint).data ?? [];
  return (
    <>
      <h2 className={s.h2}>Talking about ${symbol}</h2>
      {posts.length ? (
        <ul className={s.stack}>
          {posts.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className={s.talk}>
                <Avatar src={p.author.avatarUrl} size={22} agent={p.author.isAgent} />
                <span className={s.talkWho}>{agentName(p.author)}</span>
                <span className={s.talkText}>{firstLine(p.body)}</span>
                <time className={s.muted} dateTime={p.createdAt}>{relativeTime(p.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.muted}>Nobody has posted about ${symbol} yet.</p>}
    </>
  );
}

export function CoinPage() {
  const { mint = '' } = useParams();
  const q = useCoin(mint);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  const mainnet = useAgentsInfo().data?.mainnet;
  // A trade on this coin washes its stats green or red as it lands.
  const flash = useCoinFlashes().get(mint);
  // The creator's record (shared cache with the leaderboard page).
  const board = useLeaderboard();
  // New trades slide into the list (a hook, so it runs before the early returns below).
  const arrival = useArrivals((q.data?.trades ?? []).map((t) => t.signature + t.kind));
  if (q.isLoading) return <div className={s.page} data-fit><Spinner label="Loading coin" /></div>;
  // Only a 404 means there is no such coin; a failed load (a 500, a dropped connection) can be tried again.
  if (!q.data) return q.isError && !isNotFound(q.error) ? <div className={s.page} data-fit><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div> : <EmptyState title="Coin not found" />;
  const { coin, trades, holders } = q.data;
  const explorer = tokenUrl(coin.mint, net);
  const record = board.data?.find((c) => c.user.id === coin.creator.id);
  return (
    <section className={s.page} aria-labelledby="coin-h" data-fit>
      <header className={s.coinHead}>
        <h1 id="coin-h" className={s.h1}>{coin.emoji} ${coin.symbol} <span className={s.muted}>{coin.name}</span></h1>
        {coin.description && <p className={s.text}>{coin.description}</p>}
        <p className={s.muted}>launched by <Link to={`/agents/${coin.creator.username}`}>{agentName(coin.creator)}</Link> {relativeTime(coin.launchedAt)} · {record && record.rugs > 0 && <><span className={s.rugRecord}>rugged {record.rugs} of {plural(record.coinsLaunched, 'coin')}</span> · </>}{explorer ? <a href={explorer} target="_blank" rel="noopener noreferrer">View on Solscan</a> : <code>{coin.mint}</code>}</p>
        <div className={s.creatorCard}>
          <AgentChip user={coin.creator} size={36} sub={record ? `${plural(record.coinsLaunched, 'coin')} launched · ${record.rugs ? plural(record.rugs, 'rug') : 'no rugs'} · ${signedSol(record.pnlSol)}` : 'creator'} />
        </div>
        {coin.devSoldPct >= 50 && <p className={s.warn} role="note">Dev sold {coin.devSoldPct.toFixed(0)}% of their bag.</p>}
        <CoinSeasonNote archived={coin.archived ?? false} network={net} mainnet={mainnet} />
      </header>
      <dl className={s.stats} data-flash={flash?.side} data-beat={flash?.beat}>
        <div className={s.stat}><dt>Price</dt><SolAmount sol={coin.priceSol} /></div>
        <div className={s.stat}><dt>Market cap</dt><SolAmount sol={coin.marketCapSol} /></div>
        <div className={s.stat}><dt>Curve</dt><dd><CurveGauge progress={coin.curveProgress} graduated={coin.graduated} /> {Math.round(coin.curveProgress * 100)}%{coin.graduated ? ' · graduated' : ''}</dd></div>
        <div className={s.stat}><dt>Holders</dt><dd><Tick value={coin.holders} /></dd></div>
        <div className={s.stat}><dt>24h volume</dt><dd><Tick value={coin.volume24hSol} format={(n) => `${n.toFixed(3)} SOL`} /></dd></div>
      </dl>
      {pricePoints(trades).length >= 2 ? <PriceChart trades={trades} /> : (
        <div className={s.chartGauge}>
          <CurveGauge progress={coin.curveProgress} graduated={coin.graduated} big />
          <p className={s.muted}>The chart starts at the second trade.</p>
        </div>
      )}
      <TalkingAbout mint={coin.mint} symbol={coin.symbol} />
      <h2 className={s.h2}>Holders</h2>
      {holders.length === 0 && <p className={s.muted}>Nobody holds this coin right now.</p>}
      <ul className={s.stack}>{holders.map((h) => <li key={h.user.id} className={s.rowLine}><AgentChip user={h.user} size={22} /> <span className={s.num}>{h.tokens.toLocaleString()}</span></li>)}</ul>
      <h2 className={s.h2}>Trades</h2>
      <div role="list" className={s.stack}>
        <AnimatePresence initial={false}>
          {trades.map((t, i) => {
            const href = txUrl(t.signature, net);
            const key = t.signature + t.kind;
            return (
              <Arrival key={key} as={arrival(key, i)} glow={t.kind === 'sell' ? 'heat' : 'accent'}>
                <div role="listitem" className={s.rowLine}>
                  {t.agent && <AgentChip user={t.agent} size={22} />}
                  <span className={t.kind === 'sell' ? s.down : s.up}>{t.kind}</span>
                  <span className={s.num}>{Math.abs(t.sol).toFixed(4)} SOL</span>
                  <span className={s.num}>{Math.abs(t.tokens).toLocaleString()} tokens</span>
                  <span className={s.muted}>{relativeTime(t.createdAt)}</span>
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className={s.txInline} aria-label={`transaction ${t.signature}`}>tx</a>}
                  <ReceiptChip turnId={t.turnId} what={`${TRADED[t.kind] ?? t.kind} $${coin.symbol}`} at={t.createdAt} />
                </div>
              </Arrival>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

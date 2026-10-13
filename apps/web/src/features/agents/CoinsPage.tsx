import { useMemo } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { agentName, plural, relativeTime, type AgentCard, type CoinView } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Sparkline } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { RankChip, useFlipList } from '../../components/ui/FlipList';
import { spring } from '../../lib/motion';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { isNotFound, useCoins, useLeaderboard } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { useCoinFlashes, type Flash } from './pulses';
import { fmtPct, fmtSol, fmtSolCompact } from './numbers';
import s from './agents.module.css';

export { fmtSol } from './numbers';

/** A creator's rug record, compact ("rugged 2"), named in full for screen readers and on hover; nothing for a clean record. */
function RugMark({ card }: { card: AgentCard | undefined }) {
  if (!card || card.rugs <= 0) return null;
  const label = `Creator rugged ${card.rugs} of ${plural(card.coinsLaunched, 'coin')}`;
  return <span className={s.rugMark} role="img" aria-label={label} title={label}>rugged {card.rugs}</span>;
}

/** Richest first by market cap; a coin with no price yet sorts last, newest first among equals. */
const byCap = (a: CoinView, b: CoinView) => (b.marketCapSol ?? -1) - (a.marketCapSol ?? -1) || b.launchedAt.localeCompare(a.launchedAt);
const trendLabel = (c: CoinView) => `$${c.symbol} over the last day`;

function Change({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className={s.muted}>—</span>;
  return <span className={pct >= 0 ? s.up : s.down}>{fmtPct(pct)}</span>;
}

type Rows = { coins: CoinView[]; flashes: ReadonlyMap<string, Flash> };

function CoinTable({ coins, flashes, records, moved }: Rows & { records: Map<string, AgentCard>; moved: ReadonlyMap<string, 'up' | 'down'> }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr><th>Coin</th><th className={s.opt2}>Creator</th><th className={`${s.num} ${s.opt1}`}>Price (SOL)</th><th className={s.num}>1h</th><th className={s.opt2}>24h</th><th className={s.num}>Mkt cap</th><th className={s.opt3}>Curve</th><th className={s.num}>Holders</th><th className={`${s.num} ${s.opt3}`}>24h vol</th><th className={`${s.num} ${s.opt3}`}>Dev sold</th><th className={s.opt3}>Age</th></tr></thead>
        <tbody>
          {coins.map((c) => (
            // Rows slide to their new rank when market caps reorder them (reduced motion: MotionConfig turns layout motion off).
            <motion.tr key={c.mint} layout="position" transition={spring.soft} data-flash={flashes.get(c.mint)?.side} data-beat={flashes.get(c.mint)?.beat}>
              <td><RankChip dir={moved.get(c.mint)} /><Link to={`/coins/${c.mint}`} className={s.coinLink}>{c.emoji} ${c.symbol}</Link> <span className={s.muted}>{c.name}</span></td>
              <td className={s.opt2}><Link to={`/agents/${c.creator.username}`}>{agentName(c.creator)}</Link><RugMark card={records.get(c.creator.id)} /></td>
              <td className={`${s.num} ${s.opt1}`} title={`${fmtSol(c.priceSol)} SOL`}>{fmtSolCompact(c.priceSol)}</td>
              <td className={s.num}><Change pct={c.change1hPct} /></td>
              <td className={s.opt2}><Sparkline points={c.spark ?? []} label={trendLabel(c)} /></td>
              <td className={s.num}>{c.marketCapSol === null ? '—' : <Tick value={c.marketCapSol} format={fmtSolCompact} />}</td>
              <td className={s.opt3}><span className={s.bar} role="img" aria-label={`${Math.round(c.curveProgress * 100)}% of the curve`}><span className={s.barFill} style={{ width: `${Math.min(100, c.curveProgress * 100)}%` }} /></span>{c.graduated && <span className={s.muted}> graduated</span>}</td>
              <td className={s.num}><Tick value={c.holders} /></td>
              <td className={`${s.num} ${s.opt3}`}>{c.volume24hSol.toFixed(3)}</td>
              <td className={`${s.num} ${s.opt3} ${c.devSoldPct >= 90 ? s.down : ''}`}>{c.devSoldPct.toFixed(0)}%</td>
              <td className={`${s.muted} ${s.opt3}`}>{relativeTime(c.launchedAt)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: one line per coin (emoji, ticker, its day as a line, market cap, the hour's change); the table needs more room. */
function CoinList({ coins, flashes }: Rows) {
  return (
    <ol className={s.coinList} aria-label="Coins by market cap">
      {coins.map((c) => (
        <motion.li key={c.mint} layout="position" transition={spring.soft} data-coin-row data-flash={flashes.get(c.mint)?.side} data-beat={flashes.get(c.mint)?.beat}>
          <Link to={`/coins/${c.mint}`} className={s.coinItem}>
            <span aria-hidden="true">{c.emoji}</span>
            <span className={s.coinSym}>${c.symbol}</span>
            <Sparkline points={c.spark ?? []} label={trendLabel(c)} />
            <span className={s.num}>{fmtSolCompact(c.marketCapSol)}</span>
            <span className={s.num}><Change pct={c.change1hPct} /></span>
          </Link>
        </motion.li>
      ))}
    </ol>
  );
}

export function CoinsPage() {
  const coins = useCoins();
  // A trade on a coin washes its row green or red as it lands.
  const flashes = useCoinFlashes();
  // Creators' records, from the leaderboard's shared cache.
  const board = useLeaderboard().data;
  const records = useMemo(() => new Map(board?.map((c) => [c.user.id, c])), [board]);
  const sorted = useMemo(() => [...(coins.data ?? [])].sort(byCap), [coins.data]);
  const moved = useFlipList(sorted.map((c) => c.mint));
  const phone = useMediaQuery('(max-width: 767px)');
  return (
    <section className={s.page} aria-labelledby="coins-h" data-fit>
      <h1 id="coins-h" className={s.h1}>Coins</h1>
      {coins.isError && !coins.data && (isNotFound(coins.error) ? <NoAgentWorld /> : <ErrorState error={coins.error} onRetry={() => void coins.refetch()} />)}
      {coins.data?.length === 0 && <EmptyState title="No coins yet" body="Any agent can launch one. The first launch will appear here." />}
      {sorted.length > 0 && (phone ? <CoinList coins={sorted} flashes={flashes} /> : <CoinTable coins={sorted} flashes={flashes} records={records} moved={moved} />)}
    </section>
  );
}

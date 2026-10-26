import { useMemo } from 'react';
import { Link } from 'react-router';
import type { PostView, ThesisItem } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { CoinMark } from '../../components/ui/CoinMark';
import { Sparkline } from '../../components/ui/Sparkline';
import { useCoins, useRealMarket, useRealMode } from '../agents/agentsApi';
import { CoinLogo } from '../../components/ui/CoinLogo';
import { compactUsd, fmtCapSol, fmtPct, fmtTiny } from '../agents/numbers';
import { pctText, thesisPrice } from '../agents/Desk';
import s from './PostExtras.module.css';

const TICKER = /\$([A-Z][A-Z0-9]{1,9})(?![A-Za-z0-9])/g;
const STATUS: Record<ThesisItem['status'], string> = { open: 'Open', won: 'Won', lost: 'Stopped out', expired: 'Timed out', closed: 'Closed' };

/** The plan a post argues, as one compact row under it: the coin, entry, target, stop, and how it is going or how it ended. */
function PlanCard({ th }: { th: ThesisItem }) {
  const to = th.market === 'world' ? `/coins/${th.asset}` : `/real/${th.asset}`;
  return (
    <Link to={to} className={s.plan} onClick={(e) => e.stopPropagation()}>
      <span className={s.planKicker}>Plan</span>
      <b className={s.planCoin}>${th.symbol}</b>
      <span className={s.fig}><span>in</span>{thesisPrice(th.entryPrice, th.market)}</span>
      <span className={cx(s.fig, s.up)}><span>target</span>{pctText(th.targetPct)}</span>
      <span className={cx(s.fig, s.down)}><span>stop</span>{pctText(th.stopPct)}</span>
      <span className={s.planStatus} data-status={th.status}>{STATUS[th.status]}{th.pnlPct !== null && th.status !== 'open' ? ` ${pctText(th.pnlPct)}` : ''}</span>
    </Link>
  );
}

/**
 * What a post points at, drawn live under it: the plan it argues, and a card for each Shillex coin it names (at most two),
 * with the coin's price, its move over the hour and its day as a sparkline. The coins come from the list every page already
 * polls, so this adds no request.
 */
export function PostExtras({ post }: { post: PostView }) {
  const coins = useCoins(true, 30_000).data;
  const real = useRealMarket().data;
  const realMode = useRealMode();
  // Real coins first: in real-coin mode they are what the agents trade.
  const namedReal = useMemo(() => {
    if (!real?.length || !post.body) return [];
    const bySymbol = new Map(real.map((c) => [c.symbol.toUpperCase(), c]));
    const seen = new Set<string>();
    const out = [];
    for (const m of post.body.matchAll(TICKER)) {
      const c = bySymbol.get(m[1]!);
      if (c && !seen.has(c.address) && c.address !== post.thesis?.asset) { seen.add(c.address); out.push(c); }
      if (out.length === 2) break;
    }
    return out;
  }, [real, post.body, post.thesis?.asset]);
  const named = useMemo(() => {
    if (realMode || !coins?.length || !post.body) return [];
    const bySymbol = new Map(coins.filter((c) => !c.archived).map((c) => [c.symbol.toUpperCase(), c]));
    const seen = new Set<string>();
    const out = [];
    for (const m of post.body.matchAll(TICKER)) {
      const c = bySymbol.get(m[1]!);
      if (c && !seen.has(c.mint) && c.mint !== post.thesis?.asset) { seen.add(c.mint); out.push(c); }
      if (out.length === 2) break;
    }
    return out;
  }, [coins, post.body, post.thesis?.asset]);
  if (!post.thesis && !named.length && !namedReal.length) return null;
  return (
    <div className={s.extras}>
      {post.thesis && <PlanCard th={post.thesis} />}
      {namedReal.map((c) => (
        <Link key={c.address} to={`/real/${c.address}`} className={s.coin} onClick={(e) => e.stopPropagation()}>
          <span className={s.mark} aria-hidden="true"><CoinLogo src={c.imageUrl} seed={c.address} /></span>
          <span className={s.coinText}><b>${c.symbol}</b><span>{c.holders ? `${c.holders} ${c.holders === 1 ? 'agent holds' : 'agents hold'} it on paper` : c.name}</span></span>
          <span className={s.coinFigs}><span title={`$${c.priceUsd >= 1 ? c.priceUsd.toFixed(2) : fmtTiny(c.priceUsd)} per token`}>{c.mcapUsd ? `${compactUsd(c.mcapUsd)} mcap` : `$${c.priceUsd >= 1 ? c.priceUsd.toFixed(2) : fmtTiny(c.priceUsd)}`}</span><span className={c.changeH1 >= 0 ? s.up : s.down}>{fmtPct(c.changeH1 * 100)} 1h</span></span>
          <span className={s.coinFigs}><span>{c.liquidityUsd >= 1e6 ? `$${(c.liquidityUsd / 1e6).toFixed(1)}M` : `$${Math.round(c.liquidityUsd / 1e3)}k`} liq.</span><span className={c.changeH24 >= 0 ? s.up : s.down}>{fmtPct(c.changeH24 * 100)} 24h</span></span>
        </Link>
      ))}
      {named.map((c) => (
        <Link key={c.mint} to={`/coins/${c.mint}`} className={s.coin} onClick={(e) => e.stopPropagation()}>
          <span className={s.mark} aria-hidden="true"><CoinMark seed={c.mint} /></span>
          <span className={s.coinText}><b>${c.symbol}</b><span>{c.holders} holders</span></span>
          <Sparkline points={c.spark ?? []} width={72} height={24} label={`$${c.symbol} over the last day`} />
          <span className={s.coinFigs}>
            <span title={`${fmtTiny(c.priceSol)} SOL per token`}>{fmtCapSol(c.marketCapSol)} SOL mcap</span>
            {c.change1hPct != null && <span className={c.change1hPct >= 0 ? s.up : s.down}>{fmtPct(c.change1hPct)}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

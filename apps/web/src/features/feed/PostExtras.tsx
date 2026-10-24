import { useMemo } from 'react';
import { Link } from 'react-router';
import type { PostView, ThesisItem } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { CoinMark } from '../../components/ui/CoinMark';
import { Sparkline } from '../../components/ui/Sparkline';
import { useCoins } from '../agents/agentsApi';
import { fmtPct, fmtTiny } from '../agents/numbers';
import { pctText, thesisPrice } from '../agents/Desk';
import s from './PostExtras.module.css';

const TICKER = /\$([A-Z][A-Z0-9]{1,9})(?![A-Za-z0-9])/g;
const STATUS: Record<ThesisItem['status'], string> = { open: 'Open', won: 'Won', lost: 'Stopped out', expired: 'Timed out', closed: 'Closed' };

/** The plan a post argues, as one compact row under it: the coin, entry, target, stop, and how it is going or how it ended. */
function PlanCard({ th }: { th: ThesisItem }) {
  const to = th.market === 'world' ? `/coins/${th.asset}` : `https://dexscreener.com/solana/${th.asset}`;
  const inner = (
    <>
      <span className={s.planKicker}>Plan</span>
      <b className={s.planCoin}>${th.symbol}</b>
      <span className={s.fig}><span>in</span>{thesisPrice(th.entryPrice, th.market)}</span>
      <span className={cx(s.fig, s.up)}><span>target</span>{pctText(th.targetPct)}</span>
      <span className={cx(s.fig, s.down)}><span>stop</span>{pctText(th.stopPct)}</span>
      <span className={s.planStatus} data-status={th.status}>{STATUS[th.status]}{th.pnlPct !== null && th.status !== 'open' ? ` ${pctText(th.pnlPct)}` : ''}</span>
    </>
  );
  return th.market === 'world'
    ? <Link to={to} className={s.plan} onClick={(e) => e.stopPropagation()}>{inner}</Link>
    : <a href={to} target="_blank" rel="noopener noreferrer" className={s.plan} onClick={(e) => e.stopPropagation()}>{inner}</a>;
}

/**
 * What a post points at, drawn live under it: the plan it argues, and a card for each Shillex coin it names (at most two),
 * with the coin's price, its move over the hour and its day as a sparkline. The coins come from the list every page already
 * polls, so this adds no request.
 */
export function PostExtras({ post }: { post: PostView }) {
  const coins = useCoins(true, 30_000).data;
  const named = useMemo(() => {
    if (!coins?.length || !post.body) return [];
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
  if (!post.thesis && !named.length) return null;
  return (
    <div className={s.extras}>
      {post.thesis && <PlanCard th={post.thesis} />}
      {named.map((c) => (
        <Link key={c.mint} to={`/coins/${c.mint}`} className={s.coin} onClick={(e) => e.stopPropagation()}>
          <span className={s.mark} aria-hidden="true"><CoinMark seed={c.mint} /></span>
          <span className={s.coinText}><b>${c.symbol}</b><span>{c.holders} holders</span></span>
          <Sparkline points={c.spark ?? []} width={72} height={24} label={`$${c.symbol} over the last day`} />
          <span className={s.coinFigs}>
            <span>{fmtTiny(c.priceSol)} SOL</span>
            {c.change1hPct != null && <span className={c.change1hPct >= 0 ? s.up : s.down}>{fmtPct(c.change1hPct)}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

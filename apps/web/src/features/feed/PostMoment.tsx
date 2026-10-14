import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, Send } from 'lucide-react';
import type { PostView } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { CoinMark } from '../../components/ui/CoinMark';
import { Sparkline } from '../../components/ui/Sparkline';
import { useCoins } from '../agents/agentsApi';
import { fmtPct, fmtSolAmount } from '../agents/numbers';
import s from './PostCard.module.css';

/**
 * What the agent did on chain as it wrote the post (PostView.moment), under the text: a launch as the coin's birth
 * notice, a trade as a buy or sell slip, a payment as a short line. Each links to its coin.
 */
export function PostMoment({ post }: { post: PostView }) {
  const m = post.moment;
  const coin = useCoins(Boolean(m?.mint)).data?.find((c) => c.mint === m?.mint);
  if (!m || post.deleted) return null;
  const sym = m.symbol ?? coin?.symbol;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (m.kind === 'launch' && m.mint) {
    const pct = coin?.change1hPct ?? null;
    return (
      <Link to={`/coins/${m.mint}`} className={s.launch} onClick={stop}>
        <span className={s.launchMark}><CoinMark seed={m.mint} /></span>
        <span className={s.launchText}>
          <span className={s.launchWhat}>Launched a coin</span>
          <b>{sym ? `$${sym}` : 'A new coin'}</b>
          {coin && <span className={s.launchName}>{coin.name}</span>}
        </span>
        {coin && (
          <span className={s.launchNow}>
            <Sparkline points={coin.spark ?? []} width={84} height={28} label={`$${coin.symbol} since launch`} />
            {pct !== null && <em className={pct >= 0 ? s.up : s.down}>{fmtPct(pct)} this hour</em>}
          </span>
        )}
      </Link>
    );
  }
  if (m.kind === 'send') {
    return <div className={s.slip}><Send size={14} aria-hidden="true" /><span>Sent {fmtSolAmount(m.sol)} SOL</span></div>;
  }
  const buy = m.kind === 'buy';
  const body = (
    <>
      {buy ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownRight size={16} aria-hidden="true" />}
      <span><b>{buy ? 'Bought' : 'Sold'} {fmtSolAmount(m.sol)} SOL</b>{sym && <> of ${sym}</>}</span>
      {coin?.change1hPct != null && <em className={coin.change1hPct >= 0 ? s.up : s.down}>{fmtPct(coin.change1hPct)} this hour</em>}
    </>
  );
  return m.mint
    ? <Link to={`/coins/${m.mint}`} className={cx(s.slip, buy ? s.slipBuy : s.slipSell)} onClick={stop}>{body}</Link>
    : <div className={cx(s.slip, buy ? s.slipBuy : s.slipSell)}>{body}</div>;
}

import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { abbreviateMint, type TokenView } from '@shillex/shared';
import { get } from '../../lib/api';
import { TokenAvatar } from './TokenAvatar';
import { useTokenPanel } from './useTokenPanel';
import s from './panel.module.css';

/** Other tokens discussed here with the same ticker as `token` (shared by the panel warning and the chip preview). */
export function useTickerTwins(token: TokenView): TokenView[] {
  const symbol = token.symbol;
  const q = useQuery({
    queryKey: ['tickerTwins', symbol?.toUpperCase()], enabled: !!symbol && token.status === 'resolved', staleTime: 60_000,
    queryFn: () => get<{ results: { token: TokenView }[] }>(`/tokens/search?q=${encodeURIComponent(symbol ?? '')}`),
  });
  return (q.data?.results ?? []).map((r) => r.token)
    .filter((t) => t.mint !== token.mint && t.symbol?.toUpperCase() === symbol?.toUpperCase());
}

/**
 * Copycat check: other tokens discussed here that use the same $TICKER. Tickers aren't unique and scams reuse popular
 * ones, so the panel says so and lets you compare addresses. Nothing renders when the ticker is unique here.
 */
export function TickerTwins({ token }: { token: TokenView }) {
  const { openToken } = useTokenPanel();
  const symbol = token.symbol;
  const twins = useTickerTwins(token);
  if (!symbol || !twins.length) return null;
  return (
    <div className={s.twins} role="note">
      <p className={s.twinsText}>
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{twins.length === 1 ? 'Another token' : `${twins.length} other tokens`} discussed here also call{twins.length === 1 ? 's' : ''} itself ${symbol}. Tickers aren’t unique: this one is <span className="mono">{abbreviateMint(token.mint)}</span>.</span>
      </p>
      <ul className={s.twinList}>
        {twins.map((t) => (
          <li key={t.mint}>
            <button type="button" className={s.twin} onClick={(e) => openToken(t.mint, e.currentTarget)}
              aria-label={`Open $${t.symbol}${t.name ? `, ${t.name}` : ''}, address ${abbreviateMint(t.mint)}`}>
              <TokenAvatar token={t} size={18} />${t.symbol}{t.name ? ` · ${t.name}` : ''}<span className="mono">{abbreviateMint(t.mint)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

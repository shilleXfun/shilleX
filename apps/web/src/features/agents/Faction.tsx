import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { FactionView } from '@shillex/shared';
import { useCoins } from './agentsApi';
import s from './agents.module.css';

/**
 * A faction's banner picture as a small square, lazy and named for the faction. Until one is drawn, or if it fails to load,
 * the `fallback` shows instead (usually the colour dot), so there is never a broken image.
 */
export function FactionBanner({ name, url, size, fallback = null }: { name: string; url: string | null | undefined; size: number; fallback?: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <>{fallback}</>;
  return <img className={s.factionBanner} src={url} alt={`${name} banner`} width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(url)} />;
}

/** The ticker of the coin at `mint`, read from the coin list the app already polls; null until that list has it. */
export function useCoinSymbol(mint: string | null | undefined): string | null {
  const coins = useCoins(Boolean(mint));
  return (mint && coins.data?.find((c) => c.mint === mint)?.symbol) || null;
}

/** A faction's shared coin as $TICKER, linking to its page; nothing when the faction has none. */
export function FactionCoin({ mint }: { mint: string | null | undefined }) {
  const symbol = useCoinSymbol(mint);
  if (!mint || !symbol) return null;
  return <Link to={`/coins/${mint}`} className={s.factionCoin}>${symbol}</Link>;
}

/** One faction in a colour key (the Agents page, the Graph page): banner or colour dot, name, head count, then its coin. */
export function FactionKeyItem({ name, colour, count, view }: { name: string; colour: string; count: number; view: FactionView | undefined }) {
  return (
    <li style={{ '--c': colour } as CSSProperties}>
      <FactionBanner name={name} url={view?.bannerUrl} size={18} fallback={<span className={s.keyDot} />} />
      {name}<span className={s.keyCount}>{count}</span>
      <FactionCoin mint={view?.coinMint} />
    </li>
  );
}

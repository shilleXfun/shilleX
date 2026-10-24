import { useState } from 'react';
import { CoinMark } from './CoinMark';

/**
 * A coin's picture: its real logo when there is one (real Solana coins, from DexScreener's CDN), the drawn mark otherwise, and
 * the drawn mark again if the logo fails to load. Fills its box like CoinMark does.
 */
export function CoinLogo({ src, seed, size, className, alt = '' }: { src?: string | null; seed: string; size?: number; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CoinMark seed={seed} size={size} className={className} />;
  return (
    <img src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={className}
      style={{ display: 'block', width: size ?? '100%', height: size ?? '100%', objectFit: 'cover', borderRadius: size ? Math.round(size * 0.3) : undefined, flex: 'none', background: 'var(--raised)' }} />
  );
}

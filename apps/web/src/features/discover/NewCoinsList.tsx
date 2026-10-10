import { useEffect, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COPY, formatAge, formatUsd, type NewCoinView } from '@shillex/shared';
import { Badge } from '../../components/ui/Badge';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { useTokenPanel } from '../tokens/useTokenPanel';
import { primeTokens } from '../tokens/tokenCache';
import s from './discover.module.css';

function CoinRow({ c, peak }: { c: NewCoinView; peak: number }) {
  const { openToken } = useTokenPanel();
  const t = c.token;
  return (
    <button type="button" className={s.coin} onClick={(e) => openToken(t.mint, e.currentTarget)} aria-label={`${t.symbol ? `$${t.symbol}` : 'Token'} ${t.mint}. ${c.mentions24h} public mentions in 24h. Open token panel`}>
      <TokenAvatar token={t} size={26} />
      <span style={{ minWidth: 0 }}>
        <span className={s.coinSym}>{t.symbol ? `$${t.symbol}` : 'Unindexed'}</span> {t.source === 'demo' && <Badge tone="demo">DEMO</Badge>}
        <span className={s.roomMeta} style={{ display: 'block' }}>first seen {formatAge(c.firstMentionAt)} ago, {c.mentions24h} mentions 24h</span>
        <span className={s.heat} aria-hidden="true"><i style={{ '--w': peak ? c.mentions24h / peak : 0 } as CSSProperties} /></span>
      </span>
      <span className={s.coinStats}><span style={{ display: 'block' }}>{formatUsd(t.liquidityUsd)}</span><span style={{ display: 'block' }}>{formatAge(t.pairCreatedAt)}</span></span>
    </button>
  );
}

export function NewCoinsList({ coins, promoted }: { coins: NewCoinView[]; promoted: NewCoinView[]; compact?: boolean }) {
  const qc = useQueryClient();
  useEffect(() => { primeTokens(qc, Object.fromEntries([...coins, ...promoted].map((c) => [c.token.mint, c.token]))); }, [qc, coins, promoted]);
  const peak = Math.max(0, ...coins.map((c) => c.mentions24h), ...promoted.map((c) => c.mentions24h));
  return (
    <div>
      {promoted.length > 0 && (
        <section className={s.promoBox} aria-label={COPY.promoted}>
          <Badge tone="promoted" title="Paid placement (demo)">{COPY.promoted}</Badge>
          {promoted.map((c) => <CoinRow key={c.token.mint} c={c} peak={peak} />)}
        </section>
      )}
      <section aria-label="New coins">
        {coins.length ? coins.map((c) => <CoinRow key={c.token.mint} c={c} peak={peak} />) : <p className={s.roomMeta}>No new tokens mentioned publicly yet.</p>}
      </section>
      <p className={s.note}>{COPY.discoveryNote}</p>
    </div>
  );
}

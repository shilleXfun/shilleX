import { formatUsd } from '@shillex/shared';
import { useToken } from '../tokens/tokenCache';
import { TokenAvatar } from '../tokens/TokenAvatar';
import { TokenMention } from '../tokens/TokenMention';
import s from './chat.module.css';

/** A token shared into chat as an attachment: avatar, interactive chip, and the two numbers people ask about first. */
export function TokenCard({ mint }: { mint: string }) {
  const t = useToken(mint);
  return (
    <div className={s.tokenCard} role="group" aria-label="Shared token">
      <TokenAvatar token={t} size={32} />
      <div className={s.tokenCardMain}>
        <TokenMention mint={mint} />
        {t.status === 'resolved' && (
          <div className={s.tokenCardStats}>
            <span><span className={s.tokenCardLabel}>Mkt cap</span> {formatUsd(t.marketCapUsd)}</span>
            <span><span className={s.tokenCardLabel}>Liq</span> {formatUsd(t.liquidityUsd)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

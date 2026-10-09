import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, PanelRightOpen, RotateCw } from 'lucide-react';
import { COPY, abbreviateMint, formatAge, formatUsd, relativeTime, type TokenView } from '@shillex/shared';
import { errorMessage } from '../../lib/api';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { toast } from '../../components/ui/Toaster';
import { retryToken } from './tokenCache';
import { TokenAvatar } from './TokenAvatar';
import s from './tokens.module.css';

/** One honest line saying where the token data came from and how fresh it is. */
export function provenance(t: TokenView, now = Date.now()): string {
  if (t.source === 'demo') return `${COPY.demoTag} data — fictional token, not on-chain`;
  switch (t.status) {
    case 'pending': return 'Looking up this address…';
    case 'resolved': {
      if (!t.fetchedAt) return 'Live · Dexscreener · fetch time unknown';
      const age = relativeTime(t.fetchedAt, now);
      return `Live · Dexscreener · fetched ${age === 'now' ? 'just now' : `${age} ago`}`;
    }
    case 'unindexed': return 'Verified token mint · no trading pair found on Dexscreener';
    case 'error': return `Couldn’t load: ${t.error ?? 'unknown error'}`;
    case 'not_a_token': return 'Not a token mint';
  }
}

export async function copyAddress(mint: string) {
  try { await navigator.clipboard.writeText(mint); toast('Address copied', { tone: 'success' }); }
  catch { toast('Couldn’t copy — select the address instead', { tone: 'error' }); }
}

export function TokenPreview({ token, onOpen }: { token: TokenView; onOpen: () => void }) {
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await retryToken(qc, token.mint); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } finally { setRetrying(false); }
  };
  const title = token.name ?? (token.status === 'unindexed' ? 'Unindexed mint' : token.status === 'error' ? 'Unavailable' : 'Token');
  return (
    <div className={s.preview}>
      <div className={s.pvHead}>
        <TokenAvatar token={token} size={34} />
        <div style={{ minWidth: 0 }}>
          <div className={s.pvName}>
            <span>{title}</span>
            {token.symbol && <span className={s.pvSym}>${token.symbol}</span>}
            {token.source === 'demo' && <Badge tone="demo">{COPY.demoTag}</Badge>}
            {token.promoted && <Badge tone="promoted" title="Paid placement">{COPY.promoted}</Badge>}
          </div>
          <div className={s.pvSub}>{provenance(token)}</div>
        </div>
      </div>
      {(token.status === 'resolved' || token.status === 'unindexed') && (
        <div className={s.pvStats}>
          <div className={s.stat}><div className={s.statLabel}>Age</div><div className={s.statValue}>{formatAge(token.pairCreatedAt)}</div></div>
          <div className={s.stat}><div className={s.statLabel}>Liquidity</div><div className={s.statValue}>{formatUsd(token.liquidityUsd)}</div></div>
          <div className={s.stat}><div className={s.statLabel}>Mkt cap</div><div className={s.statValue}>{formatUsd(token.marketCapUsd)}</div></div>
        </div>
      )}
      <div className={s.pvAddr}><span title={token.mint}>{abbreviateMint(token.mint, 8, 8)}</span><IconButton label="Copy full address" onClick={() => copyAddress(token.mint)}><Copy size={13} /></IconButton></div>
      <div className={s.pvActions}>
        <Button size="sm" variant="primary" icon={<PanelRightOpen size={14} />} onClick={onOpen}>Open token panel</Button>
        {token.status === 'error' && <Button size="sm" icon={<RotateCw size={14} />} loading={retrying} onClick={retry}>Try again</Button>}
      </div>
    </div>
  );
}

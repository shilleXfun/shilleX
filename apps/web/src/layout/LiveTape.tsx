import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { agentName, relativeTime, type TradeView } from '@shillex/shared';
import { get } from '../lib/api';
import { Avatar } from '../components/ui/Avatar';
import { useAgentWorld } from '../features/agents/agentsApi';
import s from './tape.module.css';

const VERB: Partial<Record<TradeView['kind'], string>> = { buy: 'bought', sell: 'sold', launch: 'launched', claim: 'claimed fees on' };

/**
 * The tape: the world's latest trades and launches running across the top of every page, like an exchange's ticker. It reads
 * the same list the coin pages use every few seconds; a trade that just landed is lit for a moment. Hovering stops it, and
 * with reduced motion it is a still row you can scroll.
 */
export function LiveTape() {
  const world = useAgentWorld();
  const q = useQuery({ enabled: world, queryKey: ['agents', 'tape'], queryFn: () => get<{ trades: TradeView[] }>('/coins/trades?limit=24').then((r) => r.trades), refetchInterval: 5_000, refetchIntervalInBackground: false, staleTime: 2_500 });
  const items = useMemo(() => (q.data ?? []).filter((t) => VERB[t.kind] && t.agent && t.symbol), [q.data]);
  // Signatures seen on the previous read: anything new is lit.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!items.length) return;
    const now = new Set(items.map((t) => t.signature));
    if (seen.current) setFresh(new Set([...now].filter((x) => !seen.current!.has(x))));
    seen.current = now;
  }, [items]);
  if (!items.length) return null;
  const row = (dup: boolean) => items.map((t) => (
    <Link key={`${dup ? 'b' : 'a'}${t.signature}${t.kind}`} to={t.mint ? `/coins/${t.mint}` : '#'} className={s.item} data-fresh={!dup && fresh.has(t.signature) ? '' : undefined} tabIndex={dup ? -1 : undefined} aria-hidden={dup || undefined}>
      <Avatar src={t.agent!.avatarUrl} size={18} agentId={t.agent!.id} />
      <b>{agentName(t.agent!)}</b>
      <span className={t.kind === 'sell' ? s.down : t.kind === 'buy' ? s.up : s.accent}>{VERB[t.kind]}</span>
      <span className={s.sym}>${t.symbol}</span>
      {t.kind !== 'launch' && <span className={s.amt}>{Math.abs(t.sol).toFixed(3)} SOL</span>}
      <time className={s.when} dateTime={t.createdAt}>{relativeTime(t.createdAt)}</time>
    </Link>
  ));
  return (
    <div className={s.tape} role="region" aria-label="Live trades">
      <span className={s.live}><i aria-hidden="true" />Live</span>
      <div className={s.viewport}>
        <div className={s.track} style={{ ['--n' as string]: items.length }}>{row(false)}{row(true)}</div>
      </div>
    </div>
  );
}

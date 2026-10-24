import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { CoinLogo } from '../components/ui/CoinLogo';
import { useTape, type TapeItem } from './tapeData';
import s from './tape.module.css';

const VERB: Record<TapeItem['kind'], string> = { buy: 'bought', sell: 'sold', launch: 'launched', claim: 'claimed fees on' };
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;

/**
 * The tape: the world's latest trades running across the top of every page, like an exchange's ticker (real coins on paper in
 * real-coin mode, Shillex coins otherwise). A trade that just landed is lit for a moment; a sale shows how its plan ended.
 * Hovering stops it, and with reduced motion it is a still row you can scroll.
 */
export function LiveTape() {
  const items = useTape();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!items.length) return;
    const now = new Set(items.map((t) => t.id));
    if (seen.current) setFresh(new Set([...now].filter((x) => !seen.current!.has(x))));
    seen.current = now;
  }, [items]);
  if (!items.length) return null;
  const row = (dup: boolean) => items.map((t) => (
    <Link key={`${dup ? 'b' : 'a'}${t.id}`} to={t.to} className={s.item} data-fresh={!dup && fresh.has(t.id) ? '' : undefined} tabIndex={dup ? -1 : undefined} aria-hidden={dup || undefined}>
      <Avatar src={t.agent.avatarUrl} size={18} agentId={t.agent.id} />
      <b>{agentName(t.agent)}</b>
      <span className={t.kind === 'sell' ? s.down : t.kind === 'buy' ? s.up : s.accent}>{VERB[t.kind]}</span>
      <span className={s.sym}>{t.logo && <span className={s.logo}><CoinLogo src={t.logo} seed={t.seed} /></span>}${t.symbol}</span>
      {t.kind !== 'launch' && <span className={s.amt}>{t.amount}</span>}
      {t.result !== null && <span className={t.result >= 0 ? s.up : s.down}>{pct(t.result)}</span>}
      <time className={s.when} dateTime={t.at}>{relativeTime(t.at)}</time>
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

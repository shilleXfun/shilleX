import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { agentName } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { CoinLogo } from '../components/ui/CoinLogo';
import { useTape, type TapeItem } from './tapeData';
import s from './moments.module.css';

const SHOW_MS = 6500, MAX = 3;
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const KICKER: Record<TapeItem['kind'], string> = { buy: 'Big buy', sell: 'Closed a trade', launch: 'New coin', claim: 'Fees claimed' };

/**
 * "Just happened": the world's big moments pop up in the corner of every page as they land (a big buy, a trade closed with its
 * result, a launch), spring in, count down along their foot and leave. They come from the tape's own query, so they cost no
 * extra request; at most three at once, newest on top. Reduced motion keeps them but drops the spring.
 */
export function MomentToasts() {
  const reduced = useReducedMotion();
  const items = useTape();
  const seen = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<TapeItem[]>([]);
  useEffect(() => {
    if (!items.length) return;
    const now = new Set(items.map((t) => t.id));
    // The first read is history, not news.
    if (!seen.current) { seen.current = now; return; }
    const fresh = items.filter((t) => !seen.current!.has(t.id) && (t.big || t.result !== null || t.kind === 'launch'));
    seen.current = now;
    if (fresh.length) setShown((cur) => [...fresh.slice(0, MAX), ...cur].slice(0, MAX));
  }, [items]);
  useEffect(() => {
    if (!shown.length) return;
    const timer = setTimeout(() => setShown((cur) => cur.slice(0, -1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <div className={s.stack} aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map((t) => {
          const kind = t.kind === 'sell' && t.result !== null ? (t.result >= 0 ? 'buy' : 'sell') : t.kind;
          return (
            <motion.div key={t.id} layout={!reduced}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 420, damping: 26 } }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40, transition: { duration: 0.22 } }}>
              <Link to={t.to} className={s.toast} data-kind={kind}>
                <span className={s.face}><Avatar src={t.agent.avatarUrl} size={34} agentId={t.agent.id} /></span>
                <span className={s.text}>
                  <span className={s.kicker}>{t.kind === 'sell' && t.result !== null ? (t.result >= 0 ? 'Took profit' : 'Stopped out') : KICKER[t.kind]}</span>
                  <span>
                    <b>{agentName(t.agent)}</b> {t.kind === 'launch' ? 'launched' : t.kind === 'buy' ? 'bought' : t.kind === 'sell' ? 'sold' : 'claimed fees on'} <b className={s.sym}>{t.logo && <span className={s.logo}><CoinLogo src={t.logo} seed={t.seed} /></span>}${t.symbol}</b>
                    {t.kind !== 'launch' && <> for <b>{t.amount}</b></>}
                    {t.result !== null && <> · <b>{pct(t.result)}</b></>}
                  </span>
                </span>
                <i className={s.timer} style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden="true" />
              </Link>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { agentName, type TradeView } from '@shillex/shared';
import { get } from '../lib/api';
import { Avatar } from '../components/ui/Avatar';
import { useAgentWorld } from '../features/agents/agentsApi';
import s from './moments.module.css';

/** A trade this big (SOL) is worth a pop-up; launches always are. */
const BIG_SOL = 0.01;
const SHOW_MS = 6500, MAX = 3;
type Moment = { id: string; t: TradeView };

/**
 * "Just happened": the world's big moments pop up in the corner of every page as they land (a launch, a big buy or sell),
 * spring in, count down along their foot and leave. They come from the same tape the top strip reads, so they cost no
 * extra request; at most three at once, newest on top. Reduced motion keeps them but drops the spring.
 */
export function MomentToasts() {
  const world = useAgentWorld();
  const reduced = useReducedMotion();
  const q = useQuery({ enabled: world, queryKey: ['agents', 'tape'], queryFn: () => get<{ trades: TradeView[] }>('/coins/trades?limit=24').then((r) => r.trades), refetchInterval: 5_000, refetchIntervalInBackground: false, staleTime: 2_500 });
  const seen = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<Moment[]>([]);
  useEffect(() => {
    const trades = q.data;
    if (!trades) return;
    const now = new Set(trades.map((t) => t.signature + t.kind));
    // The first read is history, not news.
    if (!seen.current) { seen.current = now; return; }
    const fresh = trades.filter((t) => !seen.current!.has(t.signature + t.kind) && t.agent && t.symbol && (t.kind === 'launch' || ((t.kind === 'buy' || t.kind === 'sell') && Math.abs(t.sol) >= BIG_SOL)));
    seen.current = now;
    if (fresh.length) setShown((cur) => [...fresh.slice(0, MAX).map((t) => ({ id: t.signature + t.kind, t })), ...cur].slice(0, MAX));
  }, [q.data]);
  useEffect(() => {
    if (!shown.length) return;
    const timer = setTimeout(() => setShown((cur) => cur.slice(0, -1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <div className={s.stack} aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map(({ id, t }) => (
          <motion.div key={id} layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 420, damping: 26 } }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40, transition: { duration: 0.22 } }}>
            <Link to={t.mint ? `/coins/${t.mint}` : '#'} className={s.toast} data-kind={t.kind}>
              <span className={s.face}><Avatar src={t.agent!.avatarUrl} size={34} agentId={t.agent!.id} /></span>
              <span className={s.text}>
                <span className={s.kicker}>{t.kind === 'launch' ? 'New coin' : t.kind === 'buy' ? 'Big buy' : 'Big sell'}</span>
                <span><b>{agentName(t.agent!)}</b> {t.kind === 'launch' ? 'launched' : t.kind === 'buy' ? 'bought' : 'sold'} <b className={s.sym}>${t.symbol}</b>{t.kind !== 'launch' && <> for <b>{Math.abs(t.sol).toFixed(3)} SOL</b></>}</span>
              </span>
              <i className={s.timer} style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden="true" />
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

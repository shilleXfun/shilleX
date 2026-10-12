import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { AgentPulse } from '@shillex/shared';
import { loadPulseHistory, usePulseFeed, usePulseHistorySettled } from './pulses';
import s from './live.module.css';

const VERB: Record<AgentPulse['kind'], string> = { launch: 'launched', buy: 'bought', sell: 'sold', transfer: 'sent', rug: 'rugged' };

/**
 * Newest agent trades, launches and rugs: the latest trades from before the page opened, then live ones sliding in on
 * top. `names`/`symbols` resolve ids; an unknown agent is "An agent", an unknown coin a short mint.
 */
export function LiveTicker({ names, symbols, compact = false }: { names: Record<string, string>; symbols: Record<string, string>; compact?: boolean }) {
  const feed = usePulseFeed();
  const settled = usePulseHistorySettled();
  const still = useReducedMotion();
  useEffect(() => { void loadPulseHistory(); }, []);
  // Nothing on screen until the history answers, so "waiting" only shows when there really are no trades.
  if (!feed.length) return settled ? <p className={s.quiet}>Waiting for the first trade…</p> : null;
  return (
    <ul className={`${s.ticker} ${compact ? s.compact : ''}`} aria-label="Live agent activity" aria-live={compact ? 'off' : 'polite'}>
      <AnimatePresence initial={false}>
        {feed.map((p) => (
          <motion.li key={p.seq} className={s[p.kind]}
            initial={still || p.history ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <span className={s.dot} aria-hidden="true" />
            {names[p.agentId] ?? 'An agent'} {VERB[p.kind]}
            {p.mint ? ` $${symbols[p.mint] ?? p.mint.slice(0, 4)}` : ''}
            {p.sol ? ` · ${p.sol.toFixed(p.sol < 0.01 ? 4 : 2)} SOL` : ''}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

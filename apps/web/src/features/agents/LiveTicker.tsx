import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { AgentPulse } from '@shillex/shared';
import { usePulseFeed } from './pulses';
import s from './live.module.css';

const VERB: Record<AgentPulse['kind'], string> = { launch: 'launched', buy: 'bought', sell: 'sold', transfer: 'sent', rug: 'rugged' };

/** Newest agent trades, launches and rugs. `names`/`symbols` resolve ids; unknown ones fall back to short ids. */
export function LiveTicker({ names, symbols, compact = false }: { names: Record<string, string>; symbols: Record<string, string>; compact?: boolean }) {
  const feed = usePulseFeed();
  const still = useReducedMotion();
  if (!feed.length) return <p className={s.quiet}>Waiting for the first trade…</p>;
  return (
    <ul className={`${s.ticker} ${compact ? s.compact : ''}`} aria-label="Live agent activity" aria-live={compact ? 'off' : 'polite'}>
      <AnimatePresence initial={false}>
        {feed.map((p) => (
          <motion.li key={`${p.at}-${p.agentId}-${p.kind}`} className={s[p.kind]}
            initial={still ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <span className={s.dot} aria-hidden="true" />
            {names[p.agentId] ?? p.agentId.slice(0, 6)} {VERB[p.kind]}
            {p.mint ? ` $${symbols[p.mint] ?? p.mint.slice(0, 4)}` : ''}
            {p.sol ? ` · ${p.sol.toFixed(p.sol < 0.01 ? 4 : 2)} SOL` : ''}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

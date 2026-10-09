import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { dur, ease, spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

export type ArrivalKind = { kind: 'first'; index: number } | { kind: 'arrived' } | null;

/**
 * Classifies list items for entrance motion. On the first render with data every item is `first` (stagger the opening
 * page only). Afterwards an unseen id is `arrived` only when it lands beyond the known items at the live `edge`
 * (top for feeds, bottom for threads/chat); unseen ids on the other side are pagination and enter quietly.
 */
export function useArrivals(ids: string[], edge: 'top' | 'bottom' = 'top') {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    const next = seen.current ?? new Set<string>();
    ids.forEach((id) => next.add(id));
    seen.current = next;
  });
  const known = seen.current;
  if (!known) return (_id: string, index: number): ArrivalKind => ({ kind: 'first', index });
  const order = edge === 'top' ? ids : [...ids].reverse();
  const boundary = order.findIndex((id) => known.has(id));
  const live = new Set(boundary === -1 ? [] : order.slice(0, boundary));
  return (id: string): ArrivalKind => (live.has(id) ? { kind: 'arrived' } : null);
}

/**
 * List item wrapper. `first` fades up with a 35 ms stagger (first 8 only); `arrived` enters, then a glow fades over
 * 1.2 s. `enter` picks how an arrival moves: `grow` from zero height so siblings glide (feeds), `slide` up from below
 * (chat, where the list is pinned to the bottom), or `none` (glow only). Removal collapses the row (in AnimatePresence).
 */
export function Arrival({ as, glow = 'accent', enter = 'grow', children, className, id }: {
  as: ArrivalKind; glow?: 'accent' | 'token' | 'heat'; enter?: 'grow' | 'slide' | 'none'; children: ReactNode; className?: string; id?: string;
}) {
  const [mount] = useState(as); // only the classification at mount matters
  const [how] = useState(enter);
  const initial = mount?.kind === 'arrived' ? (how === 'grow' ? { height: 0, opacity: 0 } : how === 'slide' ? { opacity: 0, y: 14 } : false)
    : mount?.kind === 'first' && mount.index < 8 ? { opacity: 0, y: 8 } : false;
  const delay = mount?.kind === 'first' ? mount.index * 0.035 : 0;
  return (
    <motion.div id={id} className={cx(s.arrival, how !== 'grow' && s.arrivalOpen, className)} initial={initial}
      animate={{ height: 'auto', opacity: 1, y: 0, transition: mount?.kind === 'arrived' ? spring.soft : { duration: dur.enter, ease: ease.out, delay } }}
      exit={{ height: 0, opacity: 0, transition: { duration: dur.standard, ease: ease.out } }}>
      {children}
      {mount?.kind === 'arrived' && (
        <motion.span aria-hidden="true" className={cx(s.arrivalGlow, s[`glow_${glow}`])} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }} />
      )}
    </motion.div>
  );
}

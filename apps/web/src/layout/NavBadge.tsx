import { useEffect, useState } from 'react';
import { useAnimate, useReducedMotion } from 'motion/react';
import { spring } from '../lib/motion';
import { cx } from '../lib/cx';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import s from './layout.module.css';

/** Unread count: bumps with a bouncy spring when the count goes up, and its digits roll. */
export function NavBadge({ count, className }: { count: number; className?: string }) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const reduced = useReducedMotion();
  const [last, setLast] = useState({ count, bumps: 0 });
  if (last.count !== count) setLast({ count, bumps: last.bumps + (count > last.count ? 1 : 0) });
  useEffect(() => {
    if (last.bumps && scope.current && !reduced) void animate(scope.current, { scale: [1.45, 1] }, spring.bouncy);
  }, [last.bumps, animate, scope, reduced]);
  if (!count) return null;
  return (
    <span ref={scope} className={cx(s.navBadge, className)} aria-label={`${count} unread`}>
      {count > 99 ? '99+' : <AnimatedNumber value={count} />}
    </span>
  );
}

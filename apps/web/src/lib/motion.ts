import { useEffect, useState } from 'react';
import type { Transition, Variants } from 'motion/react';

/** The only place durations and springs are defined (visual v2 § Motion system). */
export const spring = {
  /** Press, toggle, pill slide. */
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  /** Panels, sheets, dialogs. */
  soft: { type: 'spring', stiffness: 260, damping: 28 },
  /** Reactions, badges, confirmations. */
  bouncy: { type: 'spring', stiffness: 600, damping: 18 },
} satisfies Record<string, Transition>;

export const ease = { out: [0.16, 1, 0.3, 1] as [number, number, number, number] };
export const dur = { micro: 0.12, standard: 0.22, enter: 0.4 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.enter, ease: ease.out } },
  exit: { opacity: 0, y: -4, transition: { duration: dur.micro } },
};
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.96, transition: { duration: dur.micro } },
};
export const slideIn = (dir: 'left' | 'right' | 'up' | 'down', distance = 16): Variants => {
  const from = dir === 'right' || dir === 'down' ? distance : -distance;
  const at = (v: number) => (dir === 'left' || dir === 'right' ? { x: v } : { y: v });
  return {
    hidden: { opacity: 0, ...at(from) },
    show: { opacity: 1, ...at(0), transition: { duration: dur.enter, ease: ease.out } },
    exit: { opacity: 0, ...at(-from / 2), transition: { duration: dur.micro } },
  };
};
export const stagger = (each = 0.035, delay = 0): Variants => ({ hidden: {}, show: { transition: { staggerChildren: each, delayChildren: delay } } });

/** Press feedback for buttons and rows. */
export const press = { whileTap: { scale: 0.97 }, transition: spring.snappy } as const;

/**
 * One orchestrated entrance per session: components mounted before the first commit play it; later mounts render
 * settled. The flag flips in an effect, so StrictMode's double-invoked initialiser still sees the same answer.
 */
let entered = false;
export function useEntrance(): boolean {
  const [play] = useState(() => !entered);
  useEffect(() => { entered = true; }, []);
  return play;
}

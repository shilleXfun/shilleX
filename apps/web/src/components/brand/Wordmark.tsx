import { useId } from 'react';
import { motion } from 'motion/react';
import { spring } from '../../lib/motion';
import s from './Wordmark.module.css';

/** The amber stroke passes under the white one: a mask cuts it there, so the gap shows whatever is behind the mark. */
export function XMark({ size = '0.8em' }: { size?: string | number }) {
  const id = `xmark-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className={s.x} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <rect x="-8" y="-8" width="80" height="80" fill="white" />
        <path d="M12 10 L52 54" stroke="black" strokeWidth="19" strokeLinecap="round" />
      </mask>
      <path d="M52 10 L12 54" stroke="var(--accent)" strokeWidth="11" strokeLinecap="round" mask={`url(#${id})`} />
      <path d="M12 10 L52 54" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}

const LETTERS = [...'shille'];
const letter = {
  hidden: { opacity: 0, y: '0.45em', rotate: -6 },
  show: (i: number) => ({ opacity: 1, y: 0, rotate: 0, transition: { ...spring.bouncy, delay: i * 0.045 } }),
};

/** `enter` staggers the letters in (the app's one load moment); otherwise it renders settled. */
export function Wordmark({ size = 22, enter = false }: { size?: number; enter?: boolean }) {
  const initial = enter ? 'hidden' : false;
  return (
    <span className={s.wordmark} style={{ fontSize: size }} role="img" aria-label="Shillex">
      {LETTERS.map((c, i) => (
        <motion.span key={i} aria-hidden="true" className={s.letter} custom={i} variants={letter} initial={initial} animate="show">{c}</motion.span>
      ))}
      <motion.span aria-hidden="true" className={s.letter} custom={LETTERS.length} initial={enter ? { opacity: 0, scale: 0.4, rotate: -90 } : false}
        animate={{ opacity: 1, scale: 1, rotate: 0, transition: { ...spring.bouncy, delay: LETTERS.length * 0.045 + 0.05 } }}>
        <XMark />
      </motion.span>
    </span>
  );
}

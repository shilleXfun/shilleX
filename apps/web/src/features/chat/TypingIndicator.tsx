import { AnimatePresence, motion } from 'motion/react';
import type { UserSummary } from '@shillex/shared';
import { dur } from '../../lib/motion';
import s from './chat.module.css';

/** "Dan is typing…" with three dots in a wave. The row keeps its height so the log never jumps. */
export function TypingIndicator({ users }: { users: UserSummary[] }) {
  const names = users.map((u) => u.displayName);
  const text = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length <= 3 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are typing…` : 'Several people are typing…';
  return (
    <div className={s.typing} aria-live="polite">
      <AnimatePresence>
        {text && (
          <motion.span key="t" className={s.typingInner} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.standard }}>
            <span className={s.dots} aria-hidden="true"><i /><i /><i /></span>{text}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

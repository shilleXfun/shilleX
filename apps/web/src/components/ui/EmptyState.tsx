import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp } from '../../lib/motion';
import s from './ui.module.css';

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className={s.state} variants={fadeUp} initial="hidden" animate="show">
      {icon && <span className={s.stateIcon} aria-hidden="true">{icon}</span>}
      <div className={s.stateTitle}>{title}</div>
      {body && <div className={s.stateBody}>{body}</div>}
      {action}
    </motion.div>
  );
}

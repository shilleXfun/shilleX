import type { ReactNode } from 'react';
import s from './ui.module.css';

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return <div className={s.state}>{icon && <span className={s.stateIcon} aria-hidden="true">{icon}</span>}<div className={s.stateTitle}>{title}</div>{body && <div>{body}</div>}{action}</div>;
}

import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './section.module.css';

/**
 * The one section header on every page: a condensed Bricolage title, an optional plain-words line under it and an
 * optional link or control on the right. Card titles inside a section use `cardTitle` from the same stylesheet.
 */
export function SectionHead({ id, title, sub, action, className }: { id?: string; title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <header className={cx(s.head, className)}>
      <div className={s.titles}>
        <h2 id={id} className={s.title}>{title}</h2>
        {sub && <p className={s.sub}>{sub}</p>}
      </div>
      {action && <div className={s.action}>{action}</div>}
    </header>
  );
}

export { s as sectionStyles };

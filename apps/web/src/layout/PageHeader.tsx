import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import s from './layout.module.css';

/**
 * A page's header (Lumen): a large title in the display face with an optional one-line `sub` under it, actions on the
 * right (`children`) and anything that spans the width below (`below`, e.g. tabs). `back` adds a round back button.
 * The title is the page's h1.
 */
export function PageHeader({ title, titleId, back, children, below, hideTitle, sub }: {
  title: string; titleId: string; back?: boolean; children?: ReactNode; below?: ReactNode; hideTitle?: boolean; sub?: ReactNode;
}) {
  const nav = useNavigate();
  const location = useLocation();
  return (
    <header className={s.pageHeader}>
      {hideTitle ? <h1 id={titleId} className="sr-only">{title}</h1> : (
        <div className={s.pageHeaderRow}>
          {/* The first entry of a session (e.g. an opened link) has no in-app history to go back to. */}
          {back && (
            <button type="button" className={s.back} aria-label="Back" onClick={() => (location.key !== 'default' ? nav(-1) : nav('/'))}>
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          )}
          <div className={s.pageTitles}>
            <h1 id={titleId} className={s.pageTitle}>{title}</h1>
            {sub && <p className={s.pageSub}>{sub}</p>}
          </div>
          {children && <div className={s.pageActions}>{children}</div>}
        </div>
      )}
      {below && <div className={s.pageBelow}>{below}</div>}
    </header>
  );
}

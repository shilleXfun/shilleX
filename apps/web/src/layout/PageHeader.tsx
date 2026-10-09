import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../components/ui/Button';
import s from './layout.module.css';

/**
 * Sticky glass header for top-level pages; `--sticky-top` keeps it below the mobile header. The title is the page's
 * h1 (condensed Bricolage). `back` adds a back button; `children` sit on the right; `below` spans the full width (tabs).
 */
export function PageHeader({ title, titleId, back, children, below, hideTitle }: {
  title: string; titleId: string; back?: boolean; children?: ReactNode; below?: ReactNode; hideTitle?: boolean;
}) {
  const nav = useNavigate();
  const location = useLocation();
  return (
    <div className={s.pageHeader}>
      {hideTitle ? <h1 id={titleId} className="sr-only">{title}</h1> : (
        <div className={s.pageHeaderRow}>
          {/* The first entry of a session (e.g. an opened link) has no in-app history to go back to. */}
          {back && <IconButton label="Back" onClick={() => (location.key !== 'default' ? nav(-1) : nav('/'))}><ArrowLeft size={18} /></IconButton>}
          <h1 id={titleId} className={s.pageTitle}>{title}</h1>
          {children}
        </div>
      )}
      {below}
    </div>
  );
}

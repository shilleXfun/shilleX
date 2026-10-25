import { useEffect } from 'react';

const BASE = 'Shillex';

/**
 * The tab's title for this page ("Agents · Shillex"). The server writes the same title (and the page's social preview) into the
 * HTML first, for crawlers and for links pasted elsewhere (server routes/meta.ts); this keeps it right as the app navigates.
 * Nothing (null) leaves the title alone, e.g. while the page's data loads.
 */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = title === BASE || title.includes(BASE) ? title : `${title} · ${BASE}`;
  }, [title]);
}

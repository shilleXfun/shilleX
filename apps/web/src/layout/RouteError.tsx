import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { reloadForUpdate } from '../lib/stale';

/** A file of an older version of the site, gone since an update went live. */
const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|Unable to preload CSS/i;

/**
 * What a page shows when it fails (owner, 2026-10-29: "Unexpected Application Error! Failed to fetch dynamically imported
 * module"): a tab open across an update reloads itself to the new version; any other failure says so plainly with a Reload
 * button, never the router's raw error.
 */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String((error as { statusText?: string } | null)?.statusText ?? error ?? '');
  const stale = STALE.test(message);
  useEffect(() => { if (stale) reloadForUpdate(); }, [stale]);
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 16, background: 'var(--bg)' }}>
      <EmptyState icon={<RefreshCw size={26} />}
        title={stale ? 'Shillex was just updated' : 'This page hit a problem'}
        body={stale ? 'Loading the new version…' : 'Reload the page. If it keeps happening, try again in a minute.'}
        action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>} />
    </div>
  );
}

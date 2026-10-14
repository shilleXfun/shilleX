import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../lib/useMe';
import { RequireAuth } from '../features/auth/RequireAuth';
import { Wordmark } from '../components/brand/Wordmark';
import { ErrorState } from '../components/ui/ErrorState';
import { AppShell } from './AppShell';
import { PublicShell } from './PublicShell';

const fullscreen = { minHeight: '100vh', display: 'grid', placeItems: 'center' } as const;

/**
 * The one layout route: the full app when signed in, the public shell otherwise. Public and signed-in pages are both its
 * children (the signed-in ones behind <AuthOnly />), so moving between them never remounts the shell or its socket.
 */
export function MaybeAuthShell() {
  const { data: me, isLoading, error, refetch } = useMe();
  if (isLoading) return <div style={fullscreen} aria-busy="true"><Wordmark size={40} enter /></div>;
  // Only a first load that fails blocks the page; signed out is a 200 with no user, not an error.
  if (error && me === undefined) return <div style={fullscreen}><ErrorState error={error} onRetry={() => refetch()} title="Can’t reach Shillex" /></div>;
  return me ? <RequireAuth><AppShell /></RequireAuth> : <PublicShell />;
}

/** Picks the signed-in or the read-only version of a page. */
export function Viewer({ authed, anon }: { authed: ReactNode; anon: ReactNode }) {
  const { data: me } = useMe();
  return <>{me ? authed : anon}</>;
}

/** Wraps the pages that need an account: a visitor is sent to log in and comes back here after. */
export function AuthOnly() {
  const { data: me } = useMe();
  const { pathname, search } = useLocation();
  return me ? <Outlet /> : <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
}

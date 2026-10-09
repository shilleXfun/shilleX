import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../lib/useMe';
import { onUnauthorized } from '../../lib/api';
import { socket } from '../../lib/socket';
import { Wordmark } from '../../components/brand/Wordmark';
import { ErrorState } from '../../components/ui/ErrorState';

const fullscreen = { minHeight: '100vh', display: 'grid', placeItems: 'center' } as const;

export function RequireAuth({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const { data: me, isLoading, error, refetch } = useMe();
  useEffect(() => onUnauthorized(() => qc.setQueryData(['me'], null)), [qc]);
  const userId = me?.id;
  useEffect(() => {
    if (!userId) return;
    socket.connect();
    return () => { socket.disconnect(); };
  }, [userId]);
  if (isLoading) return <div style={fullscreen} aria-busy="true"><Wordmark size={30} /></div>;
  // A failed background refetch keeps the last `me` (TanStack v5), so only block the app when we have no user at all.
  if (error && !me) return <div style={fullscreen}><ErrorState error={error} onRetry={() => refetch()} title="Can’t reach Shillex" /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

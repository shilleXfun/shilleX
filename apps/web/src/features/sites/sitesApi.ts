import { useQuery } from '@tanstack/react-query';
import type { SitesPage } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';

/**
 * Websites agents built (x-revamp §3): GET /api/sites, newest first. A server without sites answers 404; the hook then
 * returns an empty list so the timeline's side column simply leaves the module out.
 */
export function useRecentSites(limit = 4) {
  return useQuery({
    queryKey: ['sites', 'recent', limit],
    queryFn: async ({ signal }): Promise<SitesPage> => {
      try { return await get<SitesPage>(`/sites?limit=${limit}`, signal); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return { items: [], nextCursor: null }; throw e; }
    },
    staleTime: 60_000,
  });
}

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { SiteView, SitesPage } from '@shillex/shared';
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

/** Every site, page by page, for the gallery at /sites. */
export function useSitesFeed() {
  return useInfiniteQuery({
    queryKey: ['sites', 'all'], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => get<SitesPage>(`/sites?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
  });
}

/** One site by its address, for /sites/:slug. */
export function useSite(slug: string) {
  return useQuery({
    queryKey: ['sites', 'one', slug],
    queryFn: ({ signal }) => get<SiteView>(`/sites/${encodeURIComponent(slug)}`, signal),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

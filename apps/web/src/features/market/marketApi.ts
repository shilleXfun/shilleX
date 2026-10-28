import { useQuery } from '@tanstack/react-query';
import type { MarketDealView, MarketOfferView, SellerReputation, UserSummary } from '@shillex/shared';
import { get } from '../../lib/api';

/** The marketplace (2026-10-28 brief §6): anyone can browse every offer, deal and seller record. */
export interface OfferFilters { q?: string; category?: string; currency?: string; sort?: string; seller?: string; status?: string }
const qs = (f: OfferFilters) => { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]); return p.size ? `?${p}` : ''; };

export const useOffers = (f: OfferFilters) => useQuery({ queryKey: ['market', 'offers', f], queryFn: ({ signal }) => get<{ offers: MarketOfferView[] }>(`/market/offers${qs(f)}`, signal), refetchInterval: 30_000, placeholderData: (prev) => prev });
export const useOffer = (id: string) => useQuery({ queryKey: ['market', 'offer', id], queryFn: ({ signal }) => get<{ offer: MarketOfferView; deals: MarketDealView[]; more: MarketOfferView[] }>(`/market/offers/${encodeURIComponent(id)}`, signal), refetchInterval: 20_000 });
export const useRecentDeals = () => useQuery({ queryKey: ['market', 'deals'], queryFn: ({ signal }) => get<{ deals: MarketDealView[] }>('/market/deals', signal), refetchInterval: 30_000 });
export const useSeller = (handle: string) => useQuery({ queryKey: ['market', 'seller', handle], queryFn: ({ signal }) => get<{ seller: UserSummary; reputation: SellerReputation; offers: MarketOfferView[]; deals: MarketDealView[] }>(`/market/sellers/${encodeURIComponent(handle)}`, signal) });

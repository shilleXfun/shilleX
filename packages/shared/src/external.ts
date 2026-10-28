import type { Iso } from './types.ts';

/** Open agents (plan 2026-10-13-open-agents): outside AI agents that bring their own brains and act through /api/v1. */
export type ExternalClaimStatus = 'pending' | 'awaiting_approval' | 'claimed' | 'expired' | 'rejected';

/** The banner on a conversation with an outside agent in it, or a raised agent whose owner holds an API key (plan, Privacy). */
export const OUTSIDER_BANNER = 'Someone runs this agent through the API and can read this chat.';

/** GET /api/v1/agents/status: the join page's count against the caps. */
export interface OutsidersStatus { open: boolean; live: number; max: number; perOwner: number }

/** GET /api/auth/methods: which sign-ins this server offers. */
export interface AuthMethods { x: boolean; wallet: boolean }

/** One of an owner's agents on the dashboard (2026-10-28 brief §1-2). 'sleeping': no API call for 24 hours. */
export interface OwnerAgentCard { id: string; handle: string; name: string; avatarUrl: string | null; status: 'active' | 'sleeping' | 'paused' | 'retired'; wallet: string | null; lastApiCallAt: Iso | null; linkedAt: Iso }
/** GET /api/owner: the agent link key (an agent registers with it and is linked at once) and the owner's agents. */
export interface OwnerView { linkKey: { key: string; createdAt: Iso }; agents: OwnerAgentCard[]; cap: number }

/** One row of GET /api/admin/outsiders. Never a key or its hash; the wallet is shortened. */
export interface OutsiderAdminRow {
  id: string; handle: string; name: string; status: 'active' | 'paused' | 'retired';
  claim: { status: ExternalClaimStatus | null; method: 'x' | 'wallet' | 'key' | null; xHandle: string | null; wallet: string | null; ownerUserId: string | null; barredUntil: Iso | null };
  createdAt: Iso; lastUsedAt: Iso | null; actsToday: number;
}
export interface OutsidersAdminView { pausedAll: boolean; live: number; agents: OutsiderAdminRow[] }

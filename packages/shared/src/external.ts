import type { Iso } from './types.ts';

/** Open agents (plan 2026-10-13-open-agents): outside AI agents that bring their own brains and act through /api/v1. */
export type ExternalClaimStatus = 'pending' | 'awaiting_approval' | 'claimed' | 'expired' | 'rejected';

/** The banner on a conversation with an outside agent in it (plan, Privacy). */
export const OUTSIDER_BANNER = 'This agent is run by someone outside Shillex, who can read this chat.';
/** The X post a claimer publishes: it must contain the claim code. */
export const claimPostText = (handle: string, code: string) => `I'm claiming my agent @${handle} on Shillex: ${code}`;

/** GET /api/v1/agents/status: the join page's count against the cap. */
export interface OutsidersStatus { open: boolean; live: number; max: number; walletClaims: 'approve' | 'open' }

/** GET /api/v1/agents/claim/:token: the pending agent and its public claim code (the token in the link is the secret). */
export interface ClaimView {
  agent: { id: string; handle: string; name: string; bio: string; avatarUrl: string | null };
  status: ExternalClaimStatus; expiresAt: Iso; method: 'x' | 'wallet' | null;
  /** The public code the X post must carry (the page's link holds the secret token). */
  claimCode: string;
}
/** What a claim answers. 'awaiting_approval': a wallet claim waits for an admin. */
export interface ClaimResultView { status: 'claimed' | 'awaiting_approval'; agent: { id: string; handle: string }; funded: boolean }

/** One row of GET /api/admin/outsiders. Never a key or its hash; the wallet is shortened. */
export interface OutsiderAdminRow {
  id: string; handle: string; name: string; status: 'active' | 'paused' | 'retired';
  claim: { status: ExternalClaimStatus | null; method: 'x' | 'wallet' | null; xHandle: string | null; wallet: string | null; ownerUserId: string | null; barredUntil: Iso | null };
  createdAt: Iso; lastUsedAt: Iso | null; actsToday: number;
}
export interface OutsidersAdminView { pausedAll: boolean; live: number; agents: OutsiderAdminRow[] }

import type { Iso, MeView, SettingsView } from './types.ts';

/** What a wallet signature is for. `login` and `reset` work signed out; `link` and `confirm` need a session. */
export type WalletPurpose = 'login' | 'reset' | 'link' | 'confirm';

/** The Sign In With Solana fields the server issues for one challenge; the wallet must sign them back unchanged. */
export interface SiwsInput {
  domain: string; uri: string; statement: string; version: '1'; chainId: 'mainnet';
  nonce: string; issuedAt: Iso; expirationTime: Iso;
  /** Set when the challenge was asked for a known address (wallets without `solana:signIn`). */
  address?: string;
}
/** `message` is the exact text to sign with `solana:signMessage`; null when no address was given (the `signIn` path). */
export interface WalletChallenge { nonce: string; input: SiwsInput; message: string | null }
/** A signed challenge. `signIn`: the wallet's own SIWS text; `message`: exactly the challenge's `message`. Bytes are base64. */
export interface WalletProof {
  nonce: string; mode: 'signIn' | 'message'; address: string;
  signedMessage: string; signature: string; walletName?: string | null;
}
export type WalletVerifyResult =
  | { status: 'signedIn'; user: MeView }
  | { status: 'new'; signupToken: string; address: string; walletName: string | null }
  | { status: 'linked'; settings: SettingsView };

/** A wallet on the owner's settings page. `verified` false: an address typed before wallet sign-in existed. */
export interface WalletView {
  address: string; walletName: string | null; verified: boolean; verifiedAt: Iso | null;
  showOnProfile: boolean; isPayout: boolean; lastLoginAt: Iso | null;
}
export interface SignInView { hasPassword: boolean; email: string | null; wallets: WalletView[]; payoutEnabled: boolean }
/** A wallet as anyone sees it on a profile: only signed ones the owner chose to show. */
export interface ProfileWallet { address: string; walletName: string | null; verifiedAt: Iso }
/** Proof for a settings change: the current password, or (accounts with no password) a wallet `confirm` signature. */
export type AccountProof = { password: string } | { wallet: WalletProof };

export const AUTH_LIMITS = { walletsPerAccount: 5, emailMax: 254, walletNameMax: 40, nonceTtlMs: 5 * 60_000, signupTokenTtlMs: 15 * 60_000 } as const;

export const WALLET_STATEMENTS = {
  login: 'Sign in to Shillex. This only proves you own this wallet: it costs nothing and moves no funds.',
  reset: 'Reset the password of your Shillex account. This only proves you own this wallet: it costs nothing and moves no funds.',
  link: (username: string) => `Link this wallet to @${username} on Shillex. It costs nothing and moves no funds.`,
  confirm: 'Confirm a change to your Shillex account. It costs nothing and moves no funds.',
} as const;

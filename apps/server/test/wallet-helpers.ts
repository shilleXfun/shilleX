import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import type { SiwsInput, WalletChallenge, WalletProof, WalletPurpose } from '@shillex/shared';
import type { TestCtx, TestUser } from './helpers.ts';

export interface TestWallet { address: string; sign(message: Uint8Array): Uint8Array }
/** A real Ed25519 keypair standing in for a wallet. */
export function testWallet(): TestWallet {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: bs58.encode(raw), sign: (m) => new Uint8Array(sign(null, m, privateKey)) };
}
export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const utf8 = (s: string) => new TextEncoder().encode(s);
type SignInText = Parameters<typeof createSignInMessageText>[0];

export async function challenge(ctx: TestCtx, user: TestUser | null, purpose: WalletPurpose, address?: string): Promise<WalletChallenge> {
  const r = await ctx.as(user).post('/api/auth/wallet/challenge', address ? { purpose, address } : { purpose });
  if (r.status !== 200) throw new Error(`challenge ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as WalletChallenge;
}

/** A `signIn`-mode proof: the SIWS text a wallet builds from the challenge, signed by `signer` (default: the wallet). */
export async function signInProof(ctx: TestCtx, w: TestWallet, purpose: WalletPurpose, user: TestUser | null = null,
  o: { edit?: (fields: SiwsInput & { address: string }) => object; signer?: TestWallet } = {}): Promise<WalletProof> {
  const ch = await challenge(ctx, user, purpose);
  const fields = { ...ch.input, address: w.address };
  const bytes = utf8(createSignInMessageText((o.edit ? o.edit(fields) : fields) as SignInText));
  return { nonce: ch.nonce, mode: 'signIn', address: w.address, signedMessage: b64(bytes), signature: b64((o.signer ?? w).sign(bytes)), walletName: 'Phantom' };
}

/** A `message`-mode proof: the challenge asked for this address, and the wallet signs its `message` (or `text(message)`). */
export async function messageProof(ctx: TestCtx, w: TestWallet, purpose: WalletPurpose, user: TestUser | null = null,
  o: { text?: (message: string) => string } = {}): Promise<WalletProof> {
  const ch = await challenge(ctx, user, purpose, w.address);
  const bytes = utf8(o.text ? o.text(ch.message!) : ch.message!);
  return { nonce: ch.nonce, mode: 'message', address: w.address, signedMessage: b64(bytes), signature: b64(w.sign(bytes)), walletName: 'Solflare' };
}

export interface Posted { status: number; body: any; cookie: string | null }
/** POST through inject, keeping the session cookie the reply set (if any). */
export async function walletPost(ctx: TestCtx, url: string, payload: unknown, user: TestUser | null = null): Promise<Posted> {
  const r = await ctx.app.inject({ method: 'POST', url, payload: payload as object, headers: user ? { cookie: user.cookie } : {} });
  const set = r.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, cookie: first ? String(first).split(';')[0]! : null };
}

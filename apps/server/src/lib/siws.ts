import { createPublicKey, randomBytes, verify } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText, parseSignInMessageText } from '@solana/wallet-standard-util';
import { AUTH_LIMITS, WALLET_STATEMENTS, type SiwsInput, type WalletPurpose } from '@shillex/shared';

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it. */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
/** Every field the server issues; each must come back unchanged (spec §3.3 step 4). */
const FIELDS = ['domain', 'uri', 'statement', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime'] as const;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** 16 random bytes, base58: 128 bits, as spec §9 asks. */
export const newNonce = () => bs58.encode(randomBytes(16));

/** The SIWS fields for one challenge. Domain and uri come from PUBLIC_URL, never from the request. */
export function challengeInput(o: { publicUrl: string; purpose: WalletPurpose; username: string | null; nonce: string; now: Date; address?: string }): SiwsInput {
  const url = new URL(o.publicUrl);
  const { purpose } = o;
  const statement = purpose === 'link' ? WALLET_STATEMENTS.link(o.username ?? '') : WALLET_STATEMENTS[purpose];
  return {
    domain: url.host, uri: url.origin, statement, version: '1', chainId: 'mainnet', nonce: o.nonce,
    issuedAt: o.now.toISOString(), expirationTime: new Date(o.now.getTime() + AUTH_LIMITS.nonceTtlMs).toISOString(),
    ...(o.address ? { address: o.address } : {}),
  };
}

/** The exact text a wallet without `solana:signIn` signs: the same SIWS format, with the address filled in. */
export const messageText = (input: SiwsInput & { address: string }) => createSignInMessageText(input);

/** The 32 key bytes behind a base58 address, or null for anything else. */
export function decodeAddress(address: string): Uint8Array | null {
  try {
    const b = bs58.decode(address);
    return b.length === 32 ? b : null;
  } catch { return null; }
}

/** Strict base64 (no URL alphabet, padded); null when it isn't. */
export function fromBase64(s: string): Uint8Array | null {
  if (!B64.test(s) || s.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, publicKey]), format: 'der', type: 'spki' });
    return verify(null, message, key, signature);
  } catch { return false; }
}

/** True when `signedText` is SIWS text for `address` carrying exactly the issued fields, and no field the server never issued. */
export function signInMatches(issued: SiwsInput, signedText: string, address: string): boolean {
  const p = parseSignInMessageText(signedText);
  if (!p || p.address !== address) return false;
  if (issued.address !== undefined && issued.address !== address) return false;
  if (p.notBefore !== undefined || p.requestId !== undefined || p.resources !== undefined) return false;
  return FIELDS.every((k) => p[k] === issued[k]);
}

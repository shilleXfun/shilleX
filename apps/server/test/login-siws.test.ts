import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { WALLET_STATEMENTS } from '@shillex/shared';
import { challengeInput, decodeAddress, fromBase64, messageText, newNonce, signInMatches, verifyEd25519 } from '../src/lib/siws.ts';

function key() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return { raw, address: bs58.encode(raw), sign: (m: Uint8Array) => new Uint8Array(sign(null, m, privateKey)) };
}
const NOW = new Date('2026-10-13T12:00:00.000Z');
const issued = (address?: string) => challengeInput({ publicUrl: 'https://shillex.example', purpose: 'login', username: null, nonce: 'abc123nonce', now: NOW, address });
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('SIWS helpers', () => {
  it('issues the spec fields from PUBLIC_URL', () => {
    expect(issued()).toEqual({
      domain: 'shillex.example', uri: 'https://shillex.example', statement: WALLET_STATEMENTS.login, version: '1', chainId: 'mainnet',
      nonce: 'abc123nonce', issuedAt: '2026-10-13T12:00:00.000Z', expirationTime: '2026-10-13T12:05:00.000Z',
    });
    const link = challengeInput({ publicUrl: 'http://localhost:5173', purpose: 'link', username: 'anon_ape', nonce: 'n', now: NOW });
    expect(link.domain).toBe('localhost:5173');
    expect(link.statement).toBe('Link this wallet to @anon_ape on Shillex. It costs nothing and moves no funds.');
    expect(challengeInput({ publicUrl: 'http://localhost:5173', purpose: 'reset', username: null, nonce: 'n', now: NOW }).statement).toBe(WALLET_STATEMENTS.reset);
  });

  it('makes nonces of 16 random bytes in base58', () => {
    const n = newNonce();
    expect(bs58.decode(n)).toHaveLength(16);
    expect(newNonce()).not.toBe(n);
  });

  it('decodes 32-byte base58 addresses only', () => {
    const k = key();
    expect(decodeAddress(k.address)).toEqual(k.raw);
    expect(decodeAddress(bs58.encode(new Uint8Array(31)))).toBeNull();
    expect(decodeAddress('0OIl-is-not-base58-at-all-0OIl0OIl')).toBeNull();
  });

  it('checks Ed25519 with node:crypto: another key, a changed message and bad lengths fail', () => {
    const k = key(), other = key();
    const m = utf8('hello'), sig = k.sign(m);
    expect(verifyEd25519(k.raw, m, sig)).toBe(true);
    expect(verifyEd25519(other.raw, m, sig)).toBe(false);
    expect(verifyEd25519(k.raw, utf8('hellO'), sig)).toBe(false);
    expect(verifyEd25519(k.raw, m, sig.subarray(0, 63))).toBe(false);
    expect(verifyEd25519(k.raw.subarray(0, 31), m, sig)).toBe(false);
  });

  it('accepts SIWS text carrying exactly the issued fields for the claimed address', () => {
    const k = key();
    const text = createSignInMessageText({ ...issued(), address: k.address });
    expect(signInMatches(issued(), text, k.address)).toBe(true);
    expect(signInMatches(issued(), text, key().address)).toBe(false);
    expect(signInMatches(issued(key().address), text, k.address)).toBe(false); // the challenge named another address
  });

  it.each(['domain', 'uri', 'statement', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime'] as const)('rejects a changed %s', (field) => {
    const k = key();
    const text = createSignInMessageText({ ...issued(), address: k.address, [field]: `${issued()[field]}x` });
    expect(signInMatches(issued(), text, k.address)).toBe(false);
  });

  it('rejects fields the server never issued, and text that is not SIWS (Review Focus 3)', () => {
    const k = key();
    expect(signInMatches(issued(), createSignInMessageText({ ...issued(), address: k.address, notBefore: '2026-10-13T12:00:00.000Z' }), k.address)).toBe(false);
    expect(signInMatches(issued(), createSignInMessageText({ ...issued(), address: k.address, resources: ['https://evil.example'] }), k.address)).toBe(false);
    expect(signInMatches(issued(), 'not a sign-in message', k.address)).toBe(false);
  });

  it('message mode signs the same SIWS format, with the address', () => {
    const k = key();
    expect(messageText({ ...issued(k.address), address: k.address })).toBe(createSignInMessageText({ ...issued(), address: k.address }));
  });

  it('reads strict base64 only', () => {
    expect(fromBase64('aGVsbG8=')).toEqual(utf8('hello'));
    expect(fromBase64('***')).toBeNull();
    expect(fromBase64('abc')).toBeNull();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { walletProof } from '../src/features/auth/wallet/sign';
import { mockFetch } from './utils';
import { CHALLENGE, CHALLENGE_WITH_MESSAGE, FAKE_ADDRESS, fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });

describe('walletProof', () => {
  it('signIn wallets: a challenge with no address, one prompt, the wallet’s own text comes back', async () => {
    const f = fakeWallet({ name: 'Phantom' }); offs.push(f.unregister);
    const sent: unknown[] = [];
    mockFetch({ '/api/auth/wallet/challenge': (init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return CHALLENGE; } });
    const p = await walletProof(f.wallet, 'login');
    expect(sent).toEqual([{ purpose: 'login' }]);
    expect(f.calls.signIn).toEqual([CHALLENGE.input]);
    expect(f.calls.connect).toBe(0);
    expect(p).toMatchObject({ nonce: CHALLENGE.nonce, mode: 'signIn', address: FAKE_ADDRESS, walletName: 'Phantom' });
    expect(atob(p.signedMessage)).toBe('signed text');
    expect(atob(p.signature)).toHaveLength(64);
  });

  it('message-only wallets: connect, a challenge for that address, then sign exactly its text', async () => {
    const f = fakeWallet({ name: 'Plain', signIn: false }); offs.push(f.unregister);
    const sent: unknown[] = [];
    mockFetch({ '/api/auth/wallet/challenge': (init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return CHALLENGE_WITH_MESSAGE; } });
    const p = await walletProof(f.wallet, 'link');
    expect(sent).toEqual([{ purpose: 'link', address: FAKE_ADDRESS }]);
    expect(new TextDecoder().decode(f.calls.signMessage[0])).toBe(CHALLENGE_WITH_MESSAGE.message);
    expect(p).toMatchObject({ mode: 'message', address: FAKE_ADDRESS, walletName: 'Plain' });
    expect(atob(p.signedMessage)).toBe(CHALLENGE_WITH_MESSAGE.message);
  });
});

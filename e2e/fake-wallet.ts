import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import type { Page } from '@playwright/test';

const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#7DE3FF"/></svg>').toString('base64')}`;

/**
 * Registers a Wallet Standard wallet in the page, backed by a real Ed25519 key that signs in Node (exposeFunction), so the
 * server checks genuine signatures. `signIn`: one-step sign-in; `message`: connect + signMessage.
 */
export async function installFakeWallet(page: Page, o: { id: string; name: string; mode: 'signIn' | 'message' }): Promise<{ address: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = bs58.encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  await page.exposeFunction(`__sxSign_${o.id}`, (input: Record<string, string> | null, message64: string | null) => {
    const bytes = input
      ? Buffer.from(createSignInMessageText({ ...input, address } as Parameters<typeof createSignInMessageText>[0]))
      : Buffer.from(message64!, 'base64');
    return { signed: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') };
  });
  await page.addInitScript(({ id, name, address, icon, mode }) => {
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const toB64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));
    const signer = () => (window as unknown as Record<string, (i: unknown, m: string | null) => Promise<{ signed: string; signature: string }>>)[`__sxSign_${id}`]!;
    const account = { address, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [] as string[] };
    const features: Record<string, unknown> = {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
    };
    if (mode === 'signIn') {
      features['solana:signIn'] = { version: '1.0.0', signIn: async (...inputs: Record<string, string>[]) => Promise.all(inputs.map(async (i) => {
        const r = await signer()(i, null);
        return { account, signedMessage: fromB64(r.signed), signature: fromB64(r.signature) };
      })) };
    } else {
      features['solana:signMessage'] = { version: '1.0.0', signMessage: async (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async (i) => {
        const r = await signer()(null, toB64(i.message));
        return { signedMessage: fromB64(r.signed), signature: fromB64(r.signature) };
      })) };
    }
    const wallet = { version: '1.0.0', name, icon, chains: ['solana:mainnet'], accounts: [], features };
    const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
    const ev = new Event('wallet-standard:register-wallet');
    Object.defineProperty(ev, 'detail', { value: register });
    window.dispatchEvent(ev);
  }, { id: o.id, name: o.name, address, icon: ICON, mode: o.mode });
  return { address };
}

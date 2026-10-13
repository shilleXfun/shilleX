import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';

export const FAKE_ADDRESS = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as const;
export const CHALLENGE = {
  nonce: 'nonce-1234567890',
  input: { domain: 'localhost:5173', uri: 'http://localhost:5173', statement: 'Sign in to Shillex.', version: '1', chainId: 'mainnet', nonce: 'nonce-1234567890', issuedAt: '2026-10-13T12:00:00.000Z', expirationTime: '2026-10-13T12:05:00.000Z' },
  message: null as string | null,
};
export const CHALLENGE_WITH_MESSAGE = { ...CHALLENGE, input: { ...CHALLENGE.input, address: FAKE_ADDRESS }, message: `localhost:5173 wants you to sign in with your Solana account:\n${FAKE_ADDRESS}\n\nSign in to Shillex.` };

/** Registers a Wallet Standard wallet that signs at once. Call `unregister` in afterEach. */
export function fakeWallet(o: { name?: string; signIn?: boolean; chains?: `${string}:${string}`[] } = {}) {
  const calls = { signIn: [] as unknown[], signMessage: [] as Uint8Array[], connect: 0 };
  const account: WalletAccount = { address: FAKE_ADDRESS, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [] };
  const features: Record<string, unknown> = {
    'standard:connect': { version: '1.0.0', connect: async () => { calls.connect++; return { accounts: [account] }; } },
    'standard:events': { version: '1.0.0', on: () => () => undefined },
    'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs: { message: Uint8Array }[]) => inputs.map((i) => { calls.signMessage.push(i.message); return { signedMessage: i.message, signature: new Uint8Array(64).fill(7) }; }) },
  };
  if (o.signIn !== false) {
    features['solana:signIn'] = { version: '1.0.0', signIn: async (...inputs: object[]) => inputs.map((i) => { calls.signIn.push(i); return { account, signedMessage: new TextEncoder().encode('signed text'), signature: new Uint8Array(64).fill(9) }; }) };
  }
  const wallet = { version: '1.0.0', name: o.name ?? 'Phantom', icon: ICON, chains: o.chains ?? ['solana:mainnet', 'solana:devnet'], accounts: [], features } as unknown as Wallet;
  return { wallet, calls, unregister: getWallets().register(wallet) };
}

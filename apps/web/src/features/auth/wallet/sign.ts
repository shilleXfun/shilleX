import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import { SolanaSignIn, SolanaSignMessage, type SolanaSignInFeature, type SolanaSignMessageFeature } from '@solana/wallet-standard-features';
import type { WalletChallenge, WalletProof, WalletPurpose } from '@shillex/shared';
import { post } from '../../../lib/api';

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

/**
 * Signs a fresh server challenge with `wallet` (spec §3.2): one `solana:signIn` prompt when the wallet has it; otherwise
 * connect, ask for a challenge naming that address, and sign its exact text with `solana:signMessage`.
 */
export async function walletProof(wallet: Wallet, purpose: WalletPurpose): Promise<WalletProof> {
  if (SolanaSignIn in wallet.features) {
    const ch = await post<WalletChallenge>('/auth/wallet/challenge', { purpose });
    const { signIn } = (wallet.features as unknown as SolanaSignInFeature)[SolanaSignIn];
    const [out] = await signIn(ch.input);
    if (!out) throw new Error('The wallet returned no signature');
    return { nonce: ch.nonce, mode: 'signIn', address: out.account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature), walletName: wallet.name };
  }
  const { connect } = (wallet.features as unknown as StandardConnectFeature)[StandardConnect];
  const { accounts } = await connect();
  const account: WalletAccount | undefined = accounts.find((a) => a.chains.includes('solana:mainnet')) ?? accounts[0];
  if (!account) throw new Error('The wallet shared no account');
  const ch = await post<WalletChallenge>('/auth/wallet/challenge', { purpose, address: account.address });
  const { signMessage } = (wallet.features as unknown as SolanaSignMessageFeature)[SolanaSignMessage];
  const [out] = await signMessage({ account, message: new TextEncoder().encode(ch.message ?? '') });
  if (!out) throw new Error('The wallet returned no signature');
  return { nonce: ch.nonce, mode: 'message', address: account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature), walletName: wallet.name };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import WalletPicker from '../src/features/auth/wallet/WalletPicker';
import { ApiError } from '../src/lib/api';
import { mockFetch, renderWithApp } from './utils';
import { CHALLENGE, fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });
const add = (o: Parameters<typeof fakeWallet>[0]) => { const f = fakeWallet(o); offs.push(f.unregister); return f; };
function picker(onProof = vi.fn(async () => undefined), onClose = vi.fn()) {
  renderWithApp(<WalletPicker open onClose={onClose} purpose="login" onProof={onProof} />);
  return { onProof, onClose };
}

describe('WalletPicker', () => {
  it('shows installed featured wallets, install links for the rest, and other wallets below', async () => {
    add({ name: 'Phantom' }); add({ name: 'Glow' }); add({ name: 'Devnet', chains: ['solana:devnet'] });
    picker();
    expect(await screen.findByRole('button', { name: /Phantom/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install Solflare' })).toHaveAttribute('href', 'https://solflare.com/download');
    expect(screen.getByRole('link', { name: 'Install Backpack' })).toHaveAttribute('href', 'https://backpack.app/downloads');
    expect(screen.getByRole('heading', { name: 'Other wallets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Glow/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Devnet/ })).toBeNull();
  });

  it('picking a wallet signs, hands the proof over, remembers the wallet and closes', async () => {
    add({ name: 'Phantom' });
    mockFetch({ '/api/auth/wallet/challenge': CHALLENGE });
    const { onProof, onClose } = picker();
    fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onProof).toHaveBeenCalledWith(expect.objectContaining({ mode: 'signIn', walletName: 'Phantom' }));
    expect(localStorage.getItem('sx:last-wallet')).toBe('Phantom');
  });

  it('stays open with the server’s reason when the proof is refused', async () => {
    add({ name: 'Phantom' });
    mockFetch({ '/api/auth/wallet/challenge': CHALLENGE });
    const { onClose } = picker(vi.fn(async () => { throw new ApiError(409, 'WALLET_IN_USE', 'This wallet is linked to another Shillex account.'); }));
    fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This wallet is linked to another Shillex account.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a phone with no wallet gets links that open Shillex inside Phantom or Solflare', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    picker();
    expect(await screen.findByRole('link', { name: 'Open in Phantom' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/phantom\.app\/ul\/browse\//));
    expect(screen.getByRole('link', { name: 'Open in Solflare' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/solflare\.com\/ul\/v1\/browse\//));
  });
});

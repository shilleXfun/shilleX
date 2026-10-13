import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { arrange, canSignIn, lastWallet, rememberWallet, useWalletList } from '../src/features/auth/wallet/registry';
import { fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });
const add = (o: Parameters<typeof fakeWallet>[0]) => { const f = fakeWallet(o); offs.push(f.unregister); return f; };

describe('wallet registry', () => {
  it('keeps mainnet wallets that can sign in, in one step or by message', () => {
    expect(canSignIn(add({ name: 'Phantom' }).wallet)).toBe(true);
    expect(canSignIn(add({ name: 'Plain', signIn: false }).wallet)).toBe(true);
    expect(canSignIn(add({ name: 'Devnet only', chains: ['solana:devnet'] }).wallet)).toBe(false);
  });

  it('lists wallets that register after the page loaded', () => {
    const { result } = renderHook(() => useWalletList());
    expect(result.current).toEqual([]);
    act(() => { add({ name: 'Late Wallet' }); });
    expect(result.current.map((w) => w.name)).toEqual(['Late Wallet']);
  });

  it('shows the three featured wallets, installed or not, then the rest; the last one used comes first', () => {
    const phantom = add({ name: 'Phantom' }).wallet, glow = add({ name: 'Glow' }).wallet;
    const a = arrange([phantom, glow], null);
    expect(a.recent).toBeNull();
    expect(a.featured.map((e) => [e.name, Boolean(e.wallet)])).toEqual([['Phantom', true], ['Solflare', false], ['Backpack', false]]);
    expect(a.others.map((e) => e.name)).toEqual(['Glow']);
    const b = arrange([phantom, glow], 'Glow');
    expect(b.recent?.name).toBe('Glow');
    expect(b.others).toEqual([]);
    expect(arrange([phantom], 'Solflare').recent).toBeNull(); // not installed: nothing to put first
  });

  it('remembers the last wallet, and storage that throws is harmless', () => {
    rememberWallet('Solflare');
    expect(lastWallet()).toBe('Solflare');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(lastWallet()).toBeNull();
    expect(() => rememberWallet('Phantom')).not.toThrow();
  });
});

import { useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { StandardConnect } from '@wallet-standard/features';
import { SolanaSignIn, SolanaSignMessage } from '@solana/wallet-standard-features';
import { FEATURED } from './featured';

/** A wallet the picker can use: on Solana mainnet, with one-step sign-in, or with connect plus message signing. */
export function canSignIn(w: Wallet): boolean {
  if (!w.chains.includes('solana:mainnet')) return false;
  return SolanaSignIn in w.features || (SolanaSignMessage in w.features && StandardConnect in w.features);
}
export const usableWallets = (): Wallet[] => getWallets().get().filter(canSignIn);

/** Every usable wallet, updated as wallets register late (extensions often load after the page). */
export function useWalletList(): Wallet[] {
  const [list, setList] = useState<Wallet[]>(usableWallets);
  useEffect(() => {
    const api = getWallets();
    const update = () => setList(usableWallets());
    const offs = [api.on('register', update), api.on('unregister', update)];
    update();
    return () => offs.forEach((off) => off());
  }, []);
  return list;
}

const LAST = 'sx:last-wallet';
export function lastWallet(): string | null {
  try { return localStorage.getItem(LAST); } catch { return null; }
}
export function rememberWallet(name: string): void {
  try { localStorage.setItem(LAST, name); } catch { /* storage off: the order just isn't remembered */ }
}

export interface PickerEntry { name: string; wallet: Wallet | null; install: string | null; colour: string | null }
/** Featured wallets first (installed or not), then every other wallet. The last one used, when installed, goes on top on its own. */
export function arrange(list: Wallet[], last: string | null): { recent: PickerEntry | null; featured: PickerEntry[]; others: PickerEntry[] } {
  const byName = new Map(list.map((w) => [w.name, w]));
  const isFeatured = (n: string) => FEATURED.some((f) => f.name === n);
  const featured: PickerEntry[] = FEATURED.map((f) => ({ name: f.name, wallet: byName.get(f.name) ?? null, install: f.install, colour: f.colour }));
  const others: PickerEntry[] = list.filter((w) => !isFeatured(w.name)).map((w) => ({ name: w.name, wallet: w, install: null, colour: null }));
  const recent = [...featured, ...others].find((e) => e.name === last && e.wallet) ?? null;
  return { recent, featured: featured.filter((e) => e !== recent), others: others.filter((e) => e !== recent) };
}

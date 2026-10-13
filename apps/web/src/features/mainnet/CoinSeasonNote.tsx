import type { ChainNetwork, MainnetMode } from '@shillex/shared';
import s from './mainnet.module.css';

/** Under a coin's header: an earlier season's coin, or a coin traded with real SOL (mainnet spec §10, §6). */
export function CoinSeasonNote({ archived, network, mainnet }: { archived: boolean; network: ChainNetwork; mainnet: MainnetMode | undefined }) {
  if (archived) return <p className={s.note} role="note">Archived · from an earlier season. Its page stays; it can no longer be traded.</p>;
  if (network === 'ledger' && mainnet === 'on') return <p className={s.real} role="note">Real SOL · traded only inside Shillex, by agents.</p>;
  return null;
}

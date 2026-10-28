import { TriangleAlert } from 'lucide-react';
import { useAgentsInfo } from '../features/agents/agentsApi';
import s from './layout.module.css';

/** On mainnet (SOLANA_NETWORK=mainnet), every page says plainly that this is real money (2026-10-28 brief §4). */
export function RealMoneyBanner() {
  const real = useAgentsInfo().data?.realMoney;
  if (!real) return null;
  return (
    <div className={s.realMoney} role="note">
      <TriangleAlert size={14} aria-hidden="true" />
      <strong>Real money.</strong> Agents here trade real SOL on Solana mainnet. Owners can lose what they send.
    </div>
  );
}

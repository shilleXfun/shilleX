import { useAgentsInfo } from '../features/agents/agentsApi';
import { DevnetMark } from '../components/ui/DevnetMark';

const DEVNET = 'Coins run on Solana devnet for now. Nothing here is real money.';
const MAINNET = 'Each agent trades on Solana from its own wallet, within the limits its owner sets.';

/**
 * The one sentence on what the money is: the side column's foot and the site footer show this. It follows the server's
 * network (SOLANA_NETWORK, 2026-10-28): on mainnet the money is real, and the devnet days get the yellow "?".
 */
export function MoneyLine({ className }: { className?: string }) {
  const real = useAgentsInfo().data?.realMoney === true;
  return <p className={className}>{real ? <>{MAINNET}<DevnetMark what="the coins and trades from before" /></> : DEVNET}</p>;
}

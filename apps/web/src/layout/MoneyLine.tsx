/**
 * Whether agents launch their coins on Solana mainnet. The owner's switch: flip it here when mainnet launches go public
 * (a server flag replaces this boolean later). Everything that says what the coins are reads it through MoneyLine.
 */
export const COINS_ON_MAINNET = false;

const DEVNET = 'Coins run on Solana devnet for now. Nothing here is real money.';
const MAINNET = 'Agents launch real coins on Solana mainnet. Agents never sell the coins they make.';

/** The one sentence on what the coins are: the hero, the side column's foot and the site footer all show this. */
export function MoneyLine({ className, mainnet = COINS_ON_MAINNET }: { className?: string; mainnet?: boolean }) {
  return <p className={className}>{mainnet ? MAINNET : DEVNET}</p>;
}

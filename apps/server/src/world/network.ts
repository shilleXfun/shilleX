import type { Config } from '../config.ts';

/**
 * The one network switch (2026-10-28 brief §4): SOLANA_NETWORK=devnet (the default) or mainnet. Devnet is the agents' world
 * chain with its treasury and start grants; mainnet is real SOL from each agent's own vault wallet, funded by its owner, with
 * hard limits on by default. Every RPC URL comes from config.rpc, chosen here and nowhere else.
 */
export type SolanaNetwork = 'devnet' | 'mainnet';

export interface NetworkInfo {
  name: SolanaNetwork;
  rpcUrl: string;
  /** True on mainnet: the site shows the real-money banner everywhere. */
  realMoney: boolean;
  explorerTx(sig: string): string;
  explorerAddress(address: string): string;
}

export function networkOf(config: Pick<Config, 'solanaNetwork' | 'rpc'>): NetworkInfo {
  const main = config.solanaNetwork === 'mainnet';
  const cluster = main ? '' : '?cluster=devnet';
  return {
    name: config.solanaNetwork,
    rpcUrl: main ? config.rpc.mainnet ?? '' : config.rpc.devnet,
    realMoney: main,
    explorerTx: (sig) => `https://solscan.io/tx/${sig}${cluster}`,
    explorerAddress: (a) => `https://solscan.io/account/${a}${cluster}`,
  };
}

const DEVNET_URL = /\/\/(?:api\.)?devnet\.|devnet\.helius-rpc\.com|[?&]cluster=devnet/i;

/** The RPC pair from the environment: new names first, then the ones older deploys already set. Throws on a crossed URL. */
export function rpcFromEnv(env: Record<string, string | undefined>): { devnet: string; mainnet: string | null } {
  const t = (v: string | undefined) => v?.trim() || undefined;
  const helius = t(env.HELIUS_RPC_URL);
  const devnet = t(env.SOLANA_DEVNET_RPC_URL) || (helius && /\/\/devnet\./i.test(helius) ? helius : undefined) || t(env.DEVNET_RPC_URL) || 'https://api.devnet.solana.com';
  const fromHelius = helius && /\/\/devnet\.helius-rpc\.com/i.test(helius) ? helius.replace(/\/\/devnet\./i, '//mainnet.') : helius && /\/\/mainnet\.helius-rpc\.com/i.test(helius) ? helius : undefined;
  const mainnet = t(env.SOLANA_MAINNET_RPC_URL) || t(env.SOL_TRADING_RPC_URL) || t(env.HELIUS_MAINNET_RPC_URL) || fromHelius || null;
  if (mainnet && DEVNET_URL.test(mainnet)) throw new Error(`SOLANA_MAINNET_RPC_URL points at devnet (${mainnet.replace(/api-key=[^&]+/i, 'api-key=…')})`);
  return { devnet, mainnet };
}

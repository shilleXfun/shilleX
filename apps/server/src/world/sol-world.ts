import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { parseVaultKey } from './sol-vault.ts';
import { solNet, type SolNet } from './sol-net.ts';
import { createSolBank, type SolBank } from './sol-trade.ts';
import { settlePass, type MarketDeps } from './sol-market.ts';
import { refreshRealMarket } from './real-market.ts';
import { launchCoin, type LaunchPlan, type Launched } from './sol-launch.ts';

/**
 * Real SOL at boot (2026-10-27): the vault, the bank, the marketplace and their timers. Wallets exist (and deposits are seen) as
 * soon as SOL_WALLET_KEY is set, so owners can fund and withdraw before trading is switched on; trades need SOL_TRADING=on.
 */
export interface SolHandles {
  bank: SolBank; market: MarketDeps; net: SolNet; on: boolean;
  /** A real coin launch from the agent's own wallet (world/sol-launch.ts), when MAINNET_LAUNCH is on. */
  launch(agentId: string, plan: LaunchPlan): Promise<Launched>;
  /** The agents' posts about their money go through the engine once it runs (agents/depth/system.ts systemAct). */
  setSay(fn: (agentId: string, text: string) => Promise<unknown>): void;
  stop(): void;
}

const S = 1000;

export async function bootSol(db: Db, config: Config, now: () => Date): Promise<SolHandles | null> {
  const c = config.solTrading;
  if (!c.vaultKey) { if (c.on) console.error('[sol] SOL_TRADING is on but SOL_WALLET_KEY is not set: no wallets, no trades'); return null; }
  if (!c.rpcUrl) { console.error('[sol] no mainnet RPC: set SOL_TRADING_RPC_URL (or a Helius HELIUS_RPC_URL)'); return null; }
  const master = parseVaultKey(c.vaultKey, config.worldKey);
  const net = solNet(c.rpcUrl);
  let sayFn: ((agentId: string, text: string) => Promise<unknown>) | null = null;
  const say = (agentId: string, text: string) => (sayFn ? sayFn(agentId, text).catch(() => null) : Promise.resolve(null));
  const bank = createSolBank({ db, net, master, now, on: c.on, say });
  const market: MarketDeps = { db, bank, now, say };
  console.log(`[sol] real SOL ${c.on ? 'trading on' : 'trading off (wallets, deposits and withdrawals only)'}: ${await bank.ensureWallets()} new agent wallets`);

  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let busy = false;
    const t = setInterval(() => {
      if (busy) return;
      busy = true;
      fn().catch((e) => console.error(`[sol] ${name} failed`, (e as Error)?.message ?? e)).finally(() => { busy = false; });
    }, ms);
    t.unref?.(); timers.push(t);
  };
  every(120 * S, 'balances', () => bank.refreshBalances());
  every(10 * 60 * S, 'wallets', () => bank.ensureWallets());
  every(60 * S, 'settlement', () => settlePass(market));
  if (c.on) {
    every(60 * S, 'exits', () => bank.exitPass());
    // The coins agents see and hold, priced (the paper desk used to do this; it is off while real SOL is on).
    every(3 * 60 * S, 'market', () => refreshRealMarket(db, now()));
    void refreshRealMarket(db, now()).catch(() => undefined);
  }
  const launch = (agentId: string, plan: LaunchPlan) => launchCoin({ db, net, master, now, on: c.on, launchOn: config.mainnetLaunch, say }, agentId, plan);
  return { bank, market, net, on: c.on, launch, setSay: (fn) => { sayFn = fn; }, stop: () => timers.forEach(clearInterval) };
}

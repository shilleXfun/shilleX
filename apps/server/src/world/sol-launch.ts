import { Keypair } from '@solana/web3.js';
import { Resvg } from '@resvg/resvg-js';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, solTrades, worldSettings } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { pfpSvg } from '../lib/pfp.ts';
import { checkPlan } from '../agents/coin-launch.ts';
import { signerOf, walletFor } from './sol-vault.ts';
import { PRIORITY_FEE_SOL, type SolNet } from './sol-net.ts';
import { killedReason, type Outcome } from './sol-trade.ts';

/**
 * Real coin launches on mainnet (owner, 2026-10-29). An agent launches a coin of its own on pump.fun from its own vault wallet:
 * its name, ticker and story, and its own NFT pixel face as the coin's picture; no website, no X account, no links (the site
 * stays secret). It makes no first buy, so it never holds its own coin and can never sell it on the people who buy it, and no
 * Shillex agent may buy a coin a Shillex agent launched (world/sol-trade.ts). The house pack gets one launch in all, claimed
 * before any SOL moves; an outside agent launches only when its owner switched launching on. MAINNET_LAUNCH turns it all on.
 */
export const LAUNCH_MAX_SPEND_SOL = 0.05;
/** What the wallet needs before a launch: pump.fun's accounts and the network fees, with room to spare. */
export const LAUNCH_MIN_SOL = 0.06;
export const HOUSE_LAUNCH_KEY = 'house_mainnet_launch';
const L = 1e9;

export interface LaunchDeps { db: Db; net: SolNet; master: Buffer; now: () => Date; on: boolean; launchOn: boolean; say?: (agentId: string, text: string) => Promise<unknown> }
export interface LaunchPlan { name: string; symbol: string; description: string }
export type Launched = Outcome & { mint?: string; sig?: string };

/** True while the house pack's one launch is still unused. */
export async function houseLaunchFree(db: Db): Promise<boolean> {
  return !(await db.select({ k: worldSettings.key }).from(worldSettings).where(eq(worldSettings.key, HOUSE_LAUNCH_KEY))).length;
}

/** The agent's NFT pixel face as a 512 px PNG: its coin wears its face. */
export const facePng = (agentId: string) => Buffer.from(new Resvg(pfpSvg(agentId), { fitTo: { mode: 'width', value: 512 } }).render().asPng());

export async function launchCoin(d: LaunchDeps, agentId: string, plan: LaunchPlan): Promise<Launched> {
  if (!d.launchOn) return { ok: false, outcome: 'refused: coin launches are switched off (MAINNET_LAUNCH)' };
  const kill = await killedReason(d.db, d.on);
  if (kill) return { ok: false, outcome: `refused: ${kill}` };
  if (!d.net.uploadMetadata) return { ok: false, outcome: 'refused: launching is not set up on this server' };
  const [a] = await d.db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, agentId));
  if (!a) return { ok: false, outcome: 'refused: no such agent' };
  const coin = checkPlan({ name: plan.name, ticker: plan.symbol, lore: plan.description, logo: '' }, new Set());
  if (!coin) return { ok: false, outcome: 'refused: pick another name or ticker (2 to 8 capitals or digits, not a famous coin, a clean name and a short story, no links)' };
  const w = await walletFor(d.db, d.master, agentId, d.now());
  const balance = (await d.net.balances([w.publicKey])).get(w.publicKey) ?? 0;
  if (balance < LAUNCH_MIN_SOL * L) return { ok: false, outcome: `refused: I have ${(balance / L).toFixed(4)} SOL; a launch needs about ${LAUNCH_MIN_SOL} SOL` };
  // The house pack's one launch is claimed first, so two house agents can never both launch; given back if nothing was sent.
  const house = a.origin === 'wild';
  if (house && !(await d.db.insert(worldSettings).values({ key: HOUSE_LAUNCH_KEY, value: agentId }).onConflictDoNothing().returning()).length) {
    return { ok: false, outcome: 'refused: the house pack has had its one launch' };
  }
  let sent = false;
  try {
    const meta = await d.net.uploadMetadata({ name: coin.name, symbol: coin.symbol, description: coin.lore, image: facePng(agentId) });
    const mint = Keypair.generate();
    const kp = await signerOf(d.db, d.master, agentId);
    const tx = await d.net.quote({ publicKey: w.publicKey, action: 'create', tokenMetadata: { name: meta.name, symbol: meta.symbol, uri: meta.uri }, mint: mint.publicKey.toBase58(), denominatedInSol: 'true', amount: 0, slippage: 10, priorityFee: PRIORITY_FEE_SOL, pool: 'pump' });
    const after = await d.net.simulate(tx, kp.publicKey);
    if (balance - after > LAUNCH_MAX_SPEND_SOL * L) throw new Error(`refused: it would take ${((balance - after) / L).toFixed(4)} SOL, more than ${LAUNCH_MAX_SPEND_SOL}`);
    const sig = await d.net.send(tx, [mint, kp]);
    sent = true;
    const ok = await d.net.confirm(sig);
    const now = (await d.net.balances([w.publicKey])).get(w.publicKey) ?? 0;
    if (ok === false || (ok === null && Math.abs(now - balance) < 10_000)) throw Object.assign(new Error('the launch did not go through'), { sig });
    const address = mint.publicKey.toBase58();
    await d.db.insert(solTrades).values({ id: newId(), agentId, kind: 'launch', mint: address, symbol: coin.symbol, sol: (balance - now) / L, by: 'agent', sig, ok: true, at: d.now() });
    await d.say?.(agentId, `I launched $${coin.symbol} on pump.fun: ${coin.name}. ${coin.lore} I hold none of it, and no Shillex agent may buy it.`);
    return { ok: true, outcome: `launched $${coin.symbol} (${address})`, mint: address, sig };
  } catch (e) {
    const msg = ((e as Error)?.message ?? String(e)).slice(0, 300);
    if (house && !sent) await d.db.delete(worldSettings).where(and(eq(worldSettings.key, HOUSE_LAUNCH_KEY), eq(worldSettings.value, agentId)));
    await d.db.insert(solTrades).values({ id: newId(), agentId, kind: 'launch', symbol: coin.symbol, sol: 0, by: 'agent', sig: (e as { sig?: string })?.sig ?? null, ok: false, error: msg, at: d.now() });
    return { ok: false, outcome: msg.startsWith('refused: ') ? msg : `failed: ${msg.slice(0, 160)}` };
  }
}

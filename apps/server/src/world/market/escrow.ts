import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { treasurySigner } from '../../agents/external/grant.ts';
import { AppError } from '../../lib/errors.ts';
import { ChainError, RAW_PER_TOKEN, type Chain } from '../chain.ts';
import { recordTx } from '../ledger.ts';
import { createWallet, signerFor, walletOf } from '../wallets.ts';
import type { SolBank } from '../sol-trade.ts';
import { and, eq } from 'drizzle-orm';
import { solTrades } from '../../db/schema.ts';

/**
 * The marketplace's escrow (2026-10-28 brief §6): one Shillex wallet on the world chain that holds each accepted deal's price
 * until the deal settles. SOL moves by a plain transfer, a Shillex coin by a token transfer. The escrow pays its own network
 * fees; when it runs low the devnet treasury tops it up. Nobody can take money out but the deal code.
 *
 * On mainnet (owner, 2026-10-29) the price is real SOL: it moves from the buyer's vault wallet to the vault's escrow wallet and
 * out again through the real-SOL bank (world/sol-trade.ts escrowIn/escrowOut), each move in the agents' SOL history. Only SOL:
 * Shillex coins are devnet test coins there.
 */
export const ESCROW_ID = 'market_escrow';
const L = 1e9;
/** Below this the escrow asks the treasury for FEE_TOP_UP, so it can always pay out. */
const FEE_FLOOR = 10_000_000, FEE_TOP_UP = 20_000_000;

export interface EscrowDeps { db: Db; chain: Chain; key: Buffer; config: Config; now: () => Date; /** Mainnet: the real-SOL bank; null when its wallets are not set up. */ bank?: SolBank | null }
export interface Amount { currency: string; amount: number }

export const isSol = (currency: string) => currency === 'SOL';
/** The amount in the chain's units: lamports, or a coin's raw tokens. */
export const rawOf = (a: Amount) => Math.round(a.amount * (isSol(a.currency) ? L : RAW_PER_TOKEN));

const insufficient = (what: string) => new AppError(400, 'INSUFFICIENT_FUNDS', what);

async function escrowAddress(d: EscrowDeps): Promise<string> {
  return (await walletOf(d.db, ESCROW_ID))?.publicKey ?? createWallet(d.db, ESCROW_ID, d.key, d.now());
}

/** The escrow pays network fees from its own SOL: it asks the treasury for more when what it holds beyond `need` runs low. */
async function keepFees(d: EscrowDeps, address: string, need: number) {
  if ((await d.chain.balances(address)).lamports >= need + FEE_FLOOR) return;
  const t = await treasurySigner(d);
  if (!t) return;
  await d.chain.sendSol(t, address, FEE_TOP_UP).catch((e) => console.warn('[market] the escrow fee top-up failed', (e as Error)?.message));
}

/** Moves `a` from `fromId`'s wallet (an agent, or the escrow) to `toId`'s; returns the signature. */
async function move(d: EscrowDeps, fromId: string, toId: string, a: Amount, kind: 'escrow_in' | 'escrow_out'): Promise<string> {
  const to = toId === ESCROW_ID ? await escrowAddress(d) : (await walletOf(d.db, toId))?.publicKey;
  if (!to) throw new AppError(409, 'NO_WALLET', 'That agent has no wallet yet');
  const from = fromId === ESCROW_ID ? await escrowAddress(d) : (await walletOf(d.db, fromId))?.publicKey;
  if (!from) throw new AppError(409, 'NO_WALLET', 'That agent has no wallet yet');
  const raw = rawOf(a);
  if (fromId === ESCROW_ID) await keepFees(d, from, isSol(a.currency) ? raw : 0);
  const bal = await d.chain.balances(from);
  if (isSol(a.currency)) {
    if (bal.lamports < raw + 10_000) throw insufficient(`The wallet holds ${bal.lamports / L} SOL; this needs ${a.amount} SOL and a network fee`);
  } else {
    if (!d.chain.sendTokens) throw new AppError(400, 'COINS_NOT_MOVABLE', 'Coins cannot move between wallets on this network: price it in SOL');
    const held = bal.tokens.find((t) => t.mint === a.currency)?.raw ?? 0;
    if (held < raw) throw insufficient(`The wallet holds ${held / RAW_PER_TOKEN} of this coin; this needs ${a.amount}`);
    if (bal.lamports < 3_000_000) throw insufficient('Moving a coin needs about 0.003 SOL for the network fee and a token account');
  }
  const signer = await signerFor(d.db, fromId, d.key);
  try {
    const sig = isSol(a.currency) ? (await d.chain.sendSol(signer, to, raw)).signature : (await d.chain.sendTokens!(signer, to, a.currency, raw)).signature;
    // The agent's side of it, in its own chain history (the escrow itself is not an agent).
    const agentId = fromId === ESCROW_ID ? toId : fromId;
    await recordTx(d.db, { signature: sig, agentId, turnId: null, kind: kind === 'escrow_in' ? 'send' : 'receive', mint: isSol(a.currency) ? null : a.currency, counterparty: fromId === ESCROW_ID ? from : to,
      lamportsDelta: isSol(a.currency) ? (fromId === ESCROW_ID ? raw : -raw) : 0, tokenDelta: isSol(a.currency) ? 0 : (fromId === ESCROW_ID ? raw : -raw), createdAt: d.now() }).catch(() => undefined);
    return sig;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof ChainError && /INSUFFICIENT/.test(e.code)) throw insufficient(e.message);
    throw new AppError(502, 'ESCROW_FAILED', `The transfer did not go through: ${(e as Error)?.message?.slice(0, 200) ?? e}`);
  }
}

export const onMainnet = (d: Pick<EscrowDeps, 'config'>) => d.config.solanaNetwork === 'mainnet';

/** Mainnet: real SOL between the agent's vault wallet and the vault's escrow wallet. `dealId` is kept with each move. */
async function realMove(d: EscrowDeps, agentId: string, a: Amount, way: 'in' | 'out', dealId: string): Promise<string> {
  if (!isSol(a.currency)) throw new AppError(400, 'SOL_ONLY', 'On mainnet the marketplace takes SOL only');
  if (!d.bank) throw new AppError(503, 'SOL_OFF', 'Real SOL wallets are not set up on this server');
  const lamports = Math.round(a.amount * L);
  if (way === 'out') {
    // Only what this deal put into the real escrow comes out of it, once: a deal held in devnet test SOL before mainnet has
    // nothing real behind it, and must never be paid from other deals' SOL.
    const moved = await d.db.select({ kind: solTrades.kind, sol: solTrades.sol }).from(solTrades).where(and(eq(solTrades.orderId, dealId), eq(solTrades.ok, true)));
    const held = moved.find((m) => m.kind === 'escrow_in');
    if (!held) throw new AppError(409, 'NOT_HELD_ON_MAINNET', 'This deal was paid in devnet test SOL before mainnet: there is no real SOL to move');
    if (moved.some((m) => m.kind === 'escrow_out')) throw new AppError(409, 'ALREADY_PAID', 'This deal was already paid out');
    if (Math.abs(Math.round(held.sol * L) - lamports) > 1) throw new AppError(409, 'AMOUNT_MISMATCH', 'The payout does not match what was held');
  }
  const r = way === 'in' ? await d.bank.escrowIn(agentId, lamports, dealId) : await d.bank.escrowOut(agentId, lamports, dealId);
  if (r.ok && r.sig) return r.sig;
  const why = r.outcome.replace(/^(refused|failed): /, '');
  if (/^refused: I have/.test(r.outcome)) throw insufficient(`The wallet holds too little: ${why}`);
  throw new AppError(r.outcome.startsWith('refused') ? 409 : 502, 'ESCROW_FAILED', `The transfer did not go through: ${why}`);
}

export const hold = (d: EscrowDeps, buyerId: string, a: Amount, dealId = '') => (onMainnet(d) ? realMove(d, buyerId, a, 'in', dealId) : move(d, buyerId, ESCROW_ID, a, 'escrow_in'));
export const payOut = (d: EscrowDeps, toId: string, a: Amount, dealId = '') => (onMainnet(d) ? realMove(d, toId, a, 'out', dealId) : move(d, ESCROW_ID, toId, a, 'escrow_out'));

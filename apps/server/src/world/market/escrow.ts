import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { treasurySigner } from '../../agents/external/grant.ts';
import { AppError } from '../../lib/errors.ts';
import { ChainError, RAW_PER_TOKEN, type Chain } from '../chain.ts';
import { recordTx } from '../ledger.ts';
import { createWallet, signerFor, walletOf } from '../wallets.ts';

/**
 * The marketplace's escrow (2026-10-28 brief §6): one Shillex wallet on the world chain that holds each accepted deal's price
 * until the deal settles. SOL moves by a plain transfer, a Shillex coin by a token transfer. The escrow pays its own network
 * fees; when it runs low the devnet treasury tops it up. Nobody can take money out but the deal code.
 */
export const ESCROW_ID = 'market_escrow';
const L = 1e9;
/** Below this the escrow asks the treasury for FEE_TOP_UP, so it can always pay out. */
const FEE_FLOOR = 10_000_000, FEE_TOP_UP = 20_000_000;

export interface EscrowDeps { db: Db; chain: Chain; key: Buffer; config: Config; now: () => Date }
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

export const hold = (d: EscrowDeps, buyerId: string, a: Amount) => move(d, buyerId, ESCROW_ID, a, 'escrow_in');
export const payOut = (d: EscrowDeps, toId: string, a: Amount) => move(d, ESCROW_ID, toId, a, 'escrow_out');

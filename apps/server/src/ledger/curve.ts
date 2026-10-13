import { CURVE, RAW_PER_TOKEN } from '../world/chain.ts';

/** A pool as the curve sees it: SOL in its reserve and tokens sold, both in base units. */
export interface PoolState { sol: number; sold: number }
export interface BuyQuote { spent: number; net: number; fee: number; out: number; graduates: boolean }
export interface SellQuote { gross: number; out: number; fee: number }

const { V_SOL, V_TOKENS, CURVE_TOKENS, GRADUATE_AT, TRADE_FEE_BPS } = CURVE;
const KEEP = 1 - TRADE_FEE_BPS / 10_000;

/**
 * MemoryChain's swapIn, as a pure function (same expressions, so the same floats): a buy past the threshold takes only what
 * completes the curve. `spent` leaves the buyer, `net` enters the pool and `fee` (1%) is split by the ledger.
 */
export function quoteBuy(p: PoolState, lamportsIn: number): BuyQuote {
  const spent = Math.min(lamportsIn, Math.ceil((GRADUATE_AT - p.sol) / KEEP));
  const net = Math.min(Math.floor(spent * KEEP), GRADUATE_AT - p.sol);
  const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
  const out = Math.min(Math.floor(V_TOKENS - p.sold - k / (V_SOL + p.sol + net)), CURVE_TOKENS - p.sold);
  return { spent, net, fee: spent - net, out, graduates: p.sol + net >= GRADUATE_AT || p.sold + out >= CURVE_TOKENS };
}

/** MemoryChain's sell: `gross` leaves the pool, the seller gets `out` and the 1% `fee` is split by the ledger. */
export function quoteSell(p: PoolState, rawIn: number): SellQuote {
  const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
  const gross = Math.floor(V_SOL + p.sol - k / (V_TOKENS - p.sold + rawIn));
  const out = Math.floor(gross * (1 - TRADE_FEE_BPS / 10_000));
  return { gross, out, fee: gross - out };
}

/** Lamports per whole token, as MemoryChain prices it. */
export const priceOf = (p: PoolState) => ((V_SOL + p.sol) / (V_TOKENS - p.sold)) * RAW_PER_TOKEN;

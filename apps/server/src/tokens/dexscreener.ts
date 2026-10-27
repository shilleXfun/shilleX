import { isValidSolanaAddress } from '@shillex/shared';
import { UpstreamError } from './rpc.ts';
import { dexLimiter } from '../world/dex-limiter.ts';

export interface DexBest {
  name: string | null; symbol: string | null; imageUrl: string | null;
  liquidityUsd: number | null; marketCapUsd: number | null; fdvUsd: number | null;
  pairAddress: string; dexId: string | null; pairCreatedAt: Date | null;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function fetchDexBest(mint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<DexBest | null> {
  let data: unknown;
  // Paced with every other DexScreener read, cached for a minute and backed off on 429 (world/dex-limiter.ts).
  try { data = await dexLimiter(fetchImpl).get(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, timeoutMs); }
  catch (e) {
    const msg = (e as Error)?.message ?? '';
    throw new UpstreamError(msg.startsWith('dexscreener') ? msg : e instanceof SyntaxError ? 'dexscreener bad json' : `dexscreener unreachable: ${(e as Error)?.name}`);
  }
  if (!Array.isArray(data)) throw new UpstreamError('dexscreener unexpected shape');
  const pairs = data.filter((p: any) => p?.chainId === 'solana' && p?.baseToken?.address === mint && typeof p?.pairAddress === 'string' && isValidSolanaAddress(p.pairAddress));
  if (!pairs.length) return null;
  pairs.sort((a: any, b: any) => (num(b.liquidity?.usd) ?? -1) - (num(a.liquidity?.usd) ?? -1));
  const p: any = pairs[0];
  const img = str(p.info?.imageUrl, 500);
  return {
    name: str(p.baseToken?.name), symbol: str(p.baseToken?.symbol, 24),
    imageUrl: img && img.startsWith('https://') ? img : null,
    liquidityUsd: num(p.liquidity?.usd), marketCapUsd: num(p.marketCap), fdvUsd: num(p.fdv),
    pairAddress: p.pairAddress, dexId: str(p.dexId), pairCreatedAt: num(p.pairCreatedAt) ? new Date(p.pairCreatedAt) : null,
  };
}

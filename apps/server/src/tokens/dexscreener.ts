import { isValidSolanaAddress } from '@shillex/shared';
import { UpstreamError } from './rpc.ts';

export interface DexBest {
  name: string | null; symbol: string | null; imageUrl: string | null;
  liquidityUsd: number | null; marketCapUsd: number | null; fdvUsd: number | null;
  pairAddress: string; dexId: string | null; pairCreatedAt: Date | null;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function fetchDexBest(mint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<DexBest | null> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new UpstreamError(`dexscreener unreachable: ${(e as Error).name}`);
  }
  if (!res.ok) throw new UpstreamError(`dexscreener http ${res.status}`);
  let data: unknown;
  try { data = await res.json(); } catch { throw new UpstreamError('dexscreener bad json'); }
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

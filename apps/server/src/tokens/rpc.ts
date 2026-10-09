import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@shillex/shared';

export class UpstreamError extends Error {}
export type MintAccount =
  | { kind: 'mint'; program: 'spl-token' | 'spl-token-2022'; decimals: number | null; name: string | null; symbol: string | null }
  | { kind: 'not_mint' };

export async function fetchMintAccount(rpcUrl: string, mint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<MintAccount> {
  let res: Response;
  try {
    res = await fetchImpl(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UpstreamError(`rpc unreachable: ${(e as Error).name}`);
  }
  if (!res.ok) throw new UpstreamError(`rpc http ${res.status}`);
  let body: any;
  try { body = await res.json(); } catch { throw new UpstreamError('rpc bad json'); }
  if (body?.error) throw new UpstreamError(`rpc error ${body.error.code ?? ''}`);
  const v = body?.result?.value;
  if (!v) return { kind: 'not_mint' };
  const parsed = v.data?.parsed;
  if ((v.owner !== TOKEN_PROGRAM_ID && v.owner !== TOKEN_2022_PROGRAM_ID) || parsed?.type !== 'mint') return { kind: 'not_mint' };
  const meta = (parsed.info?.extensions ?? []).find((e: any) => e?.extension === 'tokenMetadata')?.state;
  const str = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 64) : null);
  return {
    kind: 'mint', program: v.owner === TOKEN_PROGRAM_ID ? 'spl-token' : 'spl-token-2022',
    decimals: Number.isInteger(parsed.info?.decimals) ? parsed.info.decimals : null,
    name: str(meta?.name), symbol: str(meta?.symbol),
  };
}

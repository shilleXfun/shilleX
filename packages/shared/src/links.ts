import { isValidSolanaAddress } from './mint.ts';
import { COPY } from './constants.ts';

export type ExternalLinkId = 'axiom' | 'gmgn' | 'dexscreener' | 'solscan';
export interface ExternalLink { id: ExternalLinkId; label: string; url: string | null; unavailableReason: string | null }

export function buildTokenLinks(t: { mint: string; pairAddress: string | null; source: 'demo' | 'live' | null }): ExternalLink[] {
  if (!isValidSolanaAddress(t.mint)) throw new Error(`invalid mint: ${t.mint}`);
  if (t.pairAddress !== null && !isValidSolanaAddress(t.pairAddress)) throw new Error(`invalid pair: ${t.pairAddress}`);
  const m = encodeURIComponent(t.mint);
  const demo = t.source === 'demo';
  const link = (id: ExternalLinkId, label: string, url: string | null, missing: string): ExternalLink =>
    demo ? { id, label, url: null, unavailableReason: COPY.demoLinkReason }
      : url ? { id, label, url, unavailableReason: null }
      : { id, label, url: null, unavailableReason: missing };
  return [
    link('axiom', 'Axiom', t.pairAddress ? `https://axiom.trade/meme/${encodeURIComponent(t.pairAddress)}?chain=sol` : null, COPY.axiomNoPair),
    link('gmgn', 'GMGN', `https://gmgn.ai/sol/token/${m}`, ''),
    link('dexscreener', 'Dexscreener', `https://dexscreener.com/solana/${m}`, ''),
    link('solscan', 'Solscan', `https://solscan.io/token/${m}`, ''),
  ];
}

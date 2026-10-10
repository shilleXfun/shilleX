import bs58 from 'bs58';

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const WORD_CHAR = /[A-Za-z0-9_]/;

export function isValidSolanaAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}
export const isValidMintFormat = isValidSolanaAddress;

export interface MintCandidate { mint: string; start: number; end: number }

export function urlSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]}]+$/, '');
    spans.push([m.index!, m.index! + trimmed.length]);
  }
  return spans;
}

export function extractMintCandidates(text: string): MintCandidate[] {
  const urls = urlSpans(text);
  const out: MintCandidate[] = [];
  for (const m of text.matchAll(BASE58_RUN)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = start > 0 ? text[start - 1]! : '';
    const after = end < text.length ? text[end]! : '';
    if (before && WORD_CHAR.test(before)) continue;
    if (after && WORD_CHAR.test(after)) continue;
    if (urls.some(([s, e]) => start >= s && end <= e)) continue;
    if (!isValidSolanaAddress(m[0])) continue;
    out.push({ mint: m[0], start, end });
  }
  return out;
}

export function uniqueMints(text: string): string[] {
  return [...new Set(extractMintCandidates(text).map((c) => c.mint))];
}

export function abbreviateMint(mint: string, head = 4, tail = 4): string {
  if (mint.length <= head + tail + 1) return mint;
  return `${mint.slice(0, head)}…${mint.slice(-tail)}`;
}

/** Shortens every contract address in plain text (previews, snippets) so a 44-character address doesn't crowd out the words. */
export function abbreviateMintsIn(text: string): string {
  let out = text;
  for (const c of extractMintCandidates(text).reverse()) out = out.slice(0, c.start) + abbreviateMint(c.mint) + out.slice(c.end);
  return out;
}

import { fallbackPhrasebook } from '../phrasebook.ts';
import type { Phrasebook, Situation } from '../types.ts';

/** Words in a row that count as quoting the owner's private wish. */
export const QUOTE_RUN = 6;
const words = (s: string) => s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const runsOf = (s: string) => {
  const w = words(s), out = new Set<string>();
  for (let i = 0; i + QUOTE_RUN <= w.length; i++) out.add(w.slice(i, i + QUOTE_RUN).join(' '));
  return out;
};

/** True when `text` repeats QUOTE_RUN or more words of the wish in a row. */
export function quotesWish(text: string, wish: string): boolean {
  const theirs = runsOf(wish);
  if (!theirs.size) return false;
  for (const r of runsOf(text)) if (theirs.has(r)) return true;
  return false;
}

/**
 * The description is private, but the voice, lines and bio a model writes from it are public: anything that repeats the wish
 * word for word is dropped, and a part left empty takes the fallback voice's (spec 2026-10-13-user-agents §1, privacy).
 */
export function scrubBook(book: Phrasebook, wish: string, seed: string): Phrasebook {
  const q = (t: string) => quotesWish(t, wish);
  const fb = fallbackPhrasebook(seed);
  const keep = (xs: string[], or: string[]) => { const k = xs.filter((x) => !q(x)); return k.length ? k : or; };
  const lines: Phrasebook['lines'] = {};
  for (const [k, xs] of Object.entries(book.lines) as [Situation, string[]][]) lines[k] = keep(xs, fb.lines[k] ?? []);
  const captions = book.memeCaptions.filter((c) => !q(`${c.top} ${c.bottom}`));
  return {
    ...book,
    voice: q(book.voice) ? fb.voice : book.voice,
    lines,
    openers: keep(book.openers, fb.openers),
    closers: keep(book.closers, fb.closers),
    memeCaptions: captions.length ? captions : fb.memeCaptions,
    interests: book.interests.filter((x) => !q(x)),
  };
}

/** A model-written profile whose bio repeats the wish loses the bio. */
export const scrubProfile = <P extends { bio: string | null }>(p: P | null, wish: string): P | null =>
  p && p.bio && quotesWish(p.bio, wish) ? { ...p, bio: null } : p;

// Intl.Segmenter keeps a family or a skin-toned emoji whole; without it (very old browsers) code points are the next best cut.
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** The characters of `text` as a reader counts them: an emoji (even one made of several code points) is one. */
export const characters = (text: string): string[] => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));

/** The first `n` characters of `text`. Never cuts through an emoji. */
export const firstChars = (text: string, n: number): string => characters(text).slice(0, n).join('');

/** `text` cut to `max` characters, the last of them `…`, when it is longer; otherwise as it is. */
export function clipText(text: string, max: number): string {
  const chars = characters(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

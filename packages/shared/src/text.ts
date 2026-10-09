import { extractMintCandidates, urlSpans } from './mint.ts';

export type BodySegment =
  | { type: 'text'; text: string }
  | { type: 'url'; text: string; href: string }
  | { type: 'mention'; text: string; username: string }
  | { type: 'mint'; text: string; mint: string };

const MENTION_RE = /(?<![A-Za-z0-9_.])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

interface Span { start: number; end: number; seg: BodySegment }

export function tokenizeBody(text: string): BodySegment[] {
  if (!text) return [];
  const spans: Span[] = [];
  for (const [start, end] of urlSpans(text)) {
    const t = text.slice(start, end);
    spans.push({ start, end, seg: { type: 'url', text: t, href: t } });
  }
  const inside = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
  for (const c of extractMintCandidates(text)) {
    if (!inside(c.start, c.end)) spans.push({ start: c.start, end: c.end, seg: { type: 'mint', text: c.mint, mint: c.mint } });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!inside(start, end)) spans.push({ start, end, seg: { type: 'mention', text: m[0], username: m[1]! } });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: BodySegment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ type: 'text', text: text.slice(pos, s.start) });
    out.push(s.seg);
    pos = s.end;
  }
  if (pos < text.length) out.push({ type: 'text', text: text.slice(pos) });
  return out;
}

export function extractMentions(text: string): string[] {
  const set = new Set<string>();
  for (const seg of tokenizeBody(text)) if (seg.type === 'mention') set.add(seg.username.toLowerCase());
  return [...set];
}

export function codePointLength(s: string): number {
  return [...s].length;
}

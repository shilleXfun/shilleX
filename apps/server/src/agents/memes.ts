import type { Db } from '../db/client.ts';
import { memeTemplates } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { FONT_FAMILY, escapeXml, plain, renderSvg } from './cards.ts';
import { canGenerate, recordImageSpend } from './image-budget.ts';
import { storeBlob, type ImageGen } from './images.ts';
import { WORST_IMAGE_USD } from './openai-images.ts';

/** Captioned memes are rendered at most this wide, so a render stays far below the 2 MB blob cap. */
export const MEME_MAX_WIDTH = 768;

/** The prompt sent to the image model. Briefs are public (agent-written), never a human's private text. */
export const templateBriefPrompt = (brief: string) =>
  `${plain(brief, 300)}. Meme template composition, one clear subject, expressive, clear empty space at the top and bottom for captions. No text, no letters, no words, no logos, no watermarks.`;

/**
 * A base image without text, generated once from a brief, for the engine to caption many times.
 * Returns the template id, or null when there is no generator, the budget can't cover the call's worst-case price,
 * or anything fails (logged, never thrown). A paid image is recorded exactly once, even when it then can't be stored.
 */
export async function generateTemplate(
  d: { db: Db; gen: ImageGen | null; limits: { usd: number; max: number }; now: () => Date },
  t: { brief: string; tags: string[]; authorId: string },
): Promise<string | null> {
  if (!d.gen) return null;
  let png: Buffer, usd: number;
  try {
    if (!(await canGenerate(d.db, d.limits, d.now(), WORST_IMAGE_USD))) return null;
    ({ png, usd } = await d.gen.generate(templateBriefPrompt(t.brief), '1024x1024'));
  } catch (e) { console.error('[agents] meme template generation failed', (e as Error).message); return null; }
  try {
    await recordImageSpend(d.db, usd, d.now());
    const blob = await storeBlob(d.db, png, 'image/png', d.now());
    const id = newId();
    await d.db.insert(memeTemplates).values({ id, blobId: blob.id, brief: plain(t.brief, 300), tags: t.tags, authorId: t.authorId, createdAt: d.now() });
    return id;
  } catch (e) { console.error('[agents] generated meme template could not be stored', (e as Error).message); return null; }
}

/** Greedy word wrap into at most `lines` lines of at most `width` characters; words longer than a line are split; the last line ends with … if cut. */
function wrap(text: string, width: number, lines: number): string[] {
  const words = plain(text, 400).toUpperCase().split(/\s+/).filter(Boolean)
    .flatMap((w) => Array.from({ length: Math.ceil(w.length / width) }, (_, i) => w.slice(i * width, (i + 1) * width)));
  const out: string[] = [];
  let cur = '', cut = false;
  for (const w of words) {
    if (!cur || cur.length + 1 + w.length <= width) { cur = cur ? `${cur} ${w}` : w; continue; }
    out.push(cur); cur = w;
    if (out.length === lines) { cut = true; break; }
  }
  if (cut) out[lines - 1] = `${out[lines - 1]!.slice(0, width - 1)}…`;
  else if (cur) out.push(cur);
  return out;
}

/** A generous estimate of a line's width in em for DejaVu Sans Bold capitals, so a line judged to fit really does. */
const emWidth = (line: string) => [...line].reduce((w, c) => w + (c === ' ' ? 0.35 : /[IJ.,:;!'|()[\]1-]/.test(c) ? 0.42 : /[MW@%&…]/.test(c) ? 1.1 : 0.8), 0);

/** Impact-style captions (bold, upper case, white with a black outline) over the template, rendered at most MEME_MAX_WIDTH wide. */
export function captionMeme(templatePng: Buffer, width: number, height: number, top: string, bottom: string): Buffer {
  const size = Math.round(width / 12), perLine = Math.floor(width / (size * 0.66)), room = Math.floor(width * 0.94);
  const block = (text: string, fromTop: boolean) => wrap(text, perLine, 2).map((l, i, all) => {
    const y = fromTop ? size * 1.15 * (i + 1) : height - size * 0.35 - size * 1.15 * (all.length - 1 - i);
    // A line of wide letters is squeezed to fit rather than run off the picture.
    const squeeze = emWidth(l) * size > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text x="${width / 2}" y="${y.toFixed(0)}" text-anchor="middle" font-size="${size}" font-weight="bold" fill="#fff" stroke="#000" stroke-width="${Math.max(3, size / 12).toFixed(1)}" paint-order="stroke"${squeeze}>${escapeXml(l)}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}">
<image width="${width}" height="${height}" xlink:href="data:image/png;base64,${templatePng.toString('base64')}"/>${block(top, true)}${block(bottom, false)}</svg>`;
  return renderSvg(svg, Math.min(width, MEME_MAX_WIDTH));
}

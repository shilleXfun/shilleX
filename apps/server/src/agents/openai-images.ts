import type { ImageGen } from './images.ts';

type ImageSize = '1024x1024' | '1536x1024';

/** Medium quality (owner, 2026-10-28: the low-quality pictures looked bad; $1 a day buys about 18 gpt-image-2 squares). */
export const IMAGE_QUALITY = 'medium';

/** Medium quality, the image (output tokens) alone, per image. gpt-image-2 measured 1,756 tokens for a square on 2026-10-28. */
export const IMAGE_PRICE_USD: Record<string, Record<ImageSize, number>> = {
  'gpt-image-2': { '1024x1024': 0.053, '1536x1024': 0.08 },
  'gpt-image-1': { '1024x1024': 0.042, '1536x1024': 0.063 },
};
/** Token prices (USD per token): prompt text, input images, and the generated image. A model not listed is charged the dearest. */
const TOKEN_USD: Record<string, { text: number; imageIn: number; out: number }> = {
  'gpt-image-2': { text: 5 / 1e6, imageIn: 8 / 1e6, out: 30 / 1e6 },
  'gpt-image-1': { text: 5 / 1e6, imageIn: 10 / 1e6, out: 40 / 1e6 },
};
const DEAREST_TOKENS = { text: 5 / 1e6, imageIn: 10 / 1e6, out: 40 / 1e6 };
const dearest = (size: ImageSize) => Math.max(...Object.values(IMAGE_PRICE_USD).map((t) => t[size]));
/** Longer prompts are cut, so a call's prompt cost has a ceiling. */
export const MAX_PROMPT_CHARS = 1000;
/** The prompt's cost, generously counted at one token per UTF-16 unit (English runs ~4 characters per token). */
const promptUsd = (prompt: string, perToken: number) => Math.min(prompt.length, MAX_PROMPT_CHARS) * perToken;

/** The most a single call can be charged: the dearest image plus the longest prompt. The budget reserves this before every paid call. */
export const WORST_IMAGE_USD = dearest('1536x1024') + MAX_PROMPT_CHARS * DEAREST_TOKENS.text;

/**
 * What a call is recorded as costing, never below the real cost: the model's table price (a model without one gets the
 * dearest) plus the prompt, or the response's own token usage priced per token, whichever is higher.
 */
export function imageCallUsd(model: string, size: ImageSize, prompt: string, usage?: ImageUsage): number {
  const tok = TOKEN_USD[model] ?? DEAREST_TOKENS;
  const floor = (IMAGE_PRICE_USD[model]?.[size] ?? dearest(size)) + promptUsd(prompt, tok.text);
  if (!usage) return floor;
  const d = usage.input_tokens_details;
  const input = d ? (d.text_tokens ?? 0) * tok.text + (d.image_tokens ?? 0) * tok.imageIn : (usage.input_tokens ?? 0) * tok.imageIn;
  return Math.max(floor, input + (usage.output_tokens ?? 0) * tok.out);
}
interface ImageUsage { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }

/** True for an error status OpenAI answered with: the request was refused, so nothing was billed. Any other failure may have been. */
export const isUnbilledImageError = (e: unknown) => /^OPENAI_IMAGE_\d{3}:/.test((e as Error | null)?.message ?? '');

/** OpenAI Images over fetch (no SDK), at IMAGE_QUALITY. */
export class OpenAIImageGen implements ImageGen {
  constructor(private apiKey: string, private model: string, private fetchFn: typeof fetch = fetch) {}
  async generate(prompt: string, size: ImageSize): Promise<{ png: Buffer; usd: number }> {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS);
    const r = await this.fetchFn('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, size, n: 1, quality: IMAGE_QUALITY }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string }; usage?: ImageUsage };
    if (!r.ok) throw new Error(`OPENAI_IMAGE_${r.status}: ${(body.error?.message ?? 'request failed').slice(0, 200)}`);
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OPENAI_IMAGE_EMPTY: no image in the response');
    return { png: Buffer.from(b64, 'base64'), usd: imageCallUsd(this.model, size, prompt, body.usage) };
  }
}

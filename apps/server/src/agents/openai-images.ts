import type { ImageGen } from './images.ts';

type ImageSize = '1024x1024' | '1536x1024';

/** gpt-image-1 at low quality: the image (output tokens) alone, per image. */
export const IMAGE_PRICE_USD: Record<ImageSize, number> = { '1024x1024': 0.011, '1536x1024': 0.016 };

/** gpt-image-1 token prices (USD per token): prompt text, input images, and the generated image. */
const TEXT_IN_USD = 5 / 1e6, IMAGE_IN_USD = 10 / 1e6, OUT_USD = 40 / 1e6;
/** Longer prompts are cut, so a call's prompt cost has a ceiling. */
export const MAX_PROMPT_CHARS = 1000;
/** The prompt's cost, generously counted at one token per UTF-16 unit (English runs ~4 characters per token). */
const promptUsd = (prompt: string) => Math.min(prompt.length, MAX_PROMPT_CHARS) * TEXT_IN_USD;

/** The most a single call can be charged: the dearest image plus the longest prompt. The budget reserves this before every paid call. */
export const WORST_IMAGE_USD = Math.max(...Object.values(IMAGE_PRICE_USD)) + MAX_PROMPT_CHARS * TEXT_IN_USD;

/**
 * What a call is recorded as costing, never below the real cost: the table price (gpt-image-1's; any other model gets the
 * highest known price) plus the prompt, or the response's own token usage priced per token, whichever is higher.
 */
export function imageCallUsd(model: string, size: ImageSize, prompt: string, usage?: ImageUsage): number {
  const table = model === 'gpt-image-1' ? IMAGE_PRICE_USD[size] : Math.max(...Object.values(IMAGE_PRICE_USD));
  const floor = table + promptUsd(prompt);
  if (!usage) return floor;
  const d = usage.input_tokens_details;
  const input = d ? (d.text_tokens ?? 0) * TEXT_IN_USD + (d.image_tokens ?? 0) * IMAGE_IN_USD : (usage.input_tokens ?? 0) * IMAGE_IN_USD;
  return Math.max(floor, input + (usage.output_tokens ?? 0) * OUT_USD);
}
interface ImageUsage { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }

/** True for an error status OpenAI answered with: the request was refused, so nothing was billed. Any other failure may have been. */
export const isUnbilledImageError = (e: unknown) => /^OPENAI_IMAGE_\d{3}:/.test((e as Error | null)?.message ?? '');

/** OpenAI Images over fetch (no SDK). Low quality: memes need a clear scene, not detail. */
export class OpenAIImageGen implements ImageGen {
  constructor(private apiKey: string, private model: string, private fetchFn: typeof fetch = fetch) {}
  async generate(prompt: string, size: ImageSize): Promise<{ png: Buffer; usd: number }> {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS);
    const r = await this.fetchFn('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, size, n: 1, quality: 'low' }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string }; usage?: ImageUsage };
    if (!r.ok) throw new Error(`OPENAI_IMAGE_${r.status}: ${(body.error?.message ?? 'request failed').slice(0, 200)}`);
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OPENAI_IMAGE_EMPTY: no image in the response');
    return { png: Buffer.from(b64, 'base64'), usd: imageCallUsd(this.model, size, prompt, body.usage) };
  }
}

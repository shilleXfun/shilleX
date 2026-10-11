import type { ImageGen } from './images.ts';

type ImageSize = '1024x1024' | '1536x1024';

/** gpt-image-1 at low quality, per image. */
export const IMAGE_PRICE_USD: Record<ImageSize, number> = { '1024x1024': 0.011, '1536x1024': 0.016 };
/** The most any single call can cost: what the budget reserves before a paid call, and what a model without a known price is charged. */
export const WORST_IMAGE_USD = Math.max(...Object.values(IMAGE_PRICE_USD));

/** The table above is gpt-image-1's; any other model is charged the worst case so the budget never undercounts. */
export const imagePriceUsd = (model: string, size: ImageSize) => (model === 'gpt-image-1' ? IMAGE_PRICE_USD[size] : WORST_IMAGE_USD);

/** OpenAI Images over fetch (no SDK). Low quality: memes need a clear scene, not detail. */
export class OpenAIImageGen implements ImageGen {
  constructor(private apiKey: string, private model: string, private fetchFn: typeof fetch = fetch) {}
  async generate(prompt: string, size: ImageSize): Promise<{ png: Buffer; usd: number }> {
    const r = await this.fetchFn('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, size, n: 1, quality: 'low' }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(`OPENAI_IMAGE_${r.status}: ${(body.error?.message ?? 'request failed').slice(0, 200)}`);
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OPENAI_IMAGE_EMPTY: no image in the response');
    return { png: Buffer.from(b64, 'base64'), usd: imagePriceUsd(this.model, size) };
  }
}

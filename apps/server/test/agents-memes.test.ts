import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { imageInfo } from '../src/lib/image-size.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { OpenAIImageGen, IMAGE_PRICE_USD, MAX_PROMPT_CHARS, WORST_IMAGE_USD } from '../src/agents/openai-images.ts';
import { canGenerate, recordImageSpend } from '../src/agents/image-budget.ts';
import { captionMeme, generateTemplate, templateBriefPrompt } from '../src/agents/memes.ts';
import { MAX_BLOB_BYTES, type ImageGen } from '../src/agents/images.ts';
import { imageSpend, memeTemplates } from '../src/db/schema.ts';

const base = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#335"/></svg>');
const fakeGen = (calls: string[] = []): ImageGen => ({ async generate(prompt) { calls.push(prompt); return { png: base, usd: 0.011 }; } });
let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(() => t.close());

/** Generation failures are logged; keep the test output clean and check that they were. */
async function quietly<T>(run: () => Promise<T>): Promise<{ result: T; logged: number }> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { return { result: await run(), logged: spy.mock.calls.length }; } finally { spy.mockRestore(); }
}
const spentOn = async (day: string) => (await t.db.select().from(imageSpend).where(eq(imageSpend.day, day)))[0];

describe('OpenAI image generator', () => {
  it('posts the documented request and decodes b64_json', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: base.toString('base64') }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new OpenAIImageGen('sk-test', 'gpt-image-1', fetchFn).generate('a raccoon', '1024x1024');
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ model: 'gpt-image-1', prompt: 'a raccoon', size: '1024x1024', n: 1, quality: 'medium' });
    expect(r.png.equals(base)).toBe(true);
    // Recorded above the bare image price: the prompt's text tokens are billed too.
    expect(r.usd).toBeGreaterThan(IMAGE_PRICE_USD['gpt-image-1']!['1024x1024']);
    expect(r.usd).toBeLessThanOrEqual(WORST_IMAGE_USD);
  });
  it('records the response token usage when it costs more than the table price', async () => {
    const usage = { input_tokens: 50, output_tokens: 2000, input_tokens_details: { text_tokens: 50, image_tokens: 0 } };
    const fetchFn = (async () => new Response(JSON.stringify({ data: [{ b64_json: base.toString('base64') }], usage }), { status: 200 })) as unknown as typeof fetch;
    const r = await new OpenAIImageGen('sk-test', 'gpt-image-1', fetchFn).generate('a raccoon', '1024x1024');
    expect(r.usd).toBeCloseTo(50 * 5e-6 + 2000 * 40e-6, 9);
  });
  it('cuts a very long prompt so a call never costs more than the worst case', async () => {
    const seen: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(String(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: base.toString('base64') }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new OpenAIImageGen('sk-test', 'gpt-image-2', fetchFn).generate('z'.repeat(5000), '1536x1024');
    expect(JSON.parse(seen[0]!).prompt).toHaveLength(MAX_PROMPT_CHARS);
    expect(r.usd).toBeCloseTo(WORST_IMAGE_USD, 9);
  });
  it('turns an API error into a short error without the key', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { message: 'billing hard limit' } }), { status: 400 })) as unknown as typeof fetch;
    const err = await new OpenAIImageGen('sk-secret', 'gpt-image-1', fetchFn).generate('x', '1024x1024').catch((e: Error) => e);
    expect(String(err)).toContain('OPENAI_IMAGE_400: billing hard limit');
    expect(String(err)).not.toContain('sk-secret');
  });
  it('charges the highest known price for a model it has no price for', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ data: [{ b64_json: base.toString('base64') }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await new OpenAIImageGen('sk-test', 'some-future-model', fetchFn).generate('x', '1024x1024');
    expect(r.usd).toBeGreaterThan(IMAGE_PRICE_USD['gpt-image-2']!['1024x1024']);
    expect(r.usd).toBeLessThanOrEqual(WORST_IMAGE_USD);
  });
});

describe('image budget and templates', () => {
  it('stops at the daily dollar budget or the daily count, whichever comes first', async () => {
    const now = t.clock.now();
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, now)).toBe(true);
    await recordImageSpend(t.db, 0.011, now);
    await recordImageSpend(t.db, 0.011, now);
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, now)).toBe(false); // count
    expect(await canGenerate(t.db, { usd: 0.02, max: 10 }, now)).toBe(false); // dollars
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, new Date(now.getTime() + 86_400_000))).toBe(true); // next UTC day
  });
  it('refuses a call whose worst-case price would cross the budget', async () => {
    const now = new Date('2026-12-05T23:00:00Z'); // late in the day: the paced allowance is the whole budget
    await recordImageSpend(t.db, 0.011, now);
    expect(await canGenerate(t.db, { usd: 0.02, max: 10 }, now)).toBe(true);
    expect(await canGenerate(t.db, { usd: 0.02, max: 10 }, now, WORST_IMAGE_USD)).toBe(false);
    expect(await canGenerate(t.db, { usd: 0, max: 10 }, new Date('2026-12-06T00:00:00Z'))).toBe(false); // a zero budget buys nothing
  });
  it('generates a template from a brief, records the spend, and asks for an image without text', async () => {
    const calls: string[] = [];
    const u = await t.createUser('briefwriter');
    const id = await generateTemplate({ db: t.db, gen: fakeGen(calls), limits: { usd: 1, max: 15 }, now: t.clock.now }, { brief: 'a raccoon in a hard hat staring at a red chart', tags: ['got_rugged', 'dumping'], authorId: u.id });
    expect(id).toBeTruthy();
    expect(calls[0]).toBe(templateBriefPrompt('a raccoon in a hard hat staring at a red chart'));
    expect(calls[0]).toMatch(/no text/i);
    expect((await t.db.select().from(memeTemplates)).find((r) => r.id === id)).toMatchObject({ tags: ['got_rugged', 'dumping'], usesToday: 0 });
  });
  it('does not call the generator when the worst-case price would cross the budget', async () => {
    const calls: string[] = [];
    const u = await t.createUser('overbudget');
    const now = () => new Date('2026-12-07T09:00:00Z');
    await recordImageSpend(t.db, 0.011, now());
    expect(await generateTemplate({ db: t.db, gen: fakeGen(calls), limits: { usd: 0.02, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id })).toBeNull();
    expect(calls).toEqual([]);
  });
  it('returns null without a generator or when generation fails, and does not record spend', async () => {
    const u = await t.createUser('nogen');
    const d = { db: t.db, limits: { usd: 1, max: 99 }, now: () => new Date('2026-12-01T12:00:00Z') };
    expect(await generateTemplate({ ...d, gen: null }, { brief: 'x', tags: [], authorId: u.id })).toBeNull();
    const failing: ImageGen = { async generate() { throw new Error('OPENAI_IMAGE_500: down'); } };
    const { result, logged } = await quietly(() => generateTemplate({ ...d, gen: failing }, { brief: 'x', tags: [], authorId: u.id }));
    expect(result).toBeNull();
    expect(logged).toBe(1);
    expect(await canGenerate(t.db, { usd: 0.0001, max: 1 }, d.now())).toBe(true);
  });
  it('a call that may have been billed (timeout, empty 200) counts at the worst-case price', async () => {
    const u = await t.createUser('timedout');
    const now = () => new Date('2026-12-09T10:00:00Z');
    const aborting = (async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }) as unknown as typeof fetch;
    const timedOut = await quietly(() => generateTemplate({ db: t.db, gen: new OpenAIImageGen('sk-test', 'gpt-image-1', aborting), limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }));
    expect(timedOut.result).toBeNull();
    expect(await spentOn('2026-12-09')).toMatchObject({ usd: WORST_IMAGE_USD, count: 1 });

    const aborted = (async () => { throw new DOMException('This operation was aborted', 'AbortError'); }) as unknown as typeof fetch;
    expect((await quietly(() => generateTemplate({ db: t.db, gen: new OpenAIImageGen('sk-test', 'gpt-image-1', aborted), limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }))).result).toBeNull();
    expect((await spentOn('2026-12-09'))!.count).toBe(2);

    const empty = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect((await quietly(() => generateTemplate({ db: t.db, gen: new OpenAIImageGen('sk-test', 'gpt-image-1', empty), limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }))).result).toBeNull();
    expect((await spentOn('2026-12-09'))!.count).toBe(3);

    const refused = (async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })) as unknown as typeof fetch;
    expect((await quietly(() => generateTemplate({ db: t.db, gen: new OpenAIImageGen('sk-test', 'gpt-image-1', refused), limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }))).result).toBeNull();
    expect((await spentOn('2026-12-09'))!.count).toBe(3); // an error status is not billed
  });
  it('a paid image that cannot be stored (too large, not a PNG) returns null, charged exactly once', async () => {
    const u = await t.createUser('hugeimage');
    const now = () => new Date('2026-12-03T10:00:00Z');
    const huge = Buffer.concat([base, Buffer.alloc(MAX_BLOB_BYTES)]);
    const calls: string[] = [];
    const bigGen: ImageGen = { async generate(p) { calls.push(p); return { png: huge, usd: 0.011 }; } };
    const big = await quietly(() => generateTemplate({ db: t.db, gen: bigGen, limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }));
    expect(big.result).toBeNull();
    expect(big.logged).toBe(1);
    expect(calls).toHaveLength(1);
    expect(await spentOn('2026-12-03')).toMatchObject({ usd: 0.011, count: 1 });

    const jpegGen: ImageGen = { async generate() { return { png: Buffer.from('not an image at all'), usd: 0.011 }; } };
    const bad = await quietly(() => generateTemplate({ db: t.db, gen: jpegGen, limits: { usd: 1, max: 15 }, now }, { brief: 'x', tags: [], authorId: u.id }));
    expect(bad.result).toBeNull();
    expect(await spentOn('2026-12-03')).toMatchObject({ usd: 0.022, count: 2 });
  });
});

describe('captions', () => {
  it('captions a template at no more than 768 px wide, and different captions give different images', () => {
    const a = captionMeme(base, 1024, 1024, 'when the dev says', 'locked liquidity');
    const b = captionMeme(base, 1024, 1024, 'me buying the top', 'again');
    expect(imageInfo(a)).toEqual({ mime: 'image/png', width: 768, height: 768 });
    expect(a.equals(b)).toBe(false);
  });
  it('keeps a small template at its own size', () => {
    const small = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#533"/></svg>');
    expect(imageInfo(captionMeme(small, 512, 512, 'top', 'bottom'))).toEqual({ mime: 'image/png', width: 512, height: 512 });
  });
  it('survives markup, emoji and very long captions', () => {
    const png = captionMeme(base, 1024, 1024, '<b>🦋</b> & '.repeat(30), '');
    expect(imageInfo(png)?.width).toBe(768);
    expect(imageInfo(captionMeme(base, 1024, 1024, 'x'.repeat(400), 'y'.repeat(50)))?.width).toBe(768);
  });
});

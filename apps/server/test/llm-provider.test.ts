import { describe, it, expect } from 'vitest';
import { loadLlmConfig } from '../src/config.ts';
import { ProviderError, RoutedBrain, categorize, chatBody, fromChatResponse, toChatMessages, type ProviderConfig } from '../src/world/brain-openai.ts';
import { accountProblem } from '../src/agents/moments.ts';
import type { BrainRequest } from '../src/world/brain.ts';

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name: 'groq', baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'small', modelStrong: 'big', priceInPerM: 0, priceOutPerM: 0,
  dailyRequests: null, rpm: null, tpm: null, jsonSchema: true, tools: true, reasoningEffort: false, timeoutMs: 1000, ...over,
});
const req = (over: Partial<BrainRequest> = {}): BrainRequest => ({ system: [{ type: 'text', text: 'You are @vex.' }], tools: [], effort: 'low', messages: [{ role: 'user', content: 'hi' }], ...over });
const ok = (content: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...extra }), { status: 200 });
const fail = (status: number, message: string, headers: Record<string, string> = {}) => new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), { status, headers });

describe('OpenAI-compatible translation', () => {
  it('turns tool_use and tool_result blocks into tool_calls and tool messages, and back', () => {
    const msgs = toChatMessages(req({ messages: [
      { role: 'user', content: 'post it' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'post', input: { body: 'gm' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"post_id":"p1"}' }] },
    ] }));
    expect(msgs).toEqual([
      { role: 'system', content: 'You are @vex.' },
      { role: 'user', content: 'post it' },
      { role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', type: 'function', function: { name: 'post', arguments: '{"body":"gm"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: '{"post_id":"p1"}' },
    ]);
    const back = fromChatResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'post', arguments: '{"body":"x"}' } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 40 } } }, 'small');
    expect(back.stopReason).toBe('tool_use');
    expect(back.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'post', input: { body: 'x' } }]);
    expect(back.usage).toEqual({ input: 60, output: 7, cacheRead: 40, cacheWrite: 0 });
  });

  it('asks for json_object with the schema in the prompt when the provider has no json_schema', () => {
    const schema = { type: 'object', properties: { text: { type: 'string' } } };
    const body = chatBody(provider({ jsonSchema: false }), 'small', req({ outputFormat: { type: 'json_schema', schema } }));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]!.content).toContain(JSON.stringify(schema));
  });

  it('sorts error answers by what a human or a retry can do', () => {
    expect(categorize(401, 'Invalid API Key')).toBe('auth');
    expect(categorize(429, 'Rate limit reached')).toBe('rate_limit');
    expect(categorize(429, 'You exceeded your current quota, please check your plan and billing details.')).toBe('rate_limit');
    expect(categorize(400, '{"error":{"code":"json_validate_failed"}}')).toBe('bad_output');
    expect(categorize(404, 'The model `x` does not exist')).toBe('model');
    expect(categorize(503, 'overloaded')).toBe('transient');
    // Only the kinds that need a human pause the model queue.
    expect(accountProblem(new ProviderError('groq 401 auth', 'auth', 401))).toBe('groq 401 auth');
    expect(accountProblem(new ProviderError('groq 429', 'rate_limit', 429))).toBeNull();
    expect(accountProblem(new ProviderError('bad json', 'bad_output', 400))).toBeNull();
  });
});

describe('RoutedBrain', () => {
  it('falls back to the next provider on a 429, cools the first down, and uses the strong model for tier 2', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      seen.push(`${new URL(url).host} ${body.model}`);
      return new URL(url).host === 'a.test' ? fail(429, 'Rate limit reached', { 'retry-after': '30' }) : ok('{"text":"hello"}');
    }) as typeof fetch;
    let t = Date.parse('2026-10-25T12:00:00Z');
    const brain = new RoutedBrain([provider({ name: 'groq', baseUrl: 'https://a.test/v1' }), provider({ name: 'gemini', baseUrl: 'https://b.test/v1', model: 'lite', modelStrong: 'flash' })], () => new Date(t), fetchImpl);
    const r = await brain.decide({ ...req(), tier: 2, prefer: 'groq' });
    expect((r.content[0] as { text: string }).text).toBe('{"text":"hello"}');
    expect(seen).toEqual(['a.test big', 'b.test flash']);
    expect(brain.status()[0]!.coolingUntil).toBe(new Date(t + 30_000).toISOString());
    await brain.decide(req({ messages: [{ role: 'user', content: 'again' }], prefer: 'groq' }));
    // Only the strong model sat out: the everyday one is still asked (and, limited in this mock too, hands over).
    expect(seen.slice(-2)).toEqual(['a.test small', 'b.test lite']);
    t += 31_000;
    await brain.decide(req({ messages: [{ role: 'user', content: 'later' }], prefer: 'groq' }));
    // The cool-down is over: groq is asked first again (and, still limited in this mock, hands over to gemini).
    expect(seen.slice(-2)).toEqual(['a.test small', 'b.test lite']);
  });

  it('never sends a call that may have been billed to a second provider, but hands a free one on', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; throw new Error('socket hang up'); }) as unknown as typeof fetch;
    const paid = { priceInPerM: 0.2, priceOutPerM: 0.8 };
    const brain = new RoutedBrain([provider({ baseUrl: 'https://a.test/v1', ...paid }), provider({ name: 'gemini', baseUrl: 'https://b.test/v1', ...paid })], () => new Date(), fetchImpl);
    await expect(brain.decide(req())).rejects.toMatchObject({ category: 'transient', status: undefined });
    expect(calls).toBe(1);
    const free = new RoutedBrain([provider({ baseUrl: 'https://a.test/v1' }), provider({ name: 'gemini', baseUrl: 'https://b.test/v1' })], () => new Date(), fetchImpl);
    await expect(free.decide(req())).rejects.toMatchObject({ category: 'transient' });
    expect(calls).toBe(3);
  });

  it('spreads calls over every key, keeps a named provider first, and rests one whose daily allowance is spent', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      const host = new URL(url).host;
      seen.push(host);
      return host === 'c.test' ? fail(429, 'Rate limit exceeded: free-models-per-day') : ok('{"text":"x"}');
    }) as typeof fetch;
    let t = Date.parse('2026-10-25T12:00:00Z');
    const brain = new RoutedBrain(['a', 'b', 'c'].map((h) => provider({ name: h, baseUrl: `https://${h}.test/v1` })), () => new Date(t), fetchImpl);
    for (let n = 0; n < 3; n++) await brain.decide(req({ messages: [{ role: 'user', content: `call ${n}` }] }));
    expect(seen).toEqual(['a.test', 'b.test', 'c.test', 'a.test']);
    await brain.decide(req({ messages: [{ role: 'user', content: 'named' }], prefer: 'b' }));
    expect(seen.at(-1)).toBe('b.test');
    t += 30 * 60_000;
    seen.length = 0;
    for (let n = 0; n < 3; n++) await brain.decide(req({ messages: [{ role: 'user', content: `later ${n}` }] }));
    expect(seen).not.toContain('c.test');
  });

  it('answers an identical request from memory, and refuses a provider whose price is unknown', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return ok('{"text":"x"}'); }) as unknown as typeof fetch;
    const brain = new RoutedBrain([provider({ name: 'paid', priceInPerM: null }), provider({ baseUrl: 'https://a.test/v1' })], () => new Date(), fetchImpl);
    const schema = { type: 'object' };
    await brain.decide(req({ outputFormat: { type: 'json_schema', schema } }));
    const again = await brain.decide(req({ outputFormat: { type: 'json_schema', schema } }));
    expect(calls).toBe(1);
    expect(again.usage.output).toBe(0);
    expect(brain.status()[0]!.why).toMatch(/price unknown/);
  });

  it('throws a bad_output error when the JSON asked for does not parse', async () => {
    const brain = new RoutedBrain([provider()], () => new Date(), (async () => ok('not json')) as unknown as typeof fetch);
    await expect(brain.decide(req({ outputFormat: { type: 'json_schema', schema: {} } }))).rejects.toMatchObject({ category: 'bad_output' });
  });
});

describe('LLM config', () => {
  it('reads providers in order, keeps an OpenRouter :free model at $0, and leaves other prices unknown', () => {
    const c = loadLlmConfig({ LLM_PROVIDERS: 'groq,openrouter', GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o', OPENROUTER_MODEL: 'meta/llama:free' });
    expect(c.mode).toBe('openai');
    expect(c.providers.map((p) => [p.name, p.model, p.priceInPerM])).toEqual([['groq', 'openai/gpt-oss-20b', null], ['openrouter', 'meta/llama:free', 0]]);
    expect(loadLlmConfig({}).mode).toBe('none');
    expect(loadLlmConfig({ ANTHROPIC_API_KEY: 'a' }).mode).toBe('anthropic');
  });
});

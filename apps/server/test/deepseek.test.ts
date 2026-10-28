import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../src/config.ts';
import { ClaudeBrain } from '../src/world/brain.ts';
import { brainFromConfig } from '../src/agents/haiku.ts';

/**
 * DeepSeek as Shillex's AI (2026-10-28, owner): through its Anthropic-compatible endpoint, the key in DEEPSEEK_API_KEY. That
 * endpoint ignores the JSON-schema output setting, so the schema goes into the instructions and the answer is cleaned to the JSON.
 */
function fakeClient(text: string) {
  const calls: Record<string, unknown>[] = [];
  const client = { messages: { create: async (p: Record<string, unknown>) => { calls.push(p); return { content: [{ type: 'text', text }], stop_reason: 'end_turn', model: String(p.model), usage: { input_tokens: 10, output_tokens: 5 } }; } } };
  return { client: client as unknown as Anthropic, calls };
}
const SCHEMA = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };

describe('DeepSeek', () => {
  it('becomes the AI when DEEPSEEK_API_KEY is set, with DeepSeek’s endpoint and models', () => {
    const c = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test' });
    expect(c.llm.mode).toBe('deepseek');
    expect(c.deepseek).toMatchObject({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash', modelStrong: 'deepseek-v4-pro' });
    expect(loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'anthropic' }).llm.mode).toBe('anthropic');
    expect(loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test', BRAIN_KILL_SWITCH: 'on' }).deepseek).toBeNull();
  });

  it('builds a brain that talks to api.deepseek.com/anthropic', () => {
    const c = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test' });
    const brain = brainFromConfig(c, () => new Date()) as unknown as { client: { baseURL: string } };
    expect(brain.client.baseURL).toBe('https://api.deepseek.com/anthropic');
  });

  it('asks for JSON in words, sends no Claude-only settings, and hands back clean JSON', async () => {
    const { client, calls } = fakeClient('Here you go:\n```json\n{"name": "Tide"}\n```');
    const brain = new ClaudeBrain('sk-test', 'deepseek-flash', client, 'deepseek-v4-pro');
    brain.useCompat();
    const res = await brain.decide({ system: [{ type: 'text', text: 'You name coins.' }], tools: [], messages: [{ role: 'user', content: 'name one' }], effort: 'low', outputFormat: { type: 'json_schema', schema: SCHEMA } });
    const sent = calls[0]!;
    expect(sent.model).toBe('deepseek-flash');
    expect(sent.thinking).toBeUndefined();
    expect(sent.output_config).toEqual({ effort: 'low' });
    expect((sent.system as { text: string }[]).at(-1)!.text).toContain('"required":["name"]');
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({ name: 'Tide' });
    await brain.decide({ system: [], tools: [], messages: [{ role: 'user', content: 'x' }], effort: 'low', tier: 2 });
    expect(calls[1]!.model).toBe('deepseek-v4-pro');
  });
});

describe('an empty DeepSeek account', () => {
  it('reads as the AI being down (needs a top-up), not a passing hiccup', async () => {
    const { accountDown, accountProblem } = await import('../src/agents/moments.ts');
    const e = Object.assign(new Error('402 {"error":{"message":"Insufficient Balance","type":"insufficient_balance_error"}}'), { status: 402 });
    expect(accountProblem(e)).toMatch(/top it up/);
    expect(accountDown(e)).toBe(true);
  });
});

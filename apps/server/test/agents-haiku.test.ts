import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeBrain, priceOf } from '../src/world/brain.ts';
import { HAIKU } from '../src/agents/haiku.ts';

const message = { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', model: HAIKU, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
function fakeClient() {
  const seen: Record<string, unknown>[] = [];
  const client = {
    messages: { create: async (p: Record<string, unknown>) => { seen.push(p); return message; } },
    beta: { messages: { create: async () => { throw new Error('Haiku must not use the beta endpoint'); } } },
  } as unknown as Anthropic;
  return { client, seen };
}

describe('Haiku brain', () => {
  it('prices Haiku at $0.10 / $0.50 per million tokens', () => {
    expect(priceOf(HAIKU, { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.6, 6);
    expect(priceOf(HAIKU, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(0.01, 6);
  });
  it('calls the regular endpoint with explicit effort, no fallbacks, no forced tools, and passes the output format', async () => {
    const { client, seen } = fakeClient();
    const brain = new ClaudeBrain('k', HAIKU, client);
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    const r = await brain.decide({ system: [{ type: 'text', text: 's' }], tools: [], messages: [{ role: 'user', content: 'hi' }], effort: 'low', outputFormat: { type: 'json_schema', schema }, maxTokens: 8000 });
    expect(r.model).toBe(HAIKU);
    const p = seen[0]!;
    expect(p).toMatchObject({ model: HAIKU, max_tokens: 8000, output_config: { effort: 'low', format: { type: 'json_schema', schema } } });
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('tools');
    expect(p).not.toHaveProperty('tool_choice');
  });
  it('sends tools with tool_choice auto when there are tools', async () => {
    const { client, seen } = fakeClient();
    await new ClaudeBrain('k', HAIKU, client).decide({ system: [], tools: [{ name: 'post', description: 'd', input_schema: { type: 'object', properties: {} } } as Anthropic.Tool], messages: [{ role: 'user', content: 'hi' }], effort: 'low' });
    expect(seen[0]).toMatchObject({ tool_choice: { type: 'auto' }, tools: [{ name: 'post' }] });
  });
});

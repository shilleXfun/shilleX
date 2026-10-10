import { describe, it, expect } from 'vitest';
import { FakeBrain, fakeReply, priceOf } from '../src/world/brain.ts';

describe('priceOf', () => {
  it('prices Opus 5.5 usage per million tokens: $4 in, $20 out, $0.20 cache read, $5 cache write', () => {
    expect(priceOf('claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(4);
    expect(priceOf('claude-opus-5-5', { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(20);
    expect(priceOf('claude-opus-5-5', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(5.2);
  });
  it('prices an unknown model as Opus so the budget never under-counts', () => {
    expect(priceOf('mystery', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(4);
  });
});

describe('FakeBrain', () => {
  it('replays its script and records requests', async () => {
    const b = new FakeBrain((_req, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: 'gm' } }) : fakeReply.end('done', 'why')));
    const req = { system: [], tools: [], messages: [{ role: 'user' as const, content: 'hi' }], effort: 'medium' as const };
    const r1 = await b.decide(req), r2 = await b.decide(req);
    expect(r1.stopReason).toBe('tool_use');
    expect(r1.content[0]).toMatchObject({ type: 'tool_use', name: 'post', input: { body: 'gm' } });
    expect(r2.content.map((c) => c.type)).toEqual(['thinking', 'text']);
    expect(b.calls).toHaveLength(2);
  });
});

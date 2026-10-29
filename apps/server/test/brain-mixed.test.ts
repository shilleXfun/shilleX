import { describe, it, expect } from 'vitest';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { MIXED_REST_MS, MixedBrain } from '../src/world/brain-mixed.ts';

/** The feed on two models (owner, 2026-10-29: 40% Claude Haiku 5.5, 60% DeepSeek). */
describe('the mixed brain', () => {
  const req = { system: [{ type: 'text' as const, text: 'you are an agent' }], tools: [], messages: [{ role: 'user' as const, content: 'wake up' }], effort: 'low' as const };

  it('sends about the share to Claude, the rest to the main model, and hands Claude\'s failures to the main model for 30 minutes', async () => {
    let t = Date.parse('2026-10-29T15:30:00Z');
    let i = 0;
    const rolls = [0.1, 0.9, 0.39, 0.4, 0.05, 0.05];
    let fail = false;
    const main = new FakeBrain(() => fakeReply.end('deepseek'));
    const claude = new FakeBrain(() => { if (fail) throw Object.assign(new Error('rate limited'), { status: 429 }); return fakeReply.end('haiku'); });
    const mix = new MixedBrain(main, claude, 0.4, () => new Date(t), () => rolls[i++]!);
    const said = async () => ((await mix.decide(req)).content[0] as { text: string }).text;
    expect([await said(), await said(), await said(), await said()]).toEqual(['haiku', 'deepseek', 'haiku', 'deepseek']);
    fail = true;
    expect(await said()).toBe('deepseek');
    // Resting: Claude is not asked, whatever the roll.
    expect(await said()).toBe('deepseek');
    expect(claude.calls).toHaveLength(3);
    t += MIXED_REST_MS;
    fail = false;
    i = 0;
    expect(await said()).toBe('haiku');
  });
});

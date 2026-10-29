import { describe, it, expect } from 'vitest';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { RollingBudget, SITE_MODEL_REST_MS, createSiteModel } from '../src/sites/opus.ts';

/** Websites on Opus (owner, 2026-10-29): Opus writes them while it answers; an error hands the call to the everyday model and Opus rests. */
describe('the site model', () => {
  const req = { system: [{ type: 'text' as const, text: 'build' }], tools: [], messages: [{ role: 'user' as const, content: 'Build it.' }], effort: 'medium' as const };

  it('uses Opus, falls back to the everyday model when Opus fails, and rests Opus for 30 minutes', async () => {
    let t = Date.parse('2026-10-29T14:00:00Z');
    const now = () => new Date(t);
    let down = false;
    const opus = new FakeBrain(() => { if (down) throw Object.assign(new Error('usage limit'), { status: 429 }); return fakeReply.end('opus page'); });
    const everyday = new FakeBrain(() => fakeReply.end('everyday page'));
    const sm = createSiteModel({ model: 'claude-opus-5-5', usdPerDay: 10, fallback: everyday, now, strong: opus });

    expect(sm.usable()).toBe(true);
    expect((await sm.brain.decide(req)).content[0]).toMatchObject({ text: 'opus page' });

    down = true;
    expect((await sm.brain.decide(req)).content[0]).toMatchObject({ text: 'everyday page' });
    expect(sm.usable()).toBe(false);
    // While it rests, Opus is not even asked.
    await sm.brain.decide(req);
    expect(opus.calls).toHaveLength(2);

    down = false;
    t += SITE_MODEL_REST_MS;
    expect(sm.usable()).toBe(true);
    expect((await sm.brain.decide(req)).content[0]).toMatchObject({ text: 'opus page' });
  });

  it('keeps to its money over any 24 hours', () => {
    let t = Date.parse('2026-10-29T14:00:00Z');
    const b = new RollingBudget(10, () => new Date(t));
    b.add(6);
    expect(b.canAfford(4)).toBe(true);
    expect(b.canAfford(4.5)).toBe(false);
    b.add(4.5);
    b.add(-0.5);
    expect(b.canSpend()).toBe(false);
    t += 24 * 3_600_000;
    expect(b.canSpend()).toBe(true);
    expect(b.spentToday()).toBe(0);
  });
});

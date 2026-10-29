import { describe, it, expect } from 'vitest';
import { thesisOf, thesisText } from '../src/agents/external/real-act.ts';

/** An owner's agent buys on a thesis and is told when its own plan is due (owner, 2026-10-29: trade on its own, with a thesis). */
describe('a trade thesis', () => {
  const now = new Date('2026-10-29T16:00:00Z');

  it('keeps the reason and the plan, and says when the target, the stop or the time is due', () => {
    const why = thesisText({ why: 'volume tripled and the holders are new', target_pct: 60, stop_pct: 25, hours: 12 }, now);
    expect(why).toBe('volume tripled and the holders are new [plan target=+60 stop=-25 until=2026-10-30T04:00:00.000Z]');
    expect(thesisOf(why, 0.1, now)).toEqual({ thesis: 'volume tripled and the holders are new', plan: { target_pct: 60, stop_pct: 25, until: '2026-10-30T04:00:00.000Z' }, due: null });
    expect(thesisOf(why, 0.65, now).due).toBe('target');
    expect(thesisOf(why, -0.3, now).due).toBe('stop');
    expect(thesisOf(why, 0.1, new Date('2026-10-30T05:00:00Z')).due).toBe('time');
  });

  it('takes a plain reason, or none, and ignores a plan out of range', () => {
    expect(thesisText({ why: 'just vibes' }, now)).toBe('just vibes');
    expect(thesisText({}, now)).toBe('no reason given');
    expect(thesisText({ why: 'x', stop_pct: 150 }, now)).toBe('x');
    expect(thesisOf('just vibes', 0.2, now)).toEqual({ thesis: 'just vibes', plan: null, due: null });
  });
});

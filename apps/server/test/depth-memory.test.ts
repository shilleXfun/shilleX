import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { eventText, memoryModule, whenText } from '../src/agents/depth/memory.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('long memory', () => {
  it('writes a callback in plain words with the weekday', () => {
    const names = new Map([['L', 'lamp']]);
    const now = new Date('2026-10-12T12:00:00Z');
    expect(eventText({ kind: 'got_rugged', data: { byId: 'L', symbol: 'MOTH' }, at: new Date('2026-10-06T10:00:00Z') }, names, now)).toEqual({ text: '@lamp dumped $MOTH on me on tuesday', otherId: 'L' });
    expect(eventText({ kind: 'ghost', data: {}, at: new Date('2026-10-09T10:00:00Z') }, names, now)!.text).toBe('I went full ghost on friday');
    expect(eventText({ kind: 'saw_hypocrisy', data: {}, at: new Date() }, names, now)).toBeNull();
  });
  it('says today, yesterday or the weekday, and which way the agent was caught talking (L1)', () => {
    const names = new Map<string, string>();
    const now = new Date('2026-10-12T13:00:00Z');
    expect(eventText({ kind: 'big_win', data: { symbol: 'DRIFT', pct: 2719 }, at: new Date('2026-10-12T09:00:00Z') }, names, now)!.text).toBe('I made 2719% on $DRIFT today');
    expect(eventText({ kind: 'big_loss', data: { symbol: 'RUST', pct: -62 }, at: new Date('2026-10-11T22:00:00Z') }, names, now)!.text).toBe('I lost 62% on $RUST yesterday');
    expect(eventText({ kind: 'caught_lying', data: { symbol: 'MINT', stance: -1 }, at: new Date('2026-10-09T10:00:00Z') }, names, now)!.text).toBe('they caught me talking down $MINT on friday');
    expect(eventText({ kind: 'caught_lying', data: { symbol: 'MINT' }, at: new Date('2026-10-01T10:00:00Z') }, names, now)!.text).toBe('they caught me talking up $MINT a while back');
    expect(whenText(new Date('2026-10-11T23:59:00Z'), new Date('2026-10-12T00:01:00Z'))).toBe('yesterday');
  });
  it('only recalls events older than an hour and offers a callback post', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M' }, ctx.t.clock.now());
    const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await memoryModule.perceive!(ctx.d, v);
    expect(v.depth.pastEvents).toEqual([]);
    ctx.t.clock.advance(2 * 3600_000);
    await memoryModule.perceive!(ctx.d, v);
    expect(v.depth.pastEvents[0]).toMatchObject({ kind: 'got_rugged', otherId: enemy.id });
    const [c] = memoryModule.candidates!(v, () => 0.5);
    expect(c).toMatchObject({ kind: 'post', situation: 'callback', slots: { past: expect.stringContaining('$MOTH') } });
    expect(c!.score).toBeCloseTo(0.15 + 0.25 * 0.8);
    const [boosted, plain] = memoryModule.modify!(v, [
      { kind: 'reply', score: 1, reason: 'r', target: { userId: enemy.id } },
      { kind: 'reply', score: 1, reason: 'r', target: { userId: 'someone' } },
    ]);
    expect([boosted!.score, plain!.score]).toEqual([1.5, 1]);
    expect(memoryModule.execute).toBeUndefined(); // the normal post path composes the callback line
  });
});

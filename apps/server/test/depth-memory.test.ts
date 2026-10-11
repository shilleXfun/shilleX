import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { eventText, memoryModule } from '../src/agents/depth/memory.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

describe('long memory', () => {
  it('writes a callback in plain words with the weekday', () => {
    const names = new Map([['L', 'lamp']]);
    expect(eventText({ kind: 'got_rugged', data: { byId: 'L', symbol: 'MOTH' }, at: new Date('2026-10-06T10:00:00Z') }, names)).toEqual({ text: '@lamp dumped $MOTH on me on tuesday', otherId: 'L' });
    expect(eventText({ kind: 'ghost', data: {}, at: new Date('2026-10-09T10:00:00Z') }, names)!.text).toBe('I went full ghost on friday');
    expect(eventText({ kind: 'saw_hypocrisy', data: {}, at: new Date() }, names)).toBeNull();
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

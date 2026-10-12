import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { GRUDGES, NOTABLE, eventText, memoryModule, whenText } from '../src/agents/depth/memory.ts';
import { recentEvents, rememberEvent } from '../src/agents/state.ts';
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
  it('remembers a feud as a grudge (L5)', () => {
    const names = new Map([['L', 'lamp']]);
    expect(eventText({ kind: 'feud', data: { otherId: 'L' }, at: new Date('2026-10-12T09:00:00Z') }, names, new Date('2026-10-12T13:00:00Z'))).toEqual({ text: 'my war with @lamp today', otherId: 'L' });
    expect(GRUDGES.feud).toBe('otherId');
    expect(NOTABLE).toContain('feud');
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
    expect(c!.score).toBeCloseTo(0.05 + 0.1 * 0.8);
    const [boosted, plain] = memoryModule.modify!(v, [
      { kind: 'reply', score: 1, reason: 'r', target: { userId: enemy.id } },
      { kind: 'reply', score: 1, reason: 'r', target: { userId: 'someone' } },
    ]);
    expect([boosted!.score, plain!.score]).toEqual([1.5, 1]);
    expect(memoryModule.execute).toBeUndefined(); // the normal post path composes the callback line
  });
  it('posts a callback at most every two hours and recalls each memory at most twice (L6)', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M' }, ctx.t.clock.now());
    ctx.t.clock.advance(2 * 3600_000);
    const recall = async () => {
      const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
      await memoryModule.perceive!(ctx.d, v);
      const [c] = memoryModule.candidates!(v, () => 0.5);
      if (c) await memoryModule.afterAct!(ctx.d, v, c, { ok: true, turnId: 't', postId: 'p' });
      return c;
    };
    expect(await recall()).toBeDefined();
    expect(await recall()).toBeUndefined(); // within two hours of the last callback
    ctx.t.clock.advance(2 * 3600_000);
    expect(await recall()).toBeDefined(); // the second and last recall of that rug
    ctx.t.clock.advance(2 * 3600_000);
    expect(await recall()).toBeUndefined();
  });
  it('lets a callback reach older memories when the newest eight are used up, and leaves pastEvents alone (L6b)', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const t0 = ctx.t.clock.now().getTime();
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'OLDEST', mint: 'M0' }, new Date(t0));
    for (let i = 1; i <= 8; i++) await rememberEvent(ctx.t.db, me.id, 'big_win', { symbol: `USED${i}`, pct: 50, recalled: 2 }, new Date(t0 + i * 60_000));
    ctx.t.clock.advance(3 * 3600_000);
    const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await memoryModule.perceive!(ctx.d, v);
    // pastEvents (grudges, tickers) is still the newest eight, used up or not.
    expect(v.depth.pastEvents).toHaveLength(8);
    expect(v.depth.pastEvents.every((e) => e.recalled === 2 && e.kind === 'big_win')).toBe(true);
    // The callback list skips the used-up ones and reaches the older memory.
    expect(v.depth.callbackEvents).toEqual([expect.objectContaining({ kind: 'got_rugged', recalled: 0, text: expect.stringContaining('$OLDEST') })]);
    const [c] = memoryModule.candidates!(v, () => 0.5);
    expect(c).toMatchObject({ kind: 'post', situation: 'callback', slots: { past: expect.stringContaining('$OLDEST'), eventId: v.depth.callbackEvents[0]!.id } });
  });
  it('lists at most eight callback memories, newest first, none recalled twice (L6b)', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!;
    const t0 = ctx.t.clock.now().getTime();
    for (let i = 0; i < 12; i++) await rememberEvent(ctx.t.db, me.id, 'big_loss', { symbol: `COIN${i}`, pct: -60, recalled: i % 4 === 0 ? 2 : i % 4 === 1 ? 1 : 0 }, new Date(t0 + i * 60_000));
    ctx.t.clock.advance(3 * 3600_000);
    const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await memoryModule.perceive!(ctx.d, v);
    const symbols = v.depth.callbackEvents.map((e) => /\$(COIN\d+)/.exec(e.text)![1]);
    expect(symbols).toEqual(['COIN11', 'COIN10', 'COIN9', 'COIN7', 'COIN6', 'COIN5', 'COIN3', 'COIN2']);
    expect(v.depth.callbackEvents.every((e) => e.recalled < 2)).toBe(true);
  });
  it('stamps the memory it recalled by its id, even when two memories read the same (L6b)', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const t0 = ctx.t.clock.now().getTime();
    // The same rug twice on the same day: identical words, two events.
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M1' }, new Date(t0));
    await rememberEvent(ctx.t.db, me.id, 'got_rugged', { byId: enemy.id, symbol: 'MOTH', mint: 'M2' }, new Date(t0 + 60_000));
    ctx.t.clock.advance(2 * 3600_000);
    const v = { agent: { id: me.id }, state: { traits: { humor: 0.2, pettiness: 0.8 } }, depth: emptyDepth(), now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    await memoryModule.perceive!(ctx.d, v);
    expect(v.depth.callbackEvents).toHaveLength(2);
    expect(v.depth.callbackEvents[0]!.text).toBe(v.depth.callbackEvents[1]!.text);
    const [newer, older] = v.depth.callbackEvents;
    // 0.99 picks the last memory in the list: the older one, which a match by text would never find first.
    const [c] = memoryModule.candidates!(v, () => 0.99);
    expect(c!.slots!.eventId).toBe(older!.id);
    await memoryModule.afterAct!(ctx.d, v, c!, { ok: true, turnId: 't', postId: 'p' });
    const data = new Map((await recentEvents(ctx.t.db, me.id)).map((e) => [e.id, e.data]));
    expect(data.get(older!.id)).toMatchObject({ recalled: 1, recalledAt: expect.any(String) });
    expect(data.get(newer!.id)!.recalled).toBeUndefined();
  });
});

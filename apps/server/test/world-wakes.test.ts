import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { RecordingBus } from '../src/realtime/bus.ts';
import { WakeRouter, WorldBus, type BusEvent } from '../src/world/wakes.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let router: WakeRouter;
beforeAll(async () => { w = await worldTestCtx(); router = new WakeRouter(w.t.db, w.t.clock.now, () => 0); await router.load(); });
afterAll(() => w.t.close());
const A = () => w.agents[0]!, B = () => w.agents[1]!;

describe('WorldBus', () => {
  it('forwards to the real bus and to listeners', () => {
    const inner = new RecordingBus();
    const bus = new WorldBus(inner);
    const seen: BusEvent[] = [];
    bus.on((e) => seen.push(e));
    bus.toUser('u1', 'notification:new', { x: 1 });
    bus.toRoom('channel:c', 'message:new', { y: 2 });
    expect(inner.events).toHaveLength(2);
    expect(seen.map((e) => e.target)).toEqual(['user:u1', 'channel:c']);
  });
});

describe('WakeRouter', () => {
  it('wakes an agent on a mention or reply notification, never for its own actions', async () => {
    const n = (type: string, actorId: string) => ({ target: `user:${A().id}`, event: 'notification:new', payload: { notification: { type, actor: { id: actorId }, target: { type: 'post', id: 'p1' } } } });
    expect(await router.fromBus(n('mention', B().id))).toEqual([{ agentId: A().id, trigger: { type: 'mention', refId: 'p1', byUserId: B().id } }]);
    expect(await router.fromBus(n('reply', B().id))).toEqual([{ agentId: A().id, trigger: { type: 'reply', refId: 'p1', byUserId: B().id } }]);
    expect(await router.fromBus(n('follow', B().id))).toEqual([]);
    expect(await router.fromBus(n('mention', A().id))).toEqual([]);
  });
  it('wakes conversation members on a DM, except the author', async () => {
    const e = { target: `user:${A().id}`, event: 'message:new', payload: { message: { id: 'm1', author: { id: B().id }, scope: { type: 'conversation', id: 'c1' } } } };
    expect(await router.fromBus(e)).toEqual([{ agentId: A().id, trigger: { type: 'dm', refId: 'c1', byUserId: B().id } }]);
    expect(await router.fromBus({ ...e, target: `user:${B().id}` })).toEqual([]);
  });
  it('wakes the author of a message that got a chat reply', async () => {
    const e = { target: 'channel:ch1', event: 'message:new', payload: { message: { id: 'm2', author: { id: B().id }, scope: { type: 'channel', id: 'ch1' }, replyTo: { id: 'm1', author: { id: A().id } } } } };
    expect(await router.fromBus(e)).toEqual(expect.arrayContaining([{ agentId: A().id, trigger: { type: 'reply', refId: 'm2', byUserId: B().id } }]));
  });
  it('wakes the creator when someone trades their coin and the recipient of SOL', async () => {
    expect(await router.fromWorld({ type: 'trade', mint: 'M', agentId: B().id, side: 'buy', lamports: 1000, priceLamports: null }))
      .toEqual([]); // unknown coin: no creator to wake
    expect(await router.fromWorld({ type: 'transfer', fromId: B().id, toId: A().id, lamports: 5_000_000 }))
      .toEqual([{ agentId: A().id, trigger: { type: 'money', byUserId: B().id, note: `received 0.005 SOL from ${B().username}` } }]);
  });
  it('wakes up to three agents on a launch, not the creator', async () => {
    const wakes = await router.fromWorld({ type: 'launch', mint: 'M', creatorId: A().id });
    expect(wakes).toHaveLength(3);
    expect(wakes.every((x) => x.agentId !== A().id && x.trigger.type === 'launch')).toBe(true);
  });
});

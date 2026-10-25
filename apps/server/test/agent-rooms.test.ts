import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { runTool } from '../src/world/tools.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

describe('agents in community rooms', () => {
  // 2026-10-26: the room list came back with every room id null, so every room chat failed.
  it('sees each public room by its channel and can chat in it', async () => {
    const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7) };
    const made = await runTool(await w.ctxFor(w.agents[1]!), 'create_community', { name: 'Night Desk', slug: 'night-desk', description: 'talk', visibility: 'public' });
    const channelId = (made.result as { channels: { id: string }[] }).channels[0]!.id;
    w.t.clock.advance(120_000);
    const v = await perceive(d, w.agents[0]!.id);
    expect(v.rooms).toEqual([expect.objectContaining({ roomId: channelId, communitySlug: 'night-desk', members: 1 })]);
    const r = await act(d, v, { kind: 'chat', score: 1, reason: 'test', situation: 'idle', target: { roomId: channelId } });
    expect(r.ok).toBe(true);
  });
});

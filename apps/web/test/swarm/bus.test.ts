import { describe, it, expect, vi } from 'vitest';
import type { AgentGraph } from '@shillex/shared';
import { swarm, targetsFor } from '../../src/components/swarm/bus';
import { buildSwarm } from '../../src/components/swarm/model';

describe('swarm bus', () => {
  it('delivers events, survives a throwing listener and unsubscribes', () => {
    const bad = swarm.on(() => { throw new Error('boom'); });
    const got = vi.fn();
    const off = swarm.on(got);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    swarm.emit({ kind: 'post', agentId: 'a' });
    off(); bad();
    swarm.emit({ kind: 'post', agentId: 'b' });
    expect(got).toHaveBeenCalledTimes(1);
  });
  it('resolves agents and coins it knows and leaves the rest null', () => {
    const g: AgentGraph = { nodes: ['a', 'b'].map((id) => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null })), edges: [], generatedAt: '' };
    const m = buildSwarm(g, [], null);
    expect(targetsFor(m, { kind: 'buy', agentId: 'a', mint: 'unknown-mint' })).toEqual({ from: m.index.get('a'), toNode: null, coin: null });
    expect(targetsFor(m, { kind: 'post', agentId: 'human-1' })).toEqual({ from: null, toNode: null, coin: null });
    expect(targetsFor(m, { kind: 'transfer', agentId: 'a', toId: 'b' }).toNode).toBe(m.index.get('b'));
    expect(targetsFor(m, { kind: 'transfer', agentId: 'a', toId: 'human-2' }).toNode).toBeNull();
  });
});

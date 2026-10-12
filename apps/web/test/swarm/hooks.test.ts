import { describe, expect, it } from 'vitest';
import { swarm, type SwarmEvent } from '../../src/components/swarm/bus';
import { ripple } from '../../src/components/swarm/hooks';

describe('swarm post ripples', () => {
  it('ripples once when the same post arrives as post:new and post:live', () => {
    const got: SwarmEvent[] = [];
    const off = swarm.on((e) => got.push(e));
    try {
      ripple({ postId: 'p-dup', authorId: 'a1' });
      ripple({ postId: 'p-dup', authorId: 'a1' });
      ripple({ postId: 'p-other', authorId: 'a2' });
      expect(got).toEqual([{ kind: 'post', agentId: 'a1' }, { kind: 'post', agentId: 'a2' }]);
    } finally { off(); }
  });
});

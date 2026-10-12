import { useEffect } from 'react';
import { useSocketEvent } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { swarm } from './bus';

const ripple = (p: { authorId: string }) => swarm.emit({ kind: 'post', agentId: p.authorId });

/**
 * A new post ripples on its author if the author is an agent. Signed in, followed authors arrive as post:new and everyone
 * else's public posts as post:live; visitors get post:live over /live. Only the connected socket delivers, so both shells
 * mount this.
 */
export function useSwarmPosts() {
  useSocketEvent('post:new', ripple);
  useSocketEvent('post:live', ripple);
  useEffect(() => { liveSocket.on('post:live', ripple); return () => { liveSocket.off('post:live', ripple); }; }, []);
}

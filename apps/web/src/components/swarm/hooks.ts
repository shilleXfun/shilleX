import { useEffect } from 'react';
import { useSocketEvent } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { swarm } from './bus';

const seen = new Set<string>();

/** Ripples once per post: a follower gets the same post as post:new and post:live. */
export const ripple = (p: { postId?: string; authorId: string }) => {
  if (p.postId) {
    if (seen.has(p.postId)) return;
    seen.add(p.postId);
    if (seen.size > 200) seen.delete(seen.values().next().value as string);
  }
  swarm.emit({ kind: 'post', agentId: p.authorId });
};

/**
 * A new post ripples on its author if the author is an agent. Signed in, followed authors' posts arrive as both post:new
 * and post:live (and community posts as post:new only); visitors get post:live over /live. Only the connected socket
 * delivers, so both shells mount this.
 */
export function useSwarmPosts() {
  useSocketEvent('post:new', ripple);
  useSocketEvent('post:live', ripple);
  useEffect(() => { liveSocket.on('post:live', ripple); return () => { liveSocket.off('post:live', ripple); }; }, []);
}

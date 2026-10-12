import { useSocketEvent } from '../../lib/socket';
import { swarm } from './bus';

/** Signed-in shell only (the socket needs a session): a new post ripples on its author if the author is an agent. */
export function useSwarmPosts() {
  useSocketEvent('post:new', (p) => swarm.emit({ kind: 'post', agentId: p.authorId }));
}

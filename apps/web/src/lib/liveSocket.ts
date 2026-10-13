import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents } from '@shillex/shared';

/** Visitors without a session: a separate namespace that only carries public events (agent pulses, new public posts and timeline bumps). */
export const liveSocket: Socket<Pick<ServerToClientEvents, 'agents:pulse' | 'post:live' | 'activity:bump'>> = io('/live', { path: '/socket.io', autoConnect: false, transports: ['websocket', 'polling'] });

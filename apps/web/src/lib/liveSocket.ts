import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents } from '@shillex/shared';

/** Visitors without a session: a separate namespace that only carries public events (agent pulses and new public posts). */
export const liveSocket: Socket<Pick<ServerToClientEvents, 'agents:pulse' | 'post:live'>> = io('/live', { path: '/socket.io', autoConnect: false, transports: ['websocket', 'polling'] });

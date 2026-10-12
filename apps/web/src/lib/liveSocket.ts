import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents } from '@shillex/shared';

/** Visitors without a session: a separate namespace that only carries public agent pulses. */
export const liveSocket: Socket<Pick<ServerToClientEvents, 'agents:pulse'>> = io('/live', { path: '/socket.io', autoConnect: false, transports: ['websocket', 'polling'] });

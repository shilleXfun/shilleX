import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents } from '@shillex/shared';
import { socket } from './socket';

/** Visitors without a session: a separate namespace that only carries public events (agent pulses, new public posts and timeline bumps). */
export const liveSocket: Socket<Pick<ServerToClientEvents, 'agents:pulse' | 'post:live' | 'activity:bump'>> = io('/live', { path: '/socket.io', autoConnect: false, transports: ['websocket', 'polling'] });

/**
 * Whether live updates are really arriving: either socket (the session's or the visitors') is connected. A drop shorter than
 * 2 s is not reported, so the first connect and a quick blip never flash "reconnecting". Used wherever the page says "live".
 */
export function useLiveConnected(): boolean {
  const now = () => socket.connected || liveSocket.connected;
  const [up, setUp] = useState(true);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      if (now()) setUp(true);
      else t = setTimeout(() => setUp(now()), 2000);
    };
    check();
    const all = [socket, liveSocket] as unknown as { on(e: string, f: () => void): void; off(e: string, f: () => void): void }[];
    for (const s of all) { s.on('connect', check); s.on('disconnect', check); }
    return () => { clearTimeout(t); for (const s of all) { s.off('connect', check); s.off('disconnect', check); } };
  }, []);
  return up;
}

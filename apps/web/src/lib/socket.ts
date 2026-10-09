import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomScope, ServerToClientEvents } from '@shillex/shared';

export type ShillexSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const socket: ShillexSocket = io({ path: '/socket.io', withCredentials: true, autoConnect: false, transports: ['websocket', 'polling'] });

const rooms = new Map<string, number>();
const subscribe = (scope: RoomScope, id: string) => socket.emit('subscribe', { scope, id }, () => undefined);
socket.on('connect', () => {
  for (const key of rooms.keys()) {
    const i = key.indexOf(':');
    subscribe(key.slice(0, i) as RoomScope, key.slice(i + 1));
  }
});

export function joinRoom(scope: RoomScope, id: string): () => void {
  const key = `${scope}:${id}`;
  const n = rooms.get(key) ?? 0;
  rooms.set(key, n + 1);
  if (n === 0 && socket.connected) subscribe(scope, id);
  return () => {
    const left = (rooms.get(key) ?? 1) - 1;
    if (left <= 0) { rooms.delete(key); if (socket.connected) socket.emit('unsubscribe', { scope, id }); }
    else rooms.set(key, left);
  };
}
export function useRoom(scope: RoomScope, id: string | null | undefined) {
  useEffect(() => (id ? joinRoom(scope, id) : undefined), [scope, id]);
}

export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = (...args: unknown[]) => (ref.current as (...a: unknown[]) => void)(...args);
    socket.on(event, h as never);
    return () => { socket.off(event, h as never); };
  }, [event]);
}

type ConnState = 'connected' | 'connecting' | 'offline';
let state: ConnState = 'connecting';
const listeners = new Set<() => void>();
const setState = (s: ConnState) => { state = s; listeners.forEach((l) => l()); };
socket.on('connect', () => setState('connected'));
socket.on('disconnect', () => setState('connecting'));
socket.io.on('reconnect_attempt', () => setState('connecting'));
socket.io.on('reconnect_failed', () => setState('offline'));
socket.on('connect_error', () => setState(navigator.onLine ? 'connecting' : 'offline'));
export function useConnectionState(): ConnState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}

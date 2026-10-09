import { useSyncExternalStore } from 'react';

export interface Store<T> { get(): T; set(v: T | ((p: T) => T)): void; subscribe(l: () => void): () => void }
export function createStore<T>(initial: T): Store<T> {
  let v = initial; const ls = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => { v = typeof n === 'function' ? (n as (p: T) => T)(v) : n; ls.forEach((l) => l()); },
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l); }; },
  };
}
export const useStore = <T,>(s: Store<T>) => useSyncExternalStore(s.subscribe, s.get, s.get);

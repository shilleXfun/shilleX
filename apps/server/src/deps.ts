import type { TokenView } from '@shillex/shared';
import type { Db } from './db/client.ts';
import type { Config } from './config.ts';

export interface EventBus {
  toRoom(room: string, event: string, payload: unknown): void;
  toUser(userId: string, event: string, payload: unknown): void;
  evict(userId: string, room: string): void;
  /** Remove every socket in `room` whose user is not in `keepUserIds`. */
  evictAllExcept(room: string, keepUserIds: string[]): void | Promise<void>;
}
export interface TokenResolverPort {
  enqueue(mints: string[]): void;
  resolve(mint: string): Promise<TokenView>;
  getViews(mints: string[]): Promise<Record<string, TokenView>>;
}
export interface PresenceRegistry {
  connect(userId: string, socketId: string): boolean;
  disconnect(userId: string, socketId: string): boolean;
  isOnline(userId: string): boolean;
  countOnline(userIds: string[]): number;
}
export interface AppDeps { db: Db; dbKind: 'pglite' | 'postgres'; config: Config; bus: EventBus; tokens: TokenResolverPort; presence: PresenceRegistry; now: () => Date }

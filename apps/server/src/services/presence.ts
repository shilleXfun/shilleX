import type { PresenceRegistry } from '../deps.ts';
export class InMemoryPresence implements PresenceRegistry {
  private sockets = new Map<string, Set<string>>();
  connect(userId: string, socketId: string) {
    const set = this.sockets.get(userId) ?? new Set();
    const wasOnline = set.size > 0;
    set.add(socketId); this.sockets.set(userId, set);
    return !wasOnline;
  }
  disconnect(userId: string, socketId: string) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { this.sockets.delete(userId); return true; }
    return false;
  }
  isOnline(userId: string) { return (this.sockets.get(userId)?.size ?? 0) > 0; }
  countOnline(userIds: string[]) { return userIds.reduce((n, id) => n + (this.isOnline(id) ? 1 : 0), 0); }
  /** demo personas marked online by the simulator */
  setVirtual(userId: string, online: boolean) { online ? this.connect(userId, 'virtual') : this.disconnect(userId, 'virtual'); }
}

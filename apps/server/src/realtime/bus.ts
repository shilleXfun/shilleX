import type { EventBus } from '../deps.ts';

export class RecordingBus implements EventBus {
  events: { target: string; event: string; payload: any }[] = [];
  evictions: { userId: string; room: string }[] = [];
  toRoom(room: string, event: string, payload: unknown) { this.events.push({ target: room, event, payload }); }
  toUser(userId: string, event: string, payload: unknown) { this.events.push({ target: `user:${userId}`, event, payload }); }
  evict(userId: string, room: string) { this.evictions.push({ userId, room }); }
  evictAllExceptCalls: { room: string; keepUserIds: string[] }[] = [];
  evictAllExcept(room: string, keepUserIds: string[]) { this.evictAllExceptCalls.push({ room, keepUserIds }); }
  find(event: string) { return this.events.filter((e) => e.event === event); }
  clear() { this.events = []; this.evictions = []; this.evictAllExceptCalls = []; }
}

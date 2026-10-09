import { LIMITS, tokenizeBody } from '@shillex/shared';

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  hit(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((this.windowMs - (nowMs - recent[0]!)) / 1000)) };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return { ok: true };
  }
}

export const normalizeBody = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export class DuplicateFilter {
  private seen = new Map<string, Map<string, number>>();
  constructor(private windowMs: number) {}
  isDuplicate(userId: string, body: string, nowMs: number): boolean {
    const norm = normalizeBody(body);
    if (norm.length < 4) return false;
    const mine = this.seen.get(userId) ?? new Map<string, number>();
    for (const [k, t] of mine) if (nowMs - t >= this.windowMs) mine.delete(k);
    const dup = mine.has(norm);
    mine.set(norm, nowMs);
    this.seen.set(userId, mine);
    return dup;
  }
}

export function checkSlowMode(last: Date | null, slowSec: number, now: Date): { ok: true } | { ok: false; retryAfterSec: number } {
  if (!slowSec || !last) return { ok: true };
  const wait = slowSec * 1000 - (now.getTime() - last.getTime());
  return wait > 0 ? { ok: false, retryAfterSec: Math.ceil(wait / 1000) } : { ok: true };
}

export const linkMentionCount = (body: string) => tokenizeBody(body).filter((s) => s.type !== 'text').length;
export const isNewAccount = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < LIMITS.newAccountMs;

export interface MessageGuards { rate: RateLimiter; dupes: DuplicateFilter }
export const createGuards = (): MessageGuards => ({
  rate: new RateLimiter(LIMITS.messageRateCount, LIMITS.messageRateWindowMs),
  dupes: new DuplicateFilter(LIMITS.duplicateWindowMs),
});

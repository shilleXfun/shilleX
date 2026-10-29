/**
 * Per-key request limits for the open API: one token bucket for reads and one for acts, each holding a minute's worth and
 * refilling evenly. In memory (one server process). Buckets are kept per agent, which has exactly one live key: rotating the
 * key must not hand out a fresh, full bucket.
 */
/** 'trade' (a buy or a sell) takes no token: trades are not rate limited (owner, 2026-10-29), only the owner's hard limits hold. */
export type LimitKind = 'read' | 'act' | 'trade';
interface Bucket { tokens: number; at: number }

export class KeyLimits {
  private buckets = new Map<string, Bucket>();
  private sweptAt = 0;
  constructor(private perMin: (kind: LimitKind) => number) {}

  /** Takes one token; when there is none, says how many whole seconds until there is. */
  take(agentId: string, kind: LimitKind, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    if (kind === 'trade') return { ok: true };
    const cap = Math.max(1, this.perMin(kind));
    const perMs = cap / 60_000;
    const id = `${kind}:${agentId}`;
    const b = this.buckets.get(id) ?? { tokens: cap, at: nowMs };
    b.tokens = Math.min(cap, b.tokens + Math.max(0, nowMs - b.at) * perMs);
    b.at = nowMs;
    this.buckets.set(id, b);
    this.sweep(nowMs);
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000)) };
  }

  /** Forgets buckets idle for over a minute (they would be full again anyway). */
  private sweep(nowMs: number) {
    if (nowMs - this.sweptAt < 60_000) return;
    this.sweptAt = nowMs;
    for (const [id, b] of this.buckets) if (nowMs - b.at > 60_000) this.buckets.delete(id);
  }
}

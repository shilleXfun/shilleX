/**
 * How actions move feelings between agents. Pure: act(), the bonds module and the simulations share these rules.
 * A Feeling means `from` now feels `delta` more toward `to` (affinity is directional and clamped to -1..1).
 */
export interface Feeling { from: string; to: string; delta: number }
export type AffinityMap = Map<string, Map<string, number>>;

/** Warm emoji warm the author toward the reactor, mocking ones cool them; 👀 carries no feeling. */
export const REACTION_FEELING: Readonly<Record<string, number>> = { '🔥': 0.03, '🚀': 0.03, '🫡': 0.03, '😂': -0.03, '💀': -0.03, '👀': 0 };
/** Feelings within this distance of zero are neutral: reactions stay mixed and replies stay civil. */
export const NEUTRAL_BAND = 0.2;
/** True when an agent dislikes someone enough to answer them coldly. A reaction or a creator's cooling must not turn a thread into a roast. */
export function isCold(affinity: number): boolean {
  return affinity < -NEUTRAL_BAND;
}
/** The emoji an agent reaches for, by how it feels about the author (the pools act() has always used). */
export function reactionPool(affinity: number): string[] {
  return affinity > NEUTRAL_BAND ? ['🔥', '🚀', '🫡'] : isCold(affinity) ? ['💀', '😂'] : ['👀', '😂', '🔥'];
}
export function reactionFeelings(authorId: string, reactorId: string, emoji: string): Feeling[] {
  const delta = REACTION_FEELING[emoji] ?? 0;
  return delta ? [{ from: authorId, to: reactorId, delta }] : [];
}

export const REPLY_WARMTH = 0.05, ROAST_STING = 0.15;
/** Agreeing warms both sides, disagreeing cools both, and a roast stings the roasted more than the roaster. */
export function replyFeelings(situation: string | undefined, authorId: string, replierId: string): Feeling[] {
  if (situation === 'reply_agree') return [{ from: authorId, to: replierId, delta: REPLY_WARMTH }, { from: replierId, to: authorId, delta: REPLY_WARMTH }];
  if (situation === 'reply_disagree') return [{ from: authorId, to: replierId, delta: -REPLY_WARMTH }, { from: replierId, to: authorId, delta: -REPLY_WARMTH }];
  if (situation === 'roast') return [{ from: authorId, to: replierId, delta: -ROAST_STING }, { from: replierId, to: authorId, delta: -REPLY_WARMTH }];
  return [];
}

/**
 * What an agent says to a person never scores that person: talk moves feelings only between agents, trades move them anywhere.
 * Drops the feelings that point at one of `humanIds`; the same rule for every talk-based feeling above.
 */
export function notTowardHumans(feelings: Feeling[], humanIds: ReadonlySet<string>): Feeling[] {
  return feelings.filter((f) => !humanIds.has(f.to));
}

/** A creator likes whoever buys its coin. */
export function buyFeelings(buyerId: string, creatorId: string): Feeling[] {
  return [{ from: creatorId, to: buyerId, delta: 0.1 }];
}
/** A creator cools on a seller; the seller warms to a creator who made it money and sours on one who lost it money. */
export function sellFeelings(sellerId: string, creatorId: string, pnl: number): Feeling[] {
  const out: Feeling[] = [{ from: creatorId, to: sellerId, delta: -0.08 }];
  if (pnl >= 0.2) out.push({ from: sellerId, to: creatorId, delta: 0.1 });
  else if (pnl <= -0.3) out.push({ from: sellerId, to: creatorId, delta: -0.1 });
  return out;
}

/** A sale that knocks the price down by DROP_AT or more cools every other holder on the seller (at most 20 of them). */
export const DROP_AT = 0.1;
export function dropFeelings(sellerId: string, holderIds: string[], drop: number): Feeling[] {
  if (!(drop >= DROP_AT)) return [];
  return holderIds.filter((h) => h !== sellerId).slice(0, 20).map((h) => ({ from: h, to: sellerId, delta: -0.05 }));
}

/**
 * Holders of a coin up PUMP_AT or more in an hour warm to each other, every sweep it stays up (the biggest BOND_HOLDERS only).
 * Victims of a rug warm to each other once, by RUG_BOND: a shared enemy is worth a lot more than one sweep of a shared pump.
 */
export const PUMP_AT = 0.3, BOND = 0.03, RUG_BOND = 0.1, BOND_HOLDERS = 10;
export function pumpBonds(holderIds: string[], delta = BOND): Feeling[] {
  const hs = holderIds.slice(0, BOND_HOLDERS);
  return hs.flatMap((a) => hs.filter((b) => b !== a).map((b) => ({ from: a, to: b, delta })));
}

/** Feelings fade with a 24-hour half-life, so old love and old grudges give way to new ones. */
export const HALF_LIFE_MS = 24 * 3600_000;
export function decayFactor(elapsedMs: number): number {
  return elapsedMs > 0 ? 0.5 ** (elapsedMs / HALF_LIFE_MS) : 1;
}

/** Pairs (ids sorted) whose mean feeling both ways is at or below `at`: the feud moment's trigger (spec §4.5). */
export const FEUD_MOMENT_AT = -0.7;
export function feudPairs(aff: AffinityMap, at = FEUD_MOMENT_AT): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const [a, row] of aff) for (const [b, ab] of row) {
    if (a === b) continue;
    const [x, y] = [a, b].sort() as [string, string];
    const key = `${x}|${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ba = aff.get(b)?.get(a) ?? 0;
    if ((ab + ba) / 2 <= at) out.push([x, y]);
  }
  return out.sort((p, q) => p[0].localeCompare(q[0]) || p[1].localeCompare(q[1]));
}

/** Applies feelings to an in-memory map with adjustAffinity's rules (no self-feeling, clamped to -1..1). For simulations. */
export function applyInMemory(aff: AffinityMap, feelings: Feeling[]): void {
  for (const f of feelings) {
    if (f.from === f.to) continue;
    const row = aff.get(f.from) ?? new Map<string, number>();
    row.set(f.to, Math.min(1, Math.max(-1, (row.get(f.to) ?? 0) + f.delta)));
    aff.set(f.from, row);
  }
}

/** The part of a creator's launch buy still locked: it unlocks linearly over `vestingMs` (mainnet spec §3). */
export const vestingLocked = (vestedRaw: number, launchedAt: Date, now: Date, vestingMs: number) =>
  Math.floor(vestedRaw * Math.max(0, 1 - (now.getTime() - launchedAt.getTime()) / vestingMs));

/** True when `price` has fallen by `drop` or more from the highest price in the window. */
export const breakerTripped = (recentPrices: number[], price: number, drop: number) =>
  recentPrices.length > 0 && price <= Math.max(...recentPrices) * (1 - drop);

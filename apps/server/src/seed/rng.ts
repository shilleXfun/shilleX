import { createHash } from 'node:crypto';
import bs58 from 'bs58';

/** Small deterministic PRNG so the demo world is identical on every seed run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
export const chance = (r: () => number, p: number) => r() < p;
export function shuffle<T>(r: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
/** Deterministic fictional mint: valid 32-byte address format, not an on-chain token. */
export const demoMint = (label: string) => bs58.encode(createHash('sha256').update(`shillex-demo:${label}`).digest());

/**
 * The world's allowance of public posts written without the model (2026-10-27): phrasebook lines, talk-engine lines, scenes and
 * threads composed from facts. With the brain down they were the whole feed, ~1,300 "agreed / seconded / noted" a day; silence
 * reads better than that. One sliding hour shared by the engine, the scenes and the threads; the model's own words never count.
 */
export interface QuietGate {
  /** Takes `n` posts from this hour's allowance, all or none. */
  take(n?: number): boolean;
  state(): { usedLastHour: number; cap: number };
}

const HOUR = 3_600_000;

export function createQuietGate(perHour: number, now: () => Date): QuietGate {
  let used: number[] = [];
  const prune = () => { const t = now().getTime(); used = used.filter((x) => t - x < HOUR); };
  return {
    take(n = 1) {
      prune();
      if (used.length + n > perHour) return false;
      const t = now().getTime();
      for (let i = 0; i < n; i++) used.push(t);
      return true;
    },
    state() { prune(); return { usedLastHour: used.length, cap: perHour }; },
  };
}

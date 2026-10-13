/** At most this many motion effects run at once; a new one ends the oldest (density spec §2: "the newest win"). */
export const MOTION_MAX = 8;
const running: (() => void)[] = [];

/**
 * Claims a slot for one effect. `stop` ends the effect early, and is called when a newer effect needs the slot. Returns
 * null while the page is hidden (nothing animates out of sight), else a release function to call when the effect ends.
 */
export function claimMotion(stop: () => void): (() => void) | null {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  if (running.length >= MOTION_MAX) running.shift()!();
  running.push(stop);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = running.indexOf(stop);
    if (i >= 0) running.splice(i, 1);
  };
}
export const motionsRunning = () => running.length;
export function resetMotionBudget() { running.length = 0; }

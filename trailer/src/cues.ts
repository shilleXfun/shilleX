import beats from './beats.json';

/** The frame a named cue starts at (beats.json markers, in seconds). Every cut in the trailer comes from here. */
export const FPS = beats.fps;
export type Cue = keyof typeof beats.markers;
export const at = (cue: Cue) => Math.round(beats.markers[cue] * FPS);
export const span = (from: Cue, to: Cue) => at(to) - at(from);

/** The first sentences of a real post, cut to about `max` characters on a sentence or a comma, never mid-word. */
export function cutText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (stop > max * 0.45) return head.slice(0, stop + 1);
  const comma = head.lastIndexOf(', ');
  if (comma > max * 0.55) return `${head.slice(0, comma)}…`;
  return `${head.slice(0, head.lastIndexOf(' '))}…`;
}

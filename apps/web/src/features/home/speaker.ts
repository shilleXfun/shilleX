import type { CSSProperties } from 'react';
import { faceHue, type UserSummary } from '@shillex/shared';

const hues = new Map<string, number>();
/**
 * The hue of a user's face (packages/shared face.ts: its tile's colour), so a speaker's name and bubbles match their
 * picture. The seed is the id in /api/agents/avatars/<id>.svg, else the user id.
 */
export function speakerHue(u: Pick<UserSummary, 'id' | 'avatarUrl'>): number {
  const seed = /\/avatars\/([^/]+)\.svg$/.exec(u.avatarUrl)?.[1] ?? u.id;
  let hue = hues.get(seed);
  if (hue === undefined) { hue = faceHue(seed); hues.set(seed, hue); }
  return hue;
}

/** `--hue` for CSS that tints a speaker's name and bubbles. */
export const hueStyle = (u: Pick<UserSummary, 'id' | 'avatarUrl'>) => ({ '--hue': speakerHue(u) }) as CSSProperties;

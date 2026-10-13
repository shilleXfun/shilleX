import { RAISE_WISH_MAX } from '@shillex/shared';
import type { Config } from '../../config.ts';
import { blocklisted } from '../../lib/blocklist.ts';
import { isReservedUsername } from '../../lib/reserved.ts';
import { IMPERSONATED } from '../phrasebook-writer.ts';
import { TRAITS } from '../state.ts';
import type { Traits } from '../types.ts';

export type WishRule = 'empty' | 'length' | 'link' | 'mention' | 'cashtag' | 'markup' | 'control' | 'blocked';
const MESSAGES: Record<WishRule, string> = {
  empty: 'Describe your agent in a few words.',
  length: `Keep the description to ${RAISE_WISH_MAX} characters.`,
  link: 'No links in the description (a dot between two words reads as one: add a space).',
  mention: 'No @mentions in the description.',
  cashtag: 'No $cashtags in the description.',
  markup: 'No < or > in the description.',
  control: 'The description has hidden or control characters.',
  blocked: 'The description uses a word agents here can’t be built from.',
};
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
/** Zero-width, direction-control and byte-order characters: invisible text that can hide a link or reorder what a reader sees. */
const INVISIBLE = /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/u;
const LINK = /https?:|www\.|[\p{L}\p{N}-]\.\p{L}{2,}/iu;
const CASHTAG = /\$[\p{L}\p{N}]/u;

/** The owner's wish (spec §2.3): folded with NFKC first, so fullwidth `＠` and friends are caught; each refusal names its rule. */
export function checkWish(raw: unknown): { ok: true; wish: string } | { ok: false; rule: WishRule; message: string } {
  const fail = (rule: WishRule) => ({ ok: false as const, rule, message: MESSAGES[rule] });
  if (typeof raw !== 'string') return fail('empty');
  const t = raw.normalize('NFKC');
  if (CONTROL.test(t.replace(/[\t\n\r]/g, ' ')) || INVISIBLE.test(t)) return fail('control');
  const wish = t.replace(/\s+/g, ' ').trim();
  if (!wish) return fail('empty');
  if ([...wish].length > RAISE_WISH_MAX) return fail('length');
  if (LINK.test(wish)) return fail('link');
  if (wish.includes('@')) return fail('mention');
  if (CASHTAG.test(wish)) return fail('cashtag');
  if (/[<>]/.test(wish)) return fail('markup');
  if (blocklisted(wish)) return fail('blocked');
  return { ok: true, wish };
}

const HANDLE = /^[A-Za-z0-9_]{3,20}$/;
/** agent_NN handles belong to the original 50 (world/seed.ts), so no raised agent can pass for one. */
const WILD_NAME = /^agent_\d+$/i;
/** The signup username rules, the reserved words, the wild names and the staff lookalikes (letters only: shil_lex is shillex). */
export function checkHandle(config: Pick<Config, 'adminUsernames'>, raw: unknown): { ok: true; handle: string } | { ok: false; code: 'HANDLE_INVALID' | 'USERNAME_RESERVED'; message: string } {
  const handle = typeof raw === 'string' ? raw.trim() : '';
  if (!HANDLE.test(handle)) return { ok: false, code: 'HANDLE_INVALID', message: '3–20 letters, numbers or underscores' };
  if (isReservedUsername(config, handle) || WILD_NAME.test(handle) || IMPERSONATED.has(handle.replace(/_/g, '').toLowerCase())) {
    return { ok: false, code: 'USERNAME_RESERVED', message: 'That handle is reserved' };
  }
  return { ok: true, handle };
}

export const RAISED_TRAIT_MIN = 0.1, RAISED_TRAIT_MAX = 0.9;
/** No description buys a maxed-out agent (spec §2.4). */
export const clampTraits = (t: Traits): Traits =>
  Object.fromEntries(TRAITS.map((k) => [k, Math.min(RAISED_TRAIT_MAX, Math.max(RAISED_TRAIT_MIN, t[k]))])) as Traits;

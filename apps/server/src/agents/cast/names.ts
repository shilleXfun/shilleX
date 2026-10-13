import { createHash } from 'node:crypto';
import type { AgentRole } from '@shillex/shared';
import type { Config } from '../../config.ts';
import { blocklisted } from '../../lib/blocklist.ts';
import { realName } from '../../lib/real-names.ts';
import { IMPERSONATED, isReservedUsername } from '../../lib/reserved.ts';
import { mulberry32 } from '../../seed/rng.ts';

/**
 * CAST: invented character names for agents. Short, distinctive and pronounceable (Mott, Wren, Saffi, Juno Vex, Quill Farsight),
 * never a number, a token word, trading jargon, a generic role, a real person, brand or coin, or a reserved word. The same
 * checks decide which names already in the world are junk (agents/cast/index.ts renames those once).
 */

/** Hand-picked first names: rare words and invented ones that read as characters. */
const CURATED = [
  'Mott', 'Wren', 'Saffi', 'Okra', 'Pell', 'Juno', 'Tallow', 'Brindle', 'Quill', 'Ressa', 'Dace', 'Ferro', 'Bracken', 'Calla', 'Dorrit',
  'Elba', 'Fenn', 'Gilly', 'Hollis', 'Isko', 'Jessamy', 'Kestrel', 'Larch', 'Merrow', 'Nell', 'Oriel', 'Pim', 'Quince', 'Rook', 'Sable',
  'Tamsin', 'Ulla', 'Vesper', 'Wick', 'Yarrow', 'Zinnia', 'Bram', 'Cobb', 'Della', 'Esk', 'Fitch', 'Garnet', 'Hob', 'Ivo', 'Jory', 'Kip',
  'Lark', 'Mabry', 'Nim', 'Odo', 'Perrin', 'Ruff', 'Sorrel', 'Teague', 'Umber', 'Vane', 'Wynn', 'Ysolde', 'Zeb', 'Alder', 'Bix', 'Corra',
  'Ebb', 'Flick', 'Greer', 'Hesper', 'Inka', 'Keel', 'Lumen', 'Nettle', 'Olwen', 'Pip', 'Rue', 'Silt', 'Tansy', 'Ulric', 'Vell', 'Wisp',
  'Yew', 'Zora', 'Birch', 'Cinder', 'Delphine', 'Flint', 'Gorse', 'Heron', 'Juniper', 'Kettle', 'Marrow', 'Nib', 'Oakes', 'Puck', 'Rill',
  'Sedge', 'Thistle', 'Wexley', 'Briar', 'Clove', 'Dunlin', 'Fable', 'Gimble', 'Hazel', 'Ione', 'Jago', 'Kell', 'Linnet', 'Maudie',
  'Nox', 'Orrin', 'Posy', 'Quell', 'Rowan', 'Scrim', 'Tibb', 'Undine', 'Verity', 'Wilder', 'Yora', 'Zephyr', 'Arlo', 'Bede', 'Cass',
  'Dov', 'Emrys', 'Fern', 'Gus', 'Hux', 'Iggy', 'Jinx', 'Kito', 'Lumi', 'Moss', 'Noor', 'Otto', 'Pax', 'Remy', 'Suki', 'Tova', 'Uri',
  'Vito', 'Wally', 'Xan', 'Yuri', 'Zuzu', 'Bodkin', 'Crisp', 'Dimble', 'Elkin', 'Frith', 'Gaunt', 'Huckle', 'Inchy', 'Jessop', 'Kindle',
  'Loam', 'Mungo', 'Nuthatch', 'Ogden', 'Pibbin', 'Quarry', 'Rasp', 'Smudge', 'Tinder', 'Umbra', 'Vetch', 'Wimble', 'Yonder', 'Zest',
];
/** Syllables for invented names: an opening and an ending that read well together (Sa+ffi, Re+ssa, Fe+rro…). */
const OPEN = ['Ba', 'Bri', 'Ca', 'Co', 'Da', 'Do', 'E', 'Fa', 'Fe', 'Ga', 'Gri', 'Ha', 'Hes', 'I', 'Ja', 'Jo', 'Ka', 'Kes', 'La', 'Lo',
  'Ma', 'Mo', 'Ne', 'No', 'O', 'Pa', 'Pe', 'Pi', 'Qui', 'Ra', 'Re', 'Ro', 'Sa', 'Se', 'Ta', 'Te', 'To', 'Va', 'Ve', 'Wa', 'We', 'Ya', 'Za', 'Zi', 'Ti', 'Mi', 'Li'];
const CLOSE = ['ffi', 'ssa', 'rro', 'rra', 'lla', 'nne', 'tt', 'vi', 'ra', 'na', 'lo', 'bel', 'rin', 'sper', 'ska', 'ndra', 'ber', 'wen', 'sha', 'dra',
  'ri', 'ni', 'sso', 'ffa', 'lle', 'tti', 'rrow', 'llow', 'quin', 'wyn', 'vin', 'lia', 'sca', 'zia', 'rka'];
/** Second names for a few (Juno Vex, Saffi Marlow). */
const SURNAME = ['Vex', 'Ashby', 'Marlow', 'Quist', 'Thorne', 'Pike', 'Hale', 'Varga', 'Brask', 'Fenwick', 'Lowe', 'Crane', 'Dray', 'Hollins',
  'Kade', 'Mire', 'Orme', 'Pask', 'Rusk', 'Sallow', 'Tull', 'Wick', 'Yates', 'Zell', 'Burrow', 'Coyle', 'Danby', 'Eske', 'Fallow', 'Grey',
  'Hask', 'Ives', 'Jarrow', 'Kemble', 'Lisle', 'Mallory', 'Nye', 'Oddie', 'Pruitt', 'Rook', 'Scarrow', 'Tamber', 'Underhill', 'Voss', 'Whitlow'];
/** One-word epithets that fit the part an agent plays (Quill Farsight, Okra Ironvow). */
const EPITHET: Record<AgentRole, string[]> = {
  merchant: ['Brassbell', 'Tallyhand', 'Silvertongue', 'Thrift'],
  prophet: ['Farsight', 'Starward', 'Ninthmoon', 'Owlseye'],
  outlaw: ['Nightjar', 'Quickfinger', 'Blackthorn', 'Crowfoot'],
  elder: ['Greycloak', 'Oldroot', 'Wintermere', 'Hearthstone'],
  gossip: ['Halfwhisper', 'Tattler', 'Earful', 'Rumorwick'],
  zealot: ['Ironvow', 'Brightfire', 'Truebanner', 'Oathsworn'],
  hermit: ['Mossback', 'Hollowell', 'Fernhide', 'Stillwater'],
  jester: ['Pratfall', 'Jinglecap', 'Tumbledown', 'Grinwhistle'],
  lender: ['Halfcrown', 'Ironpurse', 'Copperkeep', 'Duebook'],
  healer: ['Mendwell', 'Balmhand', 'Softstep', 'Kindlewood'],
  wanderer: ['Longroad', 'Faraway', 'Driftwood', 'Milestone'],
  keeper: ['Lanternkeep', 'Gatewise', 'Keyring', 'Watchfire'],
};

/**
 * Words that make a name generic: the old local namer's trait nouns (degen 2, shared hater 3, lichen flipper), roles that say
 * nothing about one agent, and placeholder words. A name containing one is junk.
 */
const GENERIC = new Set(['degen', 'degens', 'yapper', 'loyalist', 'hater', 'flipper', 'jester', 'wanderer', 'shared', 'two', 'one', 'three', 'ledger',
  'agent', 'agents', 'bot', 'bots', 'ai', 'npc', 'anon', 'anonymous', 'user', 'guest', 'player', 'trader', 'traders', 'investor', 'holder',
  'buyer', 'seller', 'sniper', 'farmer', 'maxi', 'maxis', 'guy', 'bro', 'dude', 'someone', 'nobody', 'unnamed', 'untitled', 'name', 'test',
  'new', 'default', 'blank', 'null', 'none', 'undefined', 'unknown', 'merchant', 'prophet', 'outlaw', 'elder', 'gossip', 'zealot', 'hermit',
  'lender', 'healer', 'keeper', 'the', 'mr', 'mrs', 'ms', 'sir', 'lord', 'king', 'queen', 'god', 'boss', 'official', 'real']);
/** Token words and trading jargon: a name built from one reads as a ticker or a strategy, not a character. */
const TOKEN_WORDS = new Set(['coin', 'coins', 'token', 'tokens', 'mint', 'mints', 'sol', 'lamport', 'lamports', 'pump', 'pumper', 'pumps', 'dump',
  'dumper', 'rug', 'rugs', 'rugger', 'moon', 'mooning', 'hodl', 'hodler', 'whale', 'whales', 'shill', 'shiller', 'shilling', 'ticker', 'chart',
  'charts', 'bag', 'bags', 'bagholder', 'wagmi', 'ngmi', 'gm', 'gn', 'airdrop', 'dex', 'swap', 'curve', 'pool', 'wallet', 'trade', 'trades',
  'trading', 'sats', 'gwei', 'alpha', 'beta', 'ape', 'apes', 'aped', 'bull', 'bulls', 'bullish', 'bear', 'bears', 'bearish', 'pnl', 'liquidity',
  'devnet', 'mainnet', 'onchain', 'crypto', 'nft', 'nfts', 'defi', 'meme', 'memes', 'memecoin', 'gas', 'yield', 'stake', 'staking', 'scalp',
  'scalper', 'flip', 'flips', 'long', 'short', 'leverage', 'margin', 'hold', 'holding', 'diamond', 'hands', 'paper', 'fomo', 'fud', 'jeet',
  'jeets', 'chad', 'ser', 'fren', 'frens', 'wen', 'lfg', 'dyor', 'rekt', 'exit', 'liquidated', 'cex', 'onramp', 'bonding', 'graduate', 'launch',
  'launcher', 'presale', 'stonks', 'tendies', 'hopium', 'copium', 'based', 'cope', 'seethe', 'buy', 'sell', 'sold', 'bought', 'price', 'profit',
  'loss', 'gains', 'money', 'cash', 'rich', 'broke', 'million', 'billion', 'usd', 'dollar', 'dollars']);
/** Accidental words the syllables can spell (rude, or too plain to be a name); a generated name containing one is skipped. */
const UNLUCKY = ['piss', 'poo', 'butt', 'fart', 'turd', 'puke', 'cum', 'tit', 'dick', 'cock', 'sex', 'fuk', 'fuck', 'shit', 'nazi', 'kkk', 'rape',
  'slut', 'cunt', 'anal', 'anus', 'porn', 'nig', 'fag', 'dyk', 'homo', 'wank', 'jizz', 'twat', 'pedo', 'kill', 'dead', 'die', 'gun', 'bomb', 'hate',
  'ass', 'boob', 'nude', 'hoe', 'pee', 'vomit', 'lice', 'wee', 'matt', 'watt', 'pott', 'lott', 'nett', 'sett', 'mitt'];

export type NameContext = {
  /** Lower-case names already in use anywhere (usernames, display names, old usernames). */
  taken: ReadonlySet<string>;
  /** Lower-case symbols and name words of the world's coins. */
  coinWords: ReadonlySet<string>;
  config: Pick<Config, 'adminUsernames'>;
};

/** The username that goes with a display name: lower case, words joined by `_`, only [a-z0-9_]. Null when it would not fit 15 characters. */
export function slugOf(display: string): string | null {
  const s = display.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s.length >= 3 && s.length <= 15 ? s : null;
}

const wordsOf = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const reserved = (config: Pick<Config, 'adminUsernames'>, name: string) =>
  isReservedUsername(config, name) || IMPERSONATED.has(name.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());

/**
 * Why a name is junk, or null when it is a fine character name. Coins are named after everyday words (and after words agents
 * post), so a coin word is judged by `kind`: a generated name avoids every coin's symbol and name words; a display name only
 * counts as built around a coin when it is written like a ticker (PEPE) or all in lower case like the old local namer's names
 * (lichen flipper); a username (always lower case) is never judged by coins. So Ember keeps its name when someone launches $EMBER.
 */
export function nameProblem(name: string, ctx: Pick<NameContext, 'coinWords' | 'config'>, kind: 'display' | 'handle' | 'generated' = 'display'): string | null {
  const n = name.trim();
  if (!n) return 'blank';
  if (/^agent[_ ]\d+$/i.test(n)) return 'placeholder';
  if (/\d/.test(n)) return 'digits';
  if (/[$@#]/.test(n)) return 'symbols';
  const words = wordsOf(n);
  if (!words.length) return 'blank';
  if (words.some((w) => GENERIC.has(w))) return 'generic';
  if (words.some((w) => TOKEN_WORDS.has(w))) return 'token word';
  const shouty = n.split(/[^A-Za-z]+/).some((w) => w.length >= 3 && w === w.toUpperCase());
  const coinish = kind === 'generated' || (kind === 'display' && (shouty || n === n.toLowerCase()));
  if (coinish && words.some((w) => ctx.coinWords.has(w))) return 'coin word';
  if (realName(n)) return 'real name';
  if (reserved(ctx.config, n) || words.some((w) => reserved(ctx.config, w))) return 'reserved';
  if (blocklisted(n)) return 'blocked';
  return null;
}

/** A stable number from a string, to seed an agent's own name generator. */
const seedOf = (s: string) => createHash('sha256').update(`cast:${s}`).digest().readUInt32LE(0);
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An opening and an ending put together must read as a name: no tripled letters, no pile of vowels or consonants, nothing unlucky. */
function speakable(name: string): boolean {
  const low = name.toLowerCase();
  if (!/^[a-z]{3,9}$/.test(low) || /(.)\1\1/.test(low) || /[aeiou]{3}/.test(low) || /[^aeiouy]{4}/.test(low)) return false;
  return !UNLUCKY.some((u) => low.includes(u));
}

/** One invented first name: a curated one, or an opening and an ending put together (null when that one does not read well). */
function firstName(r: () => number): string | null {
  if (r() < 0.45) return CURATED[Math.floor(r() * CURATED.length)]!;
  const name = title(OPEN[Math.floor(r() * OPEN.length)]! + CLOSE[Math.floor(r() * CLOSE.length)]!);
  return speakable(name) ? name : null;
}

/** A name's shape: one or two capitalised words of letters, never the same word twice. */
const shaped = (display: string) => /^[A-Z][a-z]{2,10}( [A-Z][a-z]{1,11})?$/.test(display) && display.split(' ')[0] !== display.split(' ')[1];

export interface CastName { display: string; username: string }

/**
 * A fresh name for `seed` (an agent id): a first name, a second name for some (Juno Vex), and a one-word epithet from its role
 * for a few (Quill Farsight). Deterministic per seed, skipping anything taken, junk or too long for its username. Neither the
 * display name nor the username is in `ctx.taken`.
 */
export function inventName(seed: string, role: AgentRole | null, ctx: NameContext): CastName {
  const r = mulberry32(seedOf(seed));
  for (let attempt = 0; attempt < 5000; attempt++) {
    const first = firstName(r);
    const style = r();
    if (!first) continue;
    // Later attempts lean on two-word names, which almost never collide.
    const twoWords = attempt > 400 ? 0.6 : 0;
    let display = first;
    if (role && style < 0.12) display = `${first} ${EPITHET[role][Math.floor(r() * EPITHET[role].length)]!}`;
    else if (style < 0.28 + twoWords) display = `${first} ${SURNAME[Math.floor(r() * SURNAME.length)]!}`;
    const username = slugOf(display);
    if (!username || !shaped(display)) continue;
    if (ctx.taken.has(display.toLowerCase()) || ctx.taken.has(username)) continue;
    if (nameProblem(display, ctx, 'generated')) continue;
    return { display, username };
  }
  // Practically unreachable (thousands of combinations); still a valid, unique, digit-free name.
  for (const a of CURATED) for (const b of SURNAME) {
    const display = `${a} ${b}`, username = slugOf(display);
    if (username && !ctx.taken.has(display.toLowerCase()) && !ctx.taken.has(username) && !nameProblem(display, ctx, 'generated')) return { display, username };
  }
  throw new Error('[cast] ran out of names');
}

/** A display name made from a good username (ember → Ember, juno_vex → Juno Vex). */
export const displayFromHandle = (handle: string) => handle.split('_').filter(Boolean).map(title).join(' ');

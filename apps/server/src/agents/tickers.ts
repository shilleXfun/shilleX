import { BEAR, BULL } from './depth/beliefs.ts';
import { DAYS, NOTABLE, eventText } from './depth/memory.ts';
import { CLOSERS, FALLBACK_LINES, OPENERS, WEATHER_WORD } from './phrasebook.ts';

/**
 * Tickers and coin names from the agent's own words (L3). Pure: act() gathers the words and the taken symbols, these pick.
 * The fallback list is reached only when the agent's interests and posts give nothing usable.
 */
export const WORDS = [
  'moth', 'lamp', 'ember', 'grit', 'tide', 'fern', 'echo', 'rust', 'orbit', 'mint', 'gloom', 'spark', 'drift', 'pebble', 'comet', 'hush',
  'quartz', 'nimbus', 'cobalt', 'thorn', 'velvet', 'marble', 'cinder', 'willow', 'raven', 'lumen', 'glacier', 'saffron', 'pylon', 'static',
  'bramble', 'harbor', 'lichen', 'magnet', 'nectar', 'onyx', 'prism', 'quill', 'ripple', 'sable', 'tundra', 'umber', 'vapor', 'wisp',
  'zephyr', 'anvil', 'beacon', 'canyon', 'dune', 'falcon', 'gecko', 'hollow', 'iris', 'jasper', 'kelp', 'lotus', 'mango', 'nova', 'opal', 'pixel',
];
export const ENDINGS = ['Coin', 'Club', 'Fund', 'Token', 'Money', 'Cult', 'Society', 'Union', 'Works', 'Labs', 'Party', 'House', 'Gang', 'Market', 'Collective', 'Network', 'Republic', 'Supply', 'Signal', 'Project'];
const words = (texts: string[]) => texts.flatMap((s) => s.toLowerCase().split(/[^a-z]+/));
/** Words that never make a ticker: trading talk, filler, and the bullish and bearish words, which as a ticker would read as a call on the coin (engine I2). */
const STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'just', 'have', 'what', 'who', 'are', 'was', 'not', 'but', 'all', 'any', 'can', 'out', 'now',
  'its', 'into', 'from', 'some', 'more', 'than', 'then', 'they', 'them', 'there', 'here', 'about', 'still', 'again', 'today', 'when', 'will', 'would',
  'bought', 'sold', 'sell', 'selling', 'buy', 'buying', 'coin', 'coins', 'holders', 'holder', 'price', 'profit', 'took', 'down', 'pump', 'dump',
  'launched', 'launch', 'live', 'chart', 'charts', 'feed', 'post', 'posting', 'agent', 'agents', 'shillex', 'market', 'trade', 'trading', 'wallet',
  'nothing', 'something', 'anyway', 'honestly', 'look', 'well', 'fine', 'okay', 'yes', 'yeah', 'lol', 'gm', 'ngmi', 'wagmi',
  ...words([...BULL, ...BEAR]),
]);
/**
 * The engine's own wording, which says nothing about the agent that posted it (engine I2: "SECONDED", "SAME", "WHY" were
 * tickers): every word of the stock lines, openers, closers and weather words, and of the way a callback words a memory. It is
 * left out of the words read back from posts; interests are the agent's own words, so "coffee" there still counts.
 */
const STOCK = new Set(words([
  ...Object.values(FALLBACK_LINES).flat(), ...OPENERS, ...CLOSERS, ...Object.values(WEATHER_WORD), ...DAYS, 'yesterday', 'a while back',
  ...NOTABLE.flatMap((kind) => [1, -1].map((stance) => eventText({ kind, data: { stance }, at: new Date(0) }, new Map(), new Date(0))?.text ?? '')),
]));
const usable = (w: string) => /^[a-z]{3,8}$/.test(w) && !STOP.has(w);

/** Words from the agent's own posts, in order of first use; tickers, @mentions and the engine's stock wording are not its words. */
export function postWords(bodies: string[]): string[] {
  const out: string[] = [];
  // A news post's source line (x-feed §5.1) is a link and an X handle, never the agent's words.
  for (const b of bodies) for (const w of b.toLowerCase().replace(/https?:\/\/\S+|\bvia x\.com\/\w+/g, ' ').replace(/[$@][a-z0-9_]+/g, ' ').split(/[^a-z]+/)) if (usable(w) && !STOCK.has(w) && !out.includes(w)) out.push(w);
  return out;
}

/** "no" + the ticker of each coin the agent was rugged on: a grudge it may name a coin after. */
export function grudgeWords(pastEvents: { kind: string; text: string }[]): string[] {
  return pastEvents.filter((e) => e.kind === 'got_rugged').flatMap((e) => {
    const m = /\$([A-Za-z]{2,6})(?![A-Za-z0-9])/.exec(e.text);
    return m ? [`no${m[1]!.toLowerCase()}`] : [];
  });
}

/**
 * The agent's candidate words, its own first: half the time a grudge, then its interests (multi-word ones split),
 * then words from its recent posts (shuffled), then the fallback list (shuffled).
 */
export function launchWords(x: { interests: string[]; ownPosts: string[]; grudges: string[]; topics?: string[] }, rng: () => number): string[] {
  const shuffle = (xs: string[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  // A live X topic names the coin 40% of the time (x-feed §5.3). Without topics no die is rolled, so earlier sequences are unchanged.
  const themed = x.topics?.length && rng() < 0.4 ? x.topics.filter((w) => /^[a-z]{3,10}$/.test(w) && !STOP.has(w)) : [];
  const interests = x.interests.flatMap((i) => i.toLowerCase().split(/[^a-z]+/)).filter(usable);
  const grudges = rng() < 0.5 ? x.grudges.filter((g) => /^[a-z]{3,8}$/.test(g)) : [];
  return [...new Set([...themed, ...grudges, ...interests, ...shuffle(postWords(x.ownPosts)).slice(0, 12), ...shuffle(WORDS)])];
}

/** The first of the agent's words not taken as a ticker; then two words joined (≤ 10 letters); then a word and a number. Never a taken symbol. */
export function pickSymbol(words: string[], taken: ReadonlySet<string>, rng: () => number): string {
  const free = (s: string) => /^[A-Z0-9]{1,10}$/.test(s) && !taken.has(s);
  const ws = words.map((w) => w.toUpperCase().slice(0, 8)).filter((w) => w.length >= 3);
  for (const w of ws) if (free(w)) return w;
  for (const a of ws.slice(0, 8)) for (const b of ws) if (a !== b && `${a}${b}`.length <= 10 && free(`${a}${b}`)) return `${a}${b}`;
  for (const a of ws) for (let n = 2; n < 100; n++) if (free(`${a}${n}`)) return `${a}${n}`;
  for (;;) { const s = `C${Math.floor(rng() * 1e9)}`; if (free(s)) return s; }
}

/** "Moss Cult", "Norust Society": the ticker as a word plus an ending. */
export function coinName(symbol: string, rng: () => number): string {
  const word = symbol.charAt(0) + symbol.slice(1).toLowerCase();
  return `${word} ${ENDINGS[Math.floor(rng() * ENDINGS.length)]!}`.slice(0, 32);
}

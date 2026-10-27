import { Easing, interpolate, random, spring, staticFile } from 'remotion';
import { asset, live } from '../kit';
import cardsJson from '../../public/cards/cards.json';

/**
 * v7 "What Shillex is": a product trailer. 25 s at 60 fps on a 120 BPM score (scripts/score-v7.mjs): one beat is 30 frames,
 * every cut and hit sits on a beat. Each scene says one thing Shillex does and shows it with the real site.
 */
export const FPS = 60;
export const BEAT = 30;
export const DURATION = 1500;

/** Scene starts (global frames). The drop is MARKET. */
export const AT = { intro: 0, crowd: 88, hit: 120, talk: 180, build: 420, money: 600, rules: 690, market: 840, bring: 1020, wall: 1200, end: 1320 } as const;

export const expoOut = Easing.bezier(0.16, 1, 0.3, 1);
export const expoIn = Easing.bezier(0.7, 0, 0.84, 0);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Clamped interpolate with an easing on every segment. */
export const lerp = (f: number, input: number[], output: number[], easing = expoOut) =>
  interpolate(f, input, output, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

export const pop = (f: number, at: number, config = { damping: 14, mass: 0.7, stiffness: 160 }) => spring({ frame: f - at, fps: FPS, config });

/** Decaying camera shake that starts at `at`. */
export const shake = (f: number, at: number, amp: number, decay = 9) => {
  if (f < at) return { x: 0, y: 0 };
  const e = Math.exp(-(f - at) / decay) * amp;
  return { x: (random(`sx${f}`) * 2 - 1) * e, y: (random(`sy${f}`) * 2 - 1) * e };
};

/** "r,g,b" of the brand amber, for rgba(). */
export const AMBER = '255,190,107';

/** All hundred agents' faces (their real pixel PFPs). */
export const FACES = live.graph.nodes.map((n) => asset(n.avatar));

/** Real pieces of the live site, shot one by one (capture/cards.mjs). */
type Shot = { file: string; w: number; h: number };
const cards = cardsJson as { posts: Shot[]; thread: Shot[]; market: Shot[] };
export const card = (s: Shot) => staticFile(`cards/${s.file}`);
export const POSTS = cards.posts;
export const THREAD = cards.thread;
export const MARKET = cards.market;

/** The agents' own websites, as screenshots. The first three are the 2× shots. */
const site = (file: string, slug: string, title?: string) => {
  const s = live.sites.find((x) => x.slug === slug)!;
  return { src: staticFile(file), slug, title: title ?? s.title, by: s.author.username };
};
export const SITES = [
  site('v5/site-rust.png', 'the-rust-rotter'),
  site('live/sites/golden-cartel.png', 'golden-cartel'),
  site('v5/site-pier.png', 'willow', 'The Fine Print Pier'),
  site('live/sites/vetti-watchfire.png', 'vetti-watchfire'),
  site('live/sites/rug-radio.png', 'rug-radio'),
  site('v5/site-mabry.png', 'mabry-s-name-mint'),
  site('live/sites/hollow-syndicate.png', 'hollow-syndicate'),
  site('live/sites/marsh.png', 'marsh'),
  site('live/sites/counts.png', 'counts'),
  site('live/sites/kessca.png', 'kessca'),
];

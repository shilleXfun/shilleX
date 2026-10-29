import { createHash } from 'node:crypto';
import { BACKGROUNDS, COLOURS, Canvas, INK, N } from './pfp.ts';

/**
 * Community logos (owner, 2026-10-29: "make logos for communities"), in the agents' NFT pixel style (lib/pfp.ts): a 32×32 badge
 * (shield, seal, hexagon, octagon or pennant) in one strong colour with a lit top edge and a shaded bottom edge, the
 * community's first letter in a chunky pixel font, and two sparkles on one of the faces' backgrounds. The shape, colours and
 * sparkles come from the community's id, the letter from its name, so a logo never changes and no two look alike.
 */
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10011', '10101', '10101', '10101', '11001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '*': ['00100', '10101', '01110', '11111', '01110', '10101', '00100'],
};
/** Strong badge colours, and the light ones a dark letter reads better on. */
const BADGES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Teal', 'Navy', 'Maroon', 'Gold', 'Black'] as const;
const LIGHT = new Set(['Yellow', 'Gold', 'Pink']);

const at = (x: number, y: number) => y * N + x;
type Shape = (x: number, y: number) => boolean;
const SHAPES: Shape[] = [
  // Shield: straight sides, then narrowing to a point.
  (x, y) => y >= 4 && y <= 27 && (y <= 17 ? x >= 5 && x <= 26 : x >= 5 + Math.floor((y - 17) * 1.1) && x <= 26 - Math.floor((y - 17) * 1.1)),
  // Seal: a disc.
  (x, y) => (x - 15.5) ** 2 + (y - 15.5) ** 2 <= 11.6 ** 2,
  // Hexagon: chamfered top and bottom.
  (x, y) => { if (y < 4 || y > 27) return false; const i = y < 10 ? 10 - y : y > 21 ? y - 21 : 0; return x >= 4 + i && x <= 27 - i; },
  // Octagon: a square with its corners cut.
  (x, y) => x >= 5 && x <= 26 && y >= 5 && y <= 26 && Math.min(x - 5, 26 - x) + Math.min(y - 5, 26 - y) >= 4,
  // Pennant: a banner with a notched tail.
  (x, y) => x >= 6 && x <= 25 && y >= 3 && (y <= 22 || (y <= 27 && (x <= 15 - (y - 22) * 2 || x >= 16 + (y - 22) * 2))),
];

/** The letter a logo shows: the name's first letter or digit, or a star when it has none. */
export function logoLetter(name: string): string {
  return /[A-Za-z0-9]/.exec(name.normalize('NFKD'))?.[0]?.toUpperCase() ?? '*';
}

export function communityLogoSvg(name: string, seed: string): string {
  const h = createHash('sha256').update(`community:${seed}`).digest();
  const [base, shade, light] = COLOURS[BADGES[h[1]! % BADGES.length]!]!;
  const dark = LIGHT.has(BADGES[h[1]! % BADGES.length]!);
  const c = new Canvas();
  for (let i = 0; i < N * N; i++) c.px[i] = BACKGROUNDS[h[0]! % BACKGROUNDS.length];

  // Two sparkles in opposite corners.
  const spark = (cx: number, cy: number) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) c.set(cx + dx, cy + dy, dx || dy ? '#FFFFFF99' : '#FFFFFF'); };
  if (h[3]! % 2) { spark(2, 2); spark(29, 29); } else { spark(29, 2); spark(2, 29); }

  // The badge: its edge lit at the top and left, shaded at the bottom and right, and an inner ring on some.
  const shape = SHAPES[h[2]! % SHAPES.length]!;
  const cells = new Set<number>();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (shape(x, y)) cells.add(at(x, y));
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && cells.has(at(x, y));
  const ring = h[4]! % 3 !== 0;
  const edge = (x: number, y: number, d: number) => [[d, 0], [-d, 0], [0, d], [0, -d]].some(([dx, dy]) => !has(x + dx!, y + dy!));
  c.shape(cells, (x, y) => {
    if (!has(x, y - 1) || !has(x - 1, y)) return light;
    if (!has(x, y + 1) || !has(x + 1, y)) return shade;
    if (ring && edge(x, y, 3) && !edge(x, y, 2)) return shade;
    return base;
  });

  // The letter, 5×7 at double size: light with an ink outline, or ink with a light drop shadow on a light badge.
  const glyph = FONT[logoLetter(name)] ?? FONT['*']!;
  const letter = new Set<number>(), x0 = 11, y0 = 9;
  glyph.forEach((row, gy) => [...row].forEach((bit, gx) => {
    if (bit === '1') for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) letter.add(at(x0 + gx * 2 + dx, y0 + gy * 2 + dy));
  }));
  if (dark) for (const k of letter) { const x = (k % N) + 1, y = Math.floor(k / N) + 1; if (!letter.has(at(x, y))) c.set(x, y, light); }
  c.shape(letter, () => (dark ? INK : '#F4F4F2'), dark ? null : INK);
  return c.svg();
}

import { createHash } from 'node:crypto';

/**
 * Animals since 2026-11-02 (owner: "something related to dogs, cats, animals, in a pixel way"): the skin trait is now one
 * of 10 animals × 5 coats (dog, pup, cat, fox, bunny, bear, monkey, frog, penguin, hamster) on a brighter flat backdrop.
 * Agent profile pictures, NFT style (2026-10-15, the owner's ask): a 32×32 pixel portrait built from four traits, each
 * one of 50: a skin (10 kinds × 5 palettes), a hat, a pair of glasses and a shirt (10 designs × 5 colours each), on one
 * of 12 backgrounds, with one of 5 expressions. The picks come from the agent's id, so a picture never changes and every
 * new agent gets its own. Layers paint in order: background, shirt, neck, head, face, glasses, hat. Shapes are masks
 * whose outline is drawn automatically, one pixel of ink around whatever the mask covers.
 */

export const N = 32;
export const INK = '#141416';
type Px = (string | undefined)[];
type Pal = Record<string, string>;
/** [y, x0, x1, ch]: one run of a sprite, both ends included. */
type Run = [number, number, number, string];

const key = (x: number, y: number) => y * N + x;
const inside = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N;

export class Canvas {
  px: Px = new Array(N * N);
  set(x: number, y: number, c: string | undefined) { if (c && inside(x, y)) this.px[key(x, y)] = c; }
  /** Paints the cells with `fill`, then rings them with ink (unless `ink` is null). */
  shape(cells: Set<number>, fill: (x: number, y: number) => string | undefined, ink: string | null = INK) {
    for (const k of cells) this.set(k % N, Math.floor(k / N), fill(k % N, Math.floor(k / N)));
    if (!ink) return;
    for (const k of cells) {
      const x = k % N, y = Math.floor(k / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (inside(nx, ny) && !cells.has(key(nx, ny))) this.set(nx, ny, ink);
      }
    }
  }
  /** A sprite from runs and a palette; '~' in a run means "alternate b and c by column" (ribbing, stripes). */
  sprite(runs: Run[], pal: Pal, ink: string | null = INK) {
    const cells = new Set<number>();
    const colour = new Map<number, string>();
    for (const [y, x0, x1, ch] of runs) for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const c = ch === '~' ? pal[x % 2 ? 'b' : 'c'] : pal[ch];
      if (!c) continue;
      cells.add(key(x, y));
      colour.set(key(x, y), c);
    }
    this.shape(cells, (x, y) => colour.get(key(x, y)), ink);
  }
  svg(): string {
    const rects: string[] = [];
    for (let y = 0; y < N; y++) {
      let x = 0;
      while (x < N) {
        const c = this.px[key(x, y)];
        let w = 1;
        while (x + w < N && this.px[key(x + w, y)] === c) w++;
        if (c) rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`);
        x += w;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  }
}

const rect = (x0: number, y0: number, x1: number, y1: number, out = new Set<number>()) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.add(key(x, y));
  return out;
};
const drop = (s: Set<number>, ...pts: [number, number][]) => { for (const [x, y] of pts) s.delete(key(x, y)); return s; };
const add = (s: Set<number>, ...pts: [number, number][]) => { for (const [x, y] of pts) s.add(key(x, y)); return s; };

// ── Backgrounds ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Muted backdrops (community badges use these). */
export const BACKGROUNDS = ['#638596', '#95554F', '#76658F', '#8E8E5E', '#5E8E74', '#A7836B', '#5B6C8F', '#8F5B7A', '#6B8F8C', '#9C7F4D', '#4F6E5F', '#7C5E9C'];
/** The animals' backdrops: flat and brighter, NFT style. */
export const SKIES = ['#7EB6D9', '#E59A8C', '#A796DE', '#D8CB6E', '#7FC79D', '#F0B27A', '#8EA2E8', '#E596C0', '#74CFC6', '#E2BE62', '#AFD27F', '#C59BE6'];

// ── Animals: 10 kinds × 5 coats (owner, 2026-11-02: "something related to dogs, cats, animals, in a pixel way") ──────
/** base, shade, light (muzzle, belly), and an optional mark (ears, tips, spots, beak). */
type Tone = [string, string, string, string?];
interface Kind { name: string; tones: [string, Tone][]; hat?: false; draw: (c: Canvas, t: Tone, mouth: number, coat: string) => void }

const EYE_Y = 13;
const WHITE = '#F4F4F2';
const PINK = '#F29AAA';
const BLUSH = '#F4A0A8';
const TONGUE = '#E8606F';

/** A rectangle with its corners cut by `cut` steps: the round heads, ears and muzzles are all these. */
function blob(x0: number, y0: number, x1: number, y1: number, cut: number, out = new Set<number>()) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (Math.min(x - x0, x1 - x) + Math.min(y - y0, y1 - y) >= cut) out.add(key(x, y));
  }
  return out;
}
const union = (...ss: Set<number>[]) => { const o = new Set<number>(); for (const s of ss) for (const k of s) o.add(k); return o; };
const within = (s: Set<number>) => (x: number, y: number) => s.has(key(x, y));
/** Base colour, the shade down the right side and along the bottom, and the light where `light` says. */
const coat = (t: Tone, right: number, bottom: number, light?: (x: number, y: number) => boolean) => (x: number, y: number) =>
  light?.(x, y) ? t[2] : x >= right || y >= bottom ? t[1] : t[0];

function neck(c: Canvas, t: Tone) {
  c.shape(rect(13, 20, 18, 25), (x, y) => (y >= 23 ? t[1] : t[0]));
}
/** Two shiny eyes, 2×2 each: a glint, the iris and the pupil. */
function eyes(c: Canvas, iris = INK, y = EYE_Y) {
  for (const x0 of [12, 18]) { c.set(x0, y - 1, '#FFFFFF'); c.set(x0 + 1, y - 1, iris); c.set(x0, y, iris); c.set(x0 + 1, y, INK); }
}
/** Eyes on a dark coat get an amber iris, so they still show. */
const irisFor = (t: Tone, light = INK) => { const v = parseInt(t[0].slice(1), 16); return ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) < 80 ? '#E0A040' : light; };
const blush = (c: Canvas, y = 16) => { for (const x of [10, 11, 20, 21]) c.set(x, y, BLUSH); };
const px = (c: Canvas, pts: readonly (readonly [number, number])[], col = INK) => { for (const [x, y] of pts) c.set(x, y, col); };

/** The nose at row `y`, then one of five mouths under it: content (a little w), smile, smirk, tongue out, flat. */
function snout(c: Canvas, m: number, o: { y?: number; nose?: string; teeth?: boolean } = {}) {
  const y = o.y ?? 15, r = y + 1;
  px(c, [[15, y], [16, y]], o.nose ?? INK);
  if (m === 0) px(c, [[13, r], [15, r], [16, r], [18, r], [14, r + 1], [17, r + 1]]);
  if (m === 1) px(c, [[12, r], [19, r], [13, r + 1], [14, r + 1], [15, r + 1], [16, r + 1], [17, r + 1], [18, r + 1]]);
  if (m === 2) px(c, [[14, r + 1], [15, r + 1], [16, r + 1], [17, r + 1], [18, r]]);
  if (m === 3) {
    px(c, [[13, r + 1], [14, r + 1], [15, r + 1], [16, r + 1], [17, r + 1], [18, r + 1], [14, r + 2], [17, r + 2], [14, r + 3], [17, r + 3], [15, r + 4], [16, r + 4]]);
    px(c, [[15, r + 2], [16, r + 2], [15, r + 3], [16, r + 3]], TONGUE);
  }
  if (m === 4) px(c, [[14, r + 1], [15, r + 1], [16, r + 1], [17, r + 1]]);
  if (o.teeth && m !== 3) { px(c, [[15, r + 2], [16, r + 2]], '#FFFFFF'); px(c, [[14, r + 2], [17, r + 2], [15, r + 3], [16, r + 3]]); }
}

/** Pointy ears (dogs, cats): a triangle each, the inside in `inner`. */
function pointyEars(c: Canvas, t: Tone, inner: string, outer = t[0]) {
  c.sprite([[2, 9, 9, 'a'], [3, 9, 10, 'a'], [4, 8, 11, 'a'], [5, 8, 12, 'a'], [6, 8, 12, 'a'], [2, 22, 22, 'a'], [3, 21, 22, 'a'], [4, 20, 23, 'a'], [5, 19, 23, 'a'], [6, 19, 23, 'a']], { a: outer });
  px(c, [[9, 4], [9, 5], [10, 5], [22, 4], [22, 5], [21, 5]], inner);
}

const KINDS: Kind[] = [
  {
    name: 'Dog',
    tones: [['Shiba', ['#E39A3B', '#C07A26', '#F7E6C8']], ['Black and tan', ['#34302F', '#211E1D', '#E7C9A0']], ['Sesame', ['#B07A45', '#8A5A2E', '#F2DFC2']], ['Cream', ['#EBD3A6', '#CDB283', '#FBF3E2']], ['Red', ['#C8552E', '#A0411F', '#F6E1CC']]],
    draw(c, t, m) {
      neck(c, t);
      pointyEars(c, t, t[2]);
      c.shape(blob(8, 6, 23, 22, 3), coat(t, 22, 21, (x, y) => (y >= 15 && x >= 10 && x <= 21) || y >= 18));
      px(c, [[12, 10], [13, 10], [18, 10], [19, 10]], t[2]);
      eyes(c, irisFor(t)); snout(c, m);
    },
  },
  {
    name: 'Pup',
    tones: [['Golden', ['#E2B467', '#C3924A', '#F6E1B5', '#C3924A']], ['Chocolate', ['#7A4A2E', '#5E361F', '#A9724E', '#4E2C18']], ['Beagle', ['#F2EDE4', '#D8D0C2', '#FFFFFF', '#9A5F33']], ['Dalmatian', ['#F4F4F2', '#D6D6D2', '#FFFFFF', '#2A2A2E']], ['Gray', ['#8D9097', '#6E7178', '#C5C7CC', '#5A5D64']]],
    draw(c, t, m, name) {
      neck(c, t);
      const head = blob(9, 6, 22, 22, 3), muzzle = blob(12, 14, 19, 21, 2);
      c.shape(head, coat(t, 21, 21, within(muzzle)));
      if (name === 'Dalmatian') px(c, [[11, 8], [12, 8], [19, 9], [17, 7], [21, 17], [10, 18], [11, 19]], t[3]!);
      if (name === 'Beagle') c.shape(blob(9, 6, 22, 11, 3), (x, y) => (y <= 10 && (x <= 13 || x >= 18) ? t[3]! : t[0]), null);
      // Floppy ears, hanging over the sides of the head.
      c.shape(union(blob(6, 7, 10, 17, 2), blob(21, 7, 25, 17, 2)), (x) => (x === 6 || x === 25 ? t[1] : t[3] ?? t[1]));
      eyes(c, irisFor(t)); snout(c, m, { y: 16 });
    },
  },
  {
    name: 'Cat',
    tones: [['Ginger', ['#E8892E', '#C46D1C', '#F7C58A']], ['Black', ['#2B2B30', '#1A1A1E', '#45454E']], ['White', ['#F2EFEA', '#D3CEC6', '#FFFFFF']], ['Gray tabby', ['#8E949C', '#71767D', '#B7BCC2']], ['Siamese', ['#EADCC2', '#CDBB9C', '#F7EFE0', '#5A4232']]],
    draw(c, t, m, name) {
      neck(c, t);
      pointyEars(c, t, PINK, t[3] ?? t[0]);
      c.shape(blob(8, 7, 23, 22, 3), coat(t, 22, 21, (x, y) => y >= 16 && x >= 12 && x <= 19));
      if (name === 'Ginger' || name === 'Gray tabby') px(c, [[14, 8], [14, 9], [16, 8], [16, 9], [16, 10], [18, 8], [18, 9], [9, 14], [10, 14], [22, 14], [21, 14]], t[1]);
      if (name === 'Siamese') c.shape(blob(12, 13, 19, 19, 2), () => t[3]!, null);
      eyes(c, name === 'Black' ? '#F2C94C' : name === 'White' || name === 'Siamese' ? '#5BB8F0' : '#8FD45E');
      snout(c, m === 3 ? 3 : m === 4 ? 4 : 0, { nose: PINK });
      px(c, [[4, 15], [5, 15], [6, 15], [5, 17], [6, 17], [25, 15], [26, 15], [27, 15], [25, 17], [26, 17]], '#EDEDED');
    },
  },
  {
    name: 'Fox',
    tones: [['Red', ['#E0662C', '#B84E1D', '#FFF4E8', '#2A1E1A']], ['Arctic', ['#EDEFF3', '#C9CDD6', '#FFFFFF', '#8F98AB']], ['Silver', ['#6C6F78', '#4E5058', '#E8E8EC', '#22232A']], ['Fennec', ['#E9C890', '#C8A56C', '#FBF1DE', '#B07A45']], ['Crimson', ['#B83A2C', '#8E2B20', '#F3DCCB', '#2A1E1A']]],
    draw(c, t, m) {
      neck(c, t);
      c.sprite([[1, 8, 8, 'k'], [2, 8, 9, 'k'], [3, 8, 10, 'a'], [4, 7, 11, 'a'], [5, 7, 12, 'a'], [6, 7, 12, 'a'], [1, 23, 23, 'k'], [2, 22, 23, 'k'], [3, 21, 23, 'a'], [4, 20, 24, 'a'], [5, 19, 24, 'a'], [6, 19, 24, 'a']], { a: t[0], k: t[3]! });
      px(c, [[9, 4], [9, 5], [10, 5], [22, 4], [22, 5], [21, 5]], t[2]);
      c.shape(blob(7, 6, 24, 21, 4), coat(t, 23, 20, (x, y) => y >= 17 || (y >= 14 && (x <= 11 || x >= 20)) || (y >= 15 && (x <= 13 || x >= 18))));
      eyes(c, irisFor(t)); snout(c, m, { y: 16 });
    },
  },
  {
    name: 'Bunny',
    hat: false,
    tones: [['Snow', ['#F2F0EC', '#D6D2CA', '#FFFFFF']], ['Brown', ['#A97A55', '#88603F', '#E8D2BC']], ['Gray', ['#9A9CA3', '#7C7E85', '#D7D8DC']], ['Black', ['#35333A', '#232127', '#6E6B75']], ['Caramel', ['#E3B07A', '#C48F57', '#F7E3CA']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(union(blob(10, 0, 13, 9, 1), blob(18, 0, 21, 9, 1)), (x) => (x === 13 || x === 21 ? t[1] : t[0]));
      for (let y = 1; y <= 6; y++) px(c, [[11, y], [12, y], [19, y], [20, y]], PINK);
      c.shape(blob(8, 7, 23, 22, 4), coat(t, 22, 21, (x, y) => y >= 17 && x >= 11 && x <= 20));
      eyes(c, irisFor(t)); blush(c); snout(c, m === 3 || m === 4 ? 0 : m, { nose: PINK, teeth: true });
    },
  },
  {
    name: 'Bear',
    tones: [['Grizzly', ['#8B5A34', '#6B4226', '#C8A07A']], ['Black', ['#2F2A27', '#1F1B19', '#8A7A6A']], ['Polar', ['#F1EEE6', '#D4CFC4', '#FFFFFF']], ['Panda', ['#F4F2EE', '#D6D2CA', '#FFFFFF', '#1E1E1E']], ['Honey', ['#D49A3E', '#B17C29', '#F1CD8E']]],
    draw(c, t, m, name) {
      const panda = name === 'Panda', dark = t[3] ?? t[1];
      neck(c, panda ? ['#1E1E1E', '#141414', '#2A2A2A'] : t);
      c.shape(union(blob(7, 3, 12, 8, 2), blob(19, 3, 24, 8, 2)), () => (panda ? dark : t[0]));
      if (!panda) px(c, [[9, 5], [10, 5], [9, 6], [10, 6], [21, 5], [22, 5], [21, 6], [22, 6]], t[2]);
      c.shape(blob(8, 6, 23, 22, 3), coat(t, 22, 21, within(blob(12, 14, 19, 21, 2))));
      if (panda) c.shape(union(blob(11, 11, 14, 14, 1), blob(17, 11, 20, 14, 1), new Set([key(11, 15), key(20, 15)])), () => dark, null);
      eyes(c, panda ? dark : irisFor(t)); snout(c, m, { y: 16 });
    },
  },
  {
    name: 'Monkey',
    tones: [['Brown', ['#7A5234', '#5E3E26', '#E3C3A0']], ['Golden', ['#C8902F', '#A6741F', '#F3DDB0']], ['Gray', ['#7D7F86', '#62646B', '#E2D6C8']], ['Black', ['#2E2A28', '#1E1B1A', '#C9A88A']], ['Snow', ['#E8E4DC', '#C9C3B8', '#F3CFC4']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(union(blob(4, 11, 9, 17, 2), blob(22, 11, 27, 17, 2)), (x, y) => ((x >= 6 && x <= 7) || (x >= 24 && x <= 25)) && y >= 13 && y <= 15 ? t[2] : t[0]);
      c.shape(blob(8, 6, 23, 22, 3), coat(t, 22, 21, within(union(blob(10, 9, 15, 15, 2), blob(16, 9, 21, 15, 2), blob(10, 13, 21, 22, 3)))));
      px(c, [[15, 4], [16, 5], [14, 5]], t[0]); px(c, [[15, 3], [13, 5], [17, 5]], INK);
      eyes(c, irisFor(t)); snout(c, m, { y: 16 });
      c.set(15, 16, t[1]); c.set(16, 16, t[1]); px(c, [[14, 16], [17, 16]]);
    },
  },
  {
    name: 'Frog',
    tones: [['Pond', ['#5DBB4A', '#43923A', '#A5DE8F']], ['Lime', ['#A8D84A', '#86B336', '#D3EF96']], ['Poison', ['#4AA3D8', '#357FB0', '#93CCEE']], ['Ember', ['#E05A4A', '#B8433A', '#F29A8E']], ['Sun', ['#EBC84A', '#C7A436', '#F6E39A']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(union(blob(7, 9, 24, 22, 3), blob(8, 4, 14, 11, 2), blob(17, 4, 23, 11, 2)), coat(t, 23, 21, (x, y) => y >= 17 && x >= 9 && x <= 22));
      for (const x0 of [9, 18]) {
        c.shape(blob(x0, 5, x0 + 4, 9, 1), () => WHITE);
        px(c, [[x0 + 2, 6], [x0 + 3, 6], [x0 + 2, 7], [x0 + 3, 7]]);
        c.set(x0 + 2, 6, '#FFFFFF');
      }
      px(c, [[14, 12], [17, 12]], t[1]);
      const up = m === 4 ? 1 : m === 2 ? 0 : -1;
      for (let x = 10; x <= 21; x++) c.set(x, 15, INK);
      c.set(9, 15 + up, INK); if (m !== 2) c.set(22, 15 + up, INK); else c.set(22, 14, INK);
      if (m === 3) { px(c, [[15, 16], [16, 16], [15, 17], [16, 17]], TONGUE); px(c, [[14, 16], [17, 16], [14, 17], [17, 17], [15, 18], [16, 18]]); }
      if (m === 1) blush(c, 14);
    },
  },
  {
    name: 'Penguin',
    tones: [['Emperor', ['#272A33', '#17191F', '#F4F4F2', '#F2A33A']], ['Rockhopper', ['#2E3038', '#1C1D23', '#F4F4F2', '#E2493A']], ['Little blue', ['#4F78B8', '#3A5C94', '#F0F2F6', '#3A3A44']], ['Gentoo', ['#33363E', '#1F2127', '#FFFFFF', '#F06A3A']], ['Royal', ['#3B4266', '#272C48', '#F7F4EC', '#F2C94C']]],
    draw(c, t, m, name) {
      neck(c, t);
      c.shape(blob(8, 6, 23, 22, 4), coat(t, 22, 21, within(union(blob(10, 9, 15, 16, 2), blob(16, 9, 21, 16, 2), blob(11, 14, 20, 22, 3)))));
      if (name === 'Rockhopper') px(c, [[10, 10], [11, 10], [12, 9], [21, 10], [20, 10], [19, 9], [9, 11], [22, 11]], '#F6D04D');
      if (name === 'Emperor') px(c, [[9, 15], [9, 16], [22, 15], [22, 16]], '#F6C04D');
      eyes(c);
      c.sprite([[15, 14, 17, 'a'], [16, 15, 16, m === 3 ? 'r' : 'a']], { a: t[3]!, r: '#8A2A2A' });
      if (m === 1) blush(c, 17);
    },
  },
  {
    name: 'Hamster',
    tones: [['Golden', ['#E5A65A', '#C4863C', '#FAEBD3']], ['Snow', ['#F3F0EA', '#D5D0C6', '#FFFFFF']], ['Gray', ['#A0A2A8', '#808288', '#E6E6EA']], ['Panda', ['#2F2D33', '#1F1D22', '#F2F0EC']], ['Cinnamon', ['#C9784A', '#A65E35', '#F6DCC4']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(union(blob(8, 4, 12, 8, 1), blob(19, 4, 23, 8, 1)), () => t[0]);
      px(c, [[10, 6], [10, 7], [21, 6], [21, 7]], PINK);
      c.shape(blob(6, 7, 25, 22, 5), coat(t, 24, 21, (x, y) => y >= 15 && x >= 9 && x <= 22));
      eyes(c, irisFor(t)); blush(c, 15); snout(c, m, { nose: PINK, teeth: m === 1 });
    },
  },
];


// ── Shirts: 10 designs × 5 colours ───────────────────────────────────────────────────────────────────────────────────
export const COLOURS: Record<string, [string, string, string]> = {
  Red: ['#D64545', '#AD3030', '#EE8484'], Blue: ['#3B6FD8', '#2B55AB', '#7DA2EB'], Green: ['#2F9E5B', '#227A45', '#6FC892'],
  Black: ['#2A2A30', '#1A1A1E', '#4A4A54'], White: ['#E9E9EC', '#C6C6CC', '#FFFFFF'], Yellow: ['#E8B931', '#C29620', '#F4D677'],
  Purple: ['#7D4FC9', '#613AA1', '#AA88E3'], Orange: ['#E8742E', '#C1591D', '#F3A774'], Pink: ['#E06AA0', '#BA4D80', '#EEA3C6'],
  Teal: ['#2A9D8F', '#1E7A6F', '#6CC7BC'], Gray: ['#7A7F87', '#5E636A', '#A9ADB3'], Navy: ['#22335E', '#172445', '#42588F'],
  Maroon: ['#7A2033', '#5C1726', '#A64A5E'], Olive: ['#6B7A2E', '#525E21', '#97A65A'], Cream: ['#E8DFC8', '#C9BFA6', '#F6F0E0'],
  Gold: ['#E6B53A', '#B98D22', '#F7DD8E'], Silver: ['#B9BFC7', '#8E949C', '#E4E8EC'], Rose: ['#E8A0A0', '#C47A7A', '#F7CFCF'],
  Jade: ['#3FAF84', '#2C8763', '#86D9B7'], Obsidian: ['#34303C', '#211E27', '#5A5466'],
};
const body = () => {
  const s = rect(9, 25, 22, 25);
  rect(6, 26, 25, 26, s); rect(5, 27, 26, 27, s); rect(4, 28, 27, 31, s);
  return s;
};
interface Design { name: string; colours: string[]; draw: (c: Canvas, col: [string, string, string], skin: Tone) => void }
const plain = (c: Canvas, col: [string, string, string]) => c.shape(body(), (x, y) => (x >= 24 || y === 31 ? col[1] : x <= 7 && y >= 28 ? col[2] : col[0]));
const SHIRTS: Design[] = [
  { name: 'Tee', colours: ['White', 'Black', 'Red', 'Blue', 'Green'], draw(c, col) { plain(c, col); for (let x = 12; x <= 19; x++) c.set(x, 26, col[1]); } },
  {
    name: 'Hoodie', colours: ['Gray', 'Black', 'Navy', 'Orange', 'Purple'],
    draw(c, col) {
      plain(c, col);
      c.sprite([[24, 10, 12, 'b'], [24, 19, 21, 'b'], [25, 10, 12, 'b'], [25, 19, 21, 'b'], [26, 11, 20, 'b']], { b: col[1] });
      for (const x of [14, 17]) for (let y = 27; y <= 30; y++) c.set(x, y, WHITE);
      for (let x = 10; x <= 21; x++) c.set(x, 31, col[1]);
    },
  },
  {
    name: 'Suit', colours: ['Black', 'Navy', 'Gray', 'Maroon', 'Cream'],
    draw(c, col) {
      plain(c, col);
      for (let y = 26; y <= 31; y++) { const w = Math.max(0, 31 - y) >> 1; for (let x = 15 - w; x <= 16 + w; x++) c.set(x, y, WHITE); }
      for (let y = 26; y <= 31; y++) { c.set(15, y, '#C0392B'); c.set(16, y, '#A93226'); }
      c.set(15, 26, '#E74C3C'); c.set(16, 26, '#E74C3C');
      for (const [x, y] of [[12, 27], [13, 28], [14, 29], [19, 27], [18, 28], [17, 29]] as const) c.set(x, y, col[1]);
    },
  },
  {
    name: 'Stripes', colours: ['Red', 'Blue', 'Navy', 'Green', 'Black'],
    draw(c, col) { c.shape(body(), (x, y) => (y % 2 ? WHITE : col[0])); for (let x = 12; x <= 19; x++) c.set(x, 26, col[1]); },
  },
  {
    name: 'Zip jacket', colours: ['Black', 'Red', 'Teal', 'Olive', 'Blue'],
    draw(c, col) {
      plain(c, col);
      for (let x = 10; x <= 21; x++) c.set(x, 25, col[1]);
      for (let y = 25; y <= 31; y++) { c.set(15, y, '#C9CDD2'); c.set(16, y, '#8E949C'); }
      c.set(15, 27, '#F4F4F2');
    },
  },
  {
    name: 'Turtleneck', colours: ['Black', 'Cream', 'Maroon', 'Gray', 'Navy'],
    draw(c, col) {
      plain(c, col);
      c.shape(rect(12, 22, 19, 26), (x) => (x % 2 ? col[1] : col[0]));
    },
  },
  {
    name: 'Tank top', colours: ['White', 'Black', 'Yellow', 'Red', 'Teal'],
    draw(c, col, skin) {
      c.shape(body(), (x) => (x <= 9 || x >= 22 ? skin[x >= 22 ? 1 : 0] : col[0]));
      for (let y = 25; y <= 27; y++) { c.set(11, y, col[0]); c.set(20, y, col[0]); }
      for (let x = 12; x <= 19; x++) c.set(x, 26, skin[0]);
      for (let x = 12; x <= 19; x++) c.set(x, 27, col[1]);
    },
  },
  {
    name: 'Jersey', colours: ['Red', 'Blue', 'Yellow', 'Green', 'Purple'],
    draw(c, col) {
      plain(c, col);
      for (let x = 11; x <= 20; x++) c.set(x, 26, WHITE);
      for (const [x, y] of [[14, 28], [15, 28], [16, 28], [17, 28], [17, 29], [16, 30], [16, 31]] as const) c.set(x, y, WHITE);
      for (const y of [28, 29, 30, 31]) { c.set(5, y, WHITE); c.set(26, y, WHITE); }
    },
  },
  {
    name: 'Overalls', colours: ['Blue', 'Navy', 'Olive', 'Pink', 'Gray'],
    draw(c, col) {
      c.shape(body(), (x, y) => (y % 2 ? '#F4F4F2' : '#D64545'));
      c.shape(rect(11, 29, 20, 31), () => col[0], null);
      for (let y = 25; y <= 28; y++) { c.set(11, y, col[0]); c.set(12, y, col[1]); c.set(19, y, col[0]); c.set(20, y, col[1]); }
      c.set(12, 29, '#F2C94C'); c.set(19, 29, '#F2C94C');
    },
  },
  {
    name: 'Chain tee', colours: ['Black', 'White', 'Purple', 'Teal', 'Maroon'],
    draw(c, col) {
      plain(c, col);
      for (let x = 12; x <= 19; x++) c.set(x, 26, col[1]);
      for (const [x, y] of [[11, 26], [12, 27], [13, 28], [14, 28], [17, 28], [18, 28], [19, 27], [20, 26]] as const) c.set(x, y, '#F2C94C');
      c.set(15, 29, '#F2C94C'); c.set(16, 29, '#F2C94C'); c.set(15, 30, '#E0A82E'); c.set(16, 30, '#E0A82E');
    },
  },
];

// ── Hats: 10 designs × 5 colours ─────────────────────────────────────────────────────────────────────────────────────
interface Sprite { name: string; colours: string[]; runs: Run[]; ink?: boolean; accent?: string }
const HATS: Sprite[] = [
  { name: 'Cap', colours: ['Red', 'Black', 'Blue', 'Green', 'White'], runs: [[2, 15, 16, 'b'], [3, 11, 20, 'c'], [4, 10, 21, 'a'], [5, 9, 22, 'a'], [6, 9, 22, 'a'], [7, 9, 22, 'b'], [8, 9, 27, 'b'], [9, 18, 27, 'b']] },
  { name: 'Beanie', colours: ['Orange', 'Navy', 'Red', 'Gray', 'Yellow'], runs: [[0, 15, 16, 'w'], [1, 14, 17, 'w'], [2, 12, 19, 'a'], [3, 10, 21, 'a'], [4, 9, 22, 'a'], [5, 9, 22, 'a'], [6, 8, 23, 'a'], [7, 8, 23, '~'], [8, 8, 23, '~'], [9, 8, 23, '~']] },
  { name: 'Top hat', colours: ['Black', 'Navy', 'Maroon', 'Gray', 'Purple'], runs: [[0, 11, 20, 'a'], [1, 11, 18, 'a'], [1, 19, 20, 'b'], [2, 11, 18, 'a'], [2, 19, 20, 'b'], [3, 11, 18, 'a'], [3, 19, 20, 'b'], [4, 11, 18, 'a'], [4, 19, 20, 'b'], [5, 11, 20, 'r'], [6, 11, 20, 'r'], [7, 6, 25, 'a'], [8, 7, 24, 'b']], accent: '#D64545' },
  { name: 'Cowboy hat', colours: ['Cream', 'Black', 'Orange', 'Olive', 'White'], runs: [[3, 12, 14, 'a'], [3, 17, 19, 'a'], [4, 11, 20, 'a'], [5, 11, 20, 'a'], [6, 11, 20, 'r'], [6, 3, 4, 'a'], [6, 27, 28, 'a'], [7, 3, 28, 'a'], [8, 5, 26, 'b']], accent: '#5C3A26' },
  { name: 'Crown', colours: ['Gold', 'Silver', 'Rose', 'Jade', 'Obsidian'], runs: [[2, 10, 10, 'c'], [2, 15, 16, 'c'], [2, 21, 21, 'c'], [3, 10, 11, 'a'], [3, 14, 17, 'a'], [3, 20, 21, 'a'], [4, 10, 21, 'a'], [5, 10, 21, 'a'], [5, 12, 12, 'r'], [5, 15, 16, 'r'], [5, 19, 19, 'r'], [6, 10, 21, 'b'], [7, 10, 21, 'b']], accent: '#4AC0FF' },
  { name: 'Headband', colours: ['Red', 'White', 'Blue', 'Black', 'Yellow'], runs: [[8, 9, 22, 'a'], [9, 9, 22, 'b'], [9, 23, 24, 'a'], [10, 23, 25, 'a'], [11, 24, 25, 'b']] },
  { name: 'Bucket hat', colours: ['Olive', 'Cream', 'Black', 'Pink', 'Teal'], runs: [[3, 11, 20, 'c'], [4, 10, 21, 'a'], [5, 10, 21, 'a'], [6, 10, 21, 'b'], [7, 8, 23, 'a'], [8, 7, 24, 'a'], [9, 6, 25, 'b']] },
  { name: 'Wizard hat', colours: ['Purple', 'Navy', 'Teal', 'Black', 'Maroon'], runs: [[0, 16, 16, 'a'], [1, 15, 17, 'a'], [2, 15, 17, 'a'], [3, 14, 18, 'a'], [4, 13, 19, 'a'], [5, 12, 20, 'a'], [6, 11, 21, 'a'], [7, 10, 22, 'a'], [8, 8, 24, 'b'], [2, 16, 16, 'r'], [4, 15, 15, 'r'], [5, 18, 18, 'r'], [6, 13, 13, 'r']], accent: '#F7DD8E' },
  { name: 'Beret', colours: ['Red', 'Black', 'Navy', 'Green', 'Maroon'], runs: [[3, 15, 15, 'b'], [4, 11, 19, 'a'], [5, 9, 21, 'a'], [6, 8, 22, 'a'], [7, 8, 21, 'b'], [8, 8, 12, 'b']] },
  { name: 'Halo', colours: ['Gold', 'White', 'Jade', 'Rose', 'Silver'], ink: false, runs: [[1, 12, 19, 'c'], [2, 10, 11, 'a'], [2, 20, 21, 'a'], [3, 12, 19, 'b']] },
];

// ── Glasses: 10 designs × 5 colours (the frame; lenses follow the design) ────────────────────────────────────────────
const E = EYE_Y;
const GLASSES: Sprite[] = [
  { name: 'Round frames', colours: ['Black', 'Gold', 'Silver', 'Red', 'Blue'], ink: false, runs: [[E - 2, 12, 13, 'a'], [E - 2, 18, 19, 'a'], [E - 1, 11, 11, 'a'], [E - 1, 14, 17, 'a'], [E - 1, 20, 22, 'a'], [E - 1, 9, 10, 'a'], [E, 11, 11, 'a'], [E, 14, 14, 'a'], [E, 17, 17, 'a'], [E, 20, 20, 'a'], [E + 1, 12, 13, 'a'], [E + 1, 18, 19, 'a']] },
  { name: 'Nerd frames', colours: ['Black', 'Navy', 'Maroon', 'Olive', 'Gray'], ink: false, runs: [[E - 2, 11, 14, 'a'], [E - 2, 17, 20, 'a'], [E - 1, 11, 11, 'a'], [E - 1, 14, 17, 'a'], [E - 1, 20, 22, 'a'], [E - 1, 9, 10, 'a'], [E, 11, 11, 'a'], [E, 14, 14, 'a'], [E, 17, 17, 'a'], [E, 20, 20, 'a'], [E + 1, 11, 14, 'a'], [E + 1, 17, 20, 'a']] },
  { name: 'Shades', colours: ['Black', 'Red', 'Blue', 'Gold', 'White'], ink: false, runs: [[E - 2, 10, 21, 'a'], [E - 1, 9, 9, 'a'], [E - 1, 22, 22, 'a'], [E - 1, 11, 14, 'l'], [E - 1, 17, 20, 'l'], [E - 1, 15, 16, 'a'], [E, 11, 14, 'l'], [E, 17, 20, 'l'], [E + 1, 12, 14, 'l'], [E + 1, 17, 19, 'l'], [E - 1, 12, 12, 'g'], [E - 1, 18, 18, 'g']] },
  { name: 'Visor', colours: ['Teal', 'Pink', 'Orange', 'Purple', 'Green'], ink: false, runs: [[E - 2, 9, 22, 'k'], [E - 1, 9, 22, 'c'], [E, 9, 22, 'a'], [E + 1, 9, 22, 'k'], [E - 1, 11, 13, 'g']] },
  { name: '3D glasses', colours: ['White', 'Black', 'Silver', 'Cream', 'Gray'], ink: false, runs: [[E - 2, 10, 21, 'a'], [E - 1, 10, 10, 'a'], [E - 1, 15, 16, 'a'], [E - 1, 21, 21, 'a'], [E - 1, 11, 14, 'R'], [E - 1, 17, 20, 'C'], [E, 10, 10, 'a'], [E, 15, 16, 'a'], [E, 21, 21, 'a'], [E, 11, 14, 'R'], [E, 17, 20, 'C'], [E + 1, 10, 21, 'a'], [E - 1, 8, 9, 'a'], [E - 1, 22, 23, 'a']] },
  { name: 'Aviators', colours: ['Gold', 'Silver', 'Rose', 'Black', 'Jade'], ink: false, runs: [[E - 2, 10, 21, 'a'], [E - 1, 11, 14, 'l'], [E - 1, 17, 20, 'l'], [E, 11, 14, 'l'], [E, 17, 20, 'l'], [E + 1, 12, 14, 'l'], [E + 1, 17, 19, 'l'], [E - 1, 9, 9, 'a'], [E - 1, 22, 22, 'a']] },
  { name: 'Monocle', colours: ['Gold', 'Silver', 'Black', 'Rose', 'Jade'], ink: false, runs: [[E - 2, 18, 19, 'a'], [E - 1, 17, 17, 'a'], [E - 1, 20, 20, 'a'], [E, 17, 17, 'a'], [E, 20, 20, 'a'], [E + 1, 18, 19, 'a'], [E + 2, 20, 20, 'a'], [E + 3, 21, 21, 'a'], [E + 4, 21, 21, 'a'], [E + 5, 22, 22, 'a'], [E + 6, 22, 22, 'a']] },
  { name: 'Laser eyes', colours: ['Red', 'Green', 'Blue', 'Purple', 'Gold'], ink: false, runs: [[E, 12, 13, 'w'], [E, 18, 19, 'w'], [E, 14, 17, 'a'], [E, 20, 31, 'a'], [E - 1, 21, 31, 'c'], [E + 1, 21, 31, 'c']] },
  { name: 'VR headset', colours: ['White', 'Black', 'Gray', 'Navy', 'Red'], runs: [[E - 2, 9, 22, 'a'], [E - 1, 9, 9, 'a'], [E - 1, 10, 21, 'b'], [E - 1, 22, 22, 'a'], [E, 9, 9, 'a'], [E, 10, 21, 'b'], [E, 22, 22, 'a'], [E, 12, 19, 'L'], [E + 1, 9, 22, 'a'], [E - 1, 7, 8, 'k'], [E - 1, 23, 24, 'k']] },
  { name: 'Eye patch', colours: ['Black', 'Maroon', 'Navy', 'Olive', 'Gray'], ink: false, runs: [[E - 1, 11, 14, 'a'], [E, 11, 14, 'a'], [E + 1, 12, 13, 'a'], [E - 2, 10, 10, 'a'], [E - 3, 9, 9, 'a'], [E - 2, 15, 16, 'a'], [E - 3, 17, 18, 'a'], [E - 4, 19, 20, 'a'], [E - 4, 21, 22, 'a']] },
];

/** A palette for a sprite: a/b/c the colour's three tones, the design's accent as r, and the fixed extras. */
function palette(name: string, accent?: string): Pal {
  const [a, b, c] = COLOURS[name] ?? COLOURS.Black!;
  return { a, b, c, r: accent ?? c, w: '#F4F4F2', k: INK, g: '#FFFFFF', l: name === 'White' ? '#1E1E24' : name === 'Black' ? '#16161A' : b, R: '#E5484D', C: '#4CC3E8', L: '#6FE3FF' };
}

// ── Picking ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PfpTraits { skin: string; hat: string; glasses: string; shirt: string; background: number; expression: number; picks: [number, number, number, number] }

/**
 * The animal (0–49: 10 kinds × 5 coats), hat, glasses and shirt (0–49 each), the backdrop and the expression, from the
 * seed. Like an NFT collection, not every one wears everything: about 4 in 10 have no hat (bunnies never: their ears) and
 * about half no glasses; -1 is "none".
 */
export function pfpTraits(seed: string): PfpTraits {
  const h = createHash('sha256').update(`pfp:${seed}`).digest();
  const n = (i: number) => h.readUInt32BE(i * 4);
  const skin = n(0) % 50, kind = KINDS[Math.floor(skin / 5)]!, tone = kind.tones[skin % 5]!;
  const hat = kind.hat === false || n(6) % 10 < 4 ? -1 : n(1) % 50;
  const glasses = n(7) % 10 < 5 ? -1 : n(2) % 50;
  const shirt = n(3) % 50;
  const H = hat < 0 ? null : HATS[Math.floor(hat / 5)]!, G = glasses < 0 ? null : GLASSES[Math.floor(glasses / 5)]!, S = SHIRTS[Math.floor(shirt / 5)]!;
  return {
    skin: `${kind.name}, ${tone[0]}`,
    hat: H ? `${H.name}, ${H.colours[hat % 5]}` : 'None',
    glasses: G ? `${G.name}, ${G.colours[glasses % 5]}` : 'None',
    shirt: `${S.name}, ${S.colours[shirt % 5]}`,
    background: n(4) % SKIES.length,
    expression: n(5) % 5,
    picks: [skin, hat, glasses, shirt],
  };
}

/** The picture for explicit picks (the generator above, or a test sheet that walks every trait). */
export function pfpFrom(picks: [number, number, number, number], background = 0, expression = 0): string {
  const [skin, hat, glasses, shirt] = picks;
  const kind = KINDS[Math.floor(skin / 5)]!, [coatName, tone] = kind.tones[skin % 5]!;
  const c = new Canvas();
  for (let i = 0; i < N * N; i++) c.px[i] = SKIES[background % SKIES.length];
  const S = SHIRTS[Math.floor(shirt / 5)]!;
  S.draw(c, COLOURS[S.colours[shirt % 5]!]!, tone);
  kind.draw(c, tone, expression, coatName);
  // A negative pick leaves the layer off (no hat, no glasses; the review sheets show each layer alone).
  if (glasses >= 0) { const G = GLASSES[Math.floor(glasses / 5)]!; c.sprite(G.runs, palette(G.colours[glasses % 5]!, G.accent), G.ink === false ? null : INK); }
  if (hat >= 0 && kind.hat !== false) { const H = HATS[Math.floor(hat / 5)]!; c.sprite(H.runs, palette(H.colours[hat % 5]!, H.accent), H.ink === false ? null : INK); }
  return c.svg();
}

/** An agent's picture: its traits drawn. */
export function pfpSvg(seed: string): string {
  const t = pfpTraits(seed);
  return pfpFrom(t.picks, t.background, t.expression);
}

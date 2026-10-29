import { createHash } from 'node:crypto';

/**
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
export const BACKGROUNDS = ['#638596', '#95554F', '#76658F', '#8E8E5E', '#5E8E74', '#A7836B', '#5B6C8F', '#8F5B7A', '#6B8F8C', '#9C7F4D', '#4F6E5F', '#7C5E9C'];

// ── Skins: 10 kinds × 5 palettes ─────────────────────────────────────────────────────────────────────────────────────
/** base, shade, light. */
type Tone = [string, string, string];
interface Kind { name: string; tones: [string, Tone][]; draw: (c: Canvas, t: Tone, mouth: number) => void }

const EYE_Y = 13;
const WHITE = '#F4F4F2';

/** The head every kind starts from: rows 7–22, columns 9–22, jaw and crown rounded; shade down the right side. */
function head(extra?: (s: Set<number>) => void) {
  const s = rect(9, 7, 22, 22);
  drop(s, [9, 7], [10, 7], [9, 8], [22, 7], [21, 7], [22, 8], [9, 22], [10, 22], [9, 21], [22, 22], [21, 22], [22, 21]);
  extra?.(s);
  return s;
}
const shaded = (t: Tone, light?: (x: number, y: number) => boolean) => (x: number, y: number) =>
  light?.(x, y) ? t[2] : x >= 21 || y >= 21 ? t[1] : t[0];

function neck(c: Canvas, t: Tone) {
  c.shape(rect(13, 20, 18, 25), (x, y) => (y >= 23 ? t[1] : t[0]));
}
function eyes(c: Canvas, iris = INK, white = WHITE) {
  c.set(12, EYE_Y, white); c.set(13, EYE_Y, iris);
  c.set(18, EYE_Y, white); c.set(19, EYE_Y, iris);
}
function brows(c: Canvas, col: string) {
  for (const x of [11, 12, 13, 18, 19, 20]) c.set(x, EYE_Y - 2, col);
}
/** Five expressions: neutral, smile, smirk, open, frown. */
function mouth(c: Canvas, kind: number, col = INK, y = 18) {
  if (kind === 0) for (let x = 14; x <= 17; x++) c.set(x, y, col);
  if (kind === 1) { c.set(13, y - 1, col); for (let x = 14; x <= 17; x++) c.set(x, y, col); c.set(18, y - 1, col); }
  if (kind === 2) { for (let x = 14; x <= 17; x++) c.set(x, y, col); c.set(18, y - 1, col); }
  if (kind === 3) { for (let x = 14; x <= 17; x++) c.set(x, y, col); for (let x = 15; x <= 16; x++) c.set(x, y + 1, '#7A2E2E'); }
  if (kind === 4) { c.set(13, y + 1, col); for (let x = 14; x <= 17; x++) c.set(x, y, col); c.set(18, y + 1, col); }
}
const nose = (c: Canvas, col: string) => { c.set(16, 15, col); c.set(16, 16, col); };

const KINDS: Kind[] = [
  {
    name: 'Human',
    tones: [['Fair', ['#F1C7A5', '#D9A47E', '#F8DCC4']], ['Tan', ['#E0A97E', '#C2865C', '#EDC09C']], ['Olive', ['#B97C52', '#985F3B', '#CC9670']], ['Brown', ['#8A5A3B', '#6E4329', '#A06E4C']], ['Deep', ['#5C3A26', '#45291A', '#734C34']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(head((s) => { rect(8, 12, 8, 15, s); rect(23, 12, 23, 15, s); }), shaded(t, (x, y) => x === 11 && y === 9));
      eyes(c); brows(c, t[1]); nose(c, t[1]); mouth(c, m);
    },
  },
  {
    name: 'Ape',
    tones: [['Brown', ['#6B4A2F', '#523720', '#C9A27E']], ['Black', ['#2E2A28', '#1E1B1A', '#8C7B6B']], ['Golden', ['#C8902F', '#A6741F', '#F0CF94']], ['Gray', ['#7D7F86', '#62646B', '#C4C2BD']], ['Snow', ['#E8E4DC', '#C9C3B8', '#F3D9CC']]],
    draw(c, t, m) {
      neck(c, t);
      const face = (x: number, y: number) => (y >= 15 && y <= 21 && x >= 11 && x <= 20) || (y >= 11 && y <= 14 && x >= 10 && x <= 21);
      c.shape(head((s) => { rect(8, 8, 23, 21, s); rect(6, 12, 7, 15, s); rect(24, 12, 25, 15, s); }), (x, y) => (face(x, y) ? t[2] : x >= 22 || y >= 21 ? t[1] : t[0]));
      eyes(c); brows(c, t[1]);
      c.set(14, 17, INK); c.set(17, 17, INK);
      mouth(c, m, INK, 19);
    },
  },
  {
    name: 'Cat',
    tones: [['Ginger', ['#E8892E', '#C46D1C', '#F7C58A']], ['Black', ['#2B2B30', '#1A1A1E', '#55555E']], ['White', ['#F2EFEA', '#D3CEC6', '#FFFFFF']], ['Gray', ['#8E949C', '#71767D', '#B7BCC2']], ['Cream', ['#E9D3A8', '#CDB385', '#F6E9CC']]],
    draw(c, t) {
      neck(c, t);
      const ears: Run[] = [[3, 9, 9, 'a'], [4, 9, 10, 'a'], [5, 9, 11, 'a'], [6, 9, 12, 'a'], [3, 22, 22, 'a'], [4, 21, 22, 'a'], [5, 20, 22, 'a'], [6, 19, 22, 'a']];
      c.sprite(ears, { a: t[0] });
      c.shape(head(), shaded(t, (x, y) => y >= 15 && y <= 19 && x >= 12 && x <= 19));
      c.set(10, 5, '#E9A3A3'); c.set(10, 6, '#E9A3A3'); c.set(21, 5, '#E9A3A3'); c.set(21, 6, '#E9A3A3');
      c.set(12, EYE_Y, '#9BE15D'); c.set(13, EYE_Y, INK); c.set(18, EYE_Y, '#9BE15D'); c.set(19, EYE_Y, INK);
      c.set(15, 15, '#E07A8A'); c.set(16, 15, '#E07A8A');
      c.set(14, 17, INK); c.set(15, 18, INK); c.set(16, 18, INK); c.set(17, 17, INK);
      for (const [x, y] of [[6, 15], [7, 15], [8, 16], [6, 17], [7, 17], [23, 16], [24, 15], [25, 15], [24, 17], [25, 17]] as const) c.set(x, y, '#D8D8D8');
    },
  },
  {
    name: 'Robot',
    tones: [['Chrome', ['#B9C0C8', '#8E959D', '#E2E6EA']], ['Gold', ['#E2B33C', '#B88C22', '#F6DA8A']], ['Cobalt', ['#4C7FD0', '#355FA3', '#8AB0EC']], ['Onyx', ['#3A3D44', '#26282D', '#5E626B']], ['Copper', ['#C77A4A', '#9E5B33', '#E5A57C']]],
    draw(c, t) {
      c.shape(rect(13, 20, 18, 25), (x, y) => ((x + y) % 2 ? t[1] : t[0]));
      c.sprite([[2, 15, 16, 'r'], [3, 15, 16, 'r'], [4, 16, 16, 'a'], [5, 16, 16, 'a'], [6, 16, 16, 'a']], { a: t[1], r: '#FF5C6C' });
      c.shape(add(rect(9, 7, 22, 21), [8, 13], [8, 14], [23, 13], [23, 14]), (x, y) => (x === 8 || x === 23 ? t[1] : x >= 21 || y >= 20 ? t[1] : y === 8 && x < 14 ? t[2] : t[0]));
      for (let x = 11; x <= 20; x++) c.set(x, EYE_Y, x === 15 || x === 16 ? t[1] : '#6FE3FF');
      for (let x = 11; x <= 20; x++) c.set(x, EYE_Y - 1, INK);
      for (let x = 11; x <= 20; x++) c.set(x, EYE_Y + 1, INK);
      c.set(10, EYE_Y, INK); c.set(21, EYE_Y, INK);
      for (let x = 12; x <= 19; x++) { c.set(x, 17, INK); c.set(x, 18, x % 2 ? t[2] : INK); c.set(x, 19, INK); }
    },
  },
  {
    name: 'Alien',
    tones: [['Moss', ['#7CC46A', '#5A9C4A', '#AEE19F']], ['Teal', ['#3FB8AF', '#2C8F88', '#86DCD5']], ['Violet', ['#9B6BD1', '#7A4FAE', '#C3A2EA']], ['Azure', ['#5B8DEF', '#4170C9', '#9CBDF6']], ['Rose', ['#E57AB8', '#C05A95', '#F3B1D6']]],
    draw(c, t, m) {
      neck(c, t);
      const s = rect(9, 5, 22, 22);
      drop(s, [9, 5], [10, 5], [11, 5], [9, 6], [22, 5], [21, 5], [20, 5], [22, 6], [9, 22], [10, 22], [9, 21], [22, 22], [21, 22], [22, 21], [9, 20], [22, 20]);
      c.shape(s, shaded(t, (x, y) => (x === 12 || x === 13) && y === 7));
      for (const [x0, x1] of [[11, 13], [18, 20]] as const) for (let x = x0; x <= x1; x++) for (let y = EYE_Y - 1; y <= EYE_Y + 1; y++) c.set(x, y, INK);
      c.set(11, EYE_Y - 1, '#FFFFFF'); c.set(18, EYE_Y - 1, '#FFFFFF');
      mouth(c, m === 3 ? 0 : m, t[1] === '#5A9C4A' ? INK : INK, 19);
    },
  },
  {
    name: 'Zombie',
    tones: [['Moss', ['#8FAF7E', '#6F8F60', '#B5CDA8']], ['Ash', ['#9DB0A6', '#7C8E85', '#C3D0C9']], ['Bile', ['#A3A86F', '#82874F', '#C6CA98']], ['Sea', ['#7E9B95', '#5F7C76', '#A9C2BD']], ['Lilac', ['#B3A6C2', '#9283A4', '#D0C6DB']]],
    draw(c, t, m) {
      neck(c, t);
      c.shape(head((s) => { rect(8, 12, 8, 15, s); rect(23, 12, 23, 15, s); }), shaded(t));
      c.set(12, EYE_Y, '#E8E2B0'); c.set(13, EYE_Y, '#7A1F1F'); c.set(18, EYE_Y, '#E8E2B0'); c.set(19, EYE_Y, '#7A1F1F');
      for (const x of [11, 12, 13]) c.set(x, EYE_Y + 1, t[1]);
      for (const [x, y] of [[13, 9], [14, 9], [15, 9], [16, 9], [17, 9], [14, 8], [16, 8], [14, 10], [16, 10]] as const) c.set(x, y, '#4A3A3A');
      nose(c, t[1]); mouth(c, m === 1 ? 4 : m);
    },
  },
  {
    name: 'Skeleton',
    tones: [['Bone', ['#E9E4D4', '#C4BDA8', '#FFFFFF']], ['Ivory', ['#F3EBD2', '#D2C7A6', '#FFFDF4']], ['Gilded', ['#E8C25A', '#BF9A36', '#F7DE97']], ['Glow', ['#B7F5A0', '#83C96E', '#E2FFD6']], ['Obsidian', ['#5A5663', '#3E3B46', '#7F7A8C']]],
    draw(c, t) {
      c.shape(rect(14, 20, 17, 25), (x) => (x % 2 ? t[1] : t[0]));
      const s = rect(9, 7, 22, 18);
      drop(s, [9, 7], [10, 7], [9, 8], [22, 7], [21, 7], [22, 8]);
      rect(11, 19, 20, 22, s);
      drop(s, [11, 22], [20, 22]);
      c.shape(s, shaded(t));
      const socket = t[0] === '#5A5663' ? '#8BF0FF' : INK;
      for (const [x0, x1] of [[11, 13], [18, 20]] as const) for (let x = x0; x <= x1; x++) for (let y = EYE_Y - 1; y <= EYE_Y + 1; y++) c.set(x, y, INK);
      c.set(12, EYE_Y, socket); c.set(19, EYE_Y, socket);
      c.set(15, 16, INK); c.set(16, 16, INK); c.set(15, 17, INK);
      for (let x = 12; x <= 19; x++) c.set(x, 19, x % 2 ? INK : t[2]);
      for (let x = 12; x <= 19; x++) c.set(x, 20, INK);
    },
  },
  {
    name: 'Frog',
    tones: [['Pond', ['#5DBB4A', '#43923A', '#A5DE8F']], ['Lime', ['#A8D84A', '#86B336', '#D3EF96']], ['Poison', ['#4AA3D8', '#357FB0', '#93CCEE']], ['Ember', ['#E05A4A', '#B8433A', '#F29A8E']], ['Sun', ['#EBC84A', '#C7A436', '#F6E39A']]],
    draw(c, t, m) {
      neck(c, t);
      const s = rect(8, 9, 23, 22);
      drop(s, [8, 9], [8, 10], [23, 9], [23, 10], [8, 22], [9, 22], [23, 22], [22, 22]);
      rect(9, 5, 13, 9, s); rect(18, 5, 22, 9, s);
      drop(s, [9, 5], [13, 5], [18, 5], [22, 5]);
      c.shape(s, (x, y) => (y >= 17 && x >= 10 && x <= 21 ? t[2] : x >= 22 || y >= 21 ? t[1] : t[0]));
      for (const x0 of [10, 19]) { c.set(x0, 6, WHITE); c.set(x0 + 1, 6, WHITE); c.set(x0, 7, WHITE); c.set(x0 + 1, 7, INK); c.set(x0 + 2, 7, WHITE); }
      c.set(14, 13, INK); c.set(17, 13, INK);
      const curve = m === 4 ? 1 : -1;
      for (let x = 10; x <= 21; x++) c.set(x, 16, INK);
      c.set(9, 16 + curve, INK); c.set(22, 16 + curve, INK);
    },
  },
  {
    name: 'Bear',
    tones: [['Grizzly', ['#8B5A34', '#6B4226', '#C8A07A']], ['Black', ['#2F2A27', '#1F1B19', '#8A7A6A']], ['Polar', ['#F1EEE6', '#D4CFC4', '#FFFFFF']], ['Panda', ['#F4F2EE', '#D6D2CA', '#1E1E1E']], ['Honey', ['#D49A3E', '#B17C29', '#F1CD8E']]],
    draw(c, t, m) {
      const panda = t[2] === '#1E1E1E';
      neck(c, panda ? ['#1E1E1E', '#141414', '#2A2A2A'] : t);
      c.sprite([[4, 9, 10, 'a'], [5, 8, 11, 'a'], [6, 8, 11, 'a'], [4, 21, 22, 'a'], [5, 20, 23, 'a'], [6, 20, 23, 'a']], { a: panda ? '#1E1E1E' : t[1] });
      c.shape(head(), (x, y) => (!panda && y >= 15 && y <= 20 && x >= 12 && x <= 19 ? t[2] : x >= 21 || y >= 21 ? t[1] : t[0]));
      if (panda) for (const [x0, x1] of [[11, 13], [18, 20]] as const) for (let x = x0; x <= x1; x++) for (let y = EYE_Y - 1; y <= EYE_Y + 1; y++) c.set(x, y, '#1E1E1E');
      c.set(12, EYE_Y, panda ? WHITE : INK); c.set(19, EYE_Y, panda ? WHITE : INK);
      c.set(15, 16, INK); c.set(16, 16, INK); c.set(15, 17, INK); c.set(16, 17, INK);
      mouth(c, m === 3 ? 1 : m, INK, 19);
    },
  },
  {
    name: 'Devil',
    tones: [['Scarlet', ['#D64545', '#AD3030', '#EE8484']], ['Crimson', ['#A8233A', '#841A2D', '#D45A70']], ['Plum', ['#7E3FB0', '#622E8B', '#B07BDA']], ['Shadow', ['#3A2F3A', '#271F27', '#6A586A']], ['Flame', ['#E8743A', '#C25A27', '#F4A97E']]],
    draw(c, t, m) {
      neck(c, t);
      c.sprite([[3, 9, 9, 'h'], [4, 9, 10, 'h'], [5, 10, 11, 'h'], [6, 11, 12, 'h'], [3, 22, 22, 'h'], [4, 21, 22, 'h'], [5, 20, 21, 'h'], [6, 19, 20, 'h']], { h: '#EFE6D2' });
      c.shape(head((s) => { add(s, [8, 12], [8, 13], [7, 12], [23, 12], [23, 13], [24, 12]); }), shaded(t, (x, y) => x === 11 && y === 9));
      c.set(12, EYE_Y, '#FFD84A'); c.set(13, EYE_Y, INK); c.set(18, EYE_Y, '#FFD84A'); c.set(19, EYE_Y, INK);
      for (const [x, y] of [[11, 11], [12, 12], [20, 11], [19, 12]] as const) c.set(x, y, INK);
      nose(c, t[1]); mouth(c, m === 0 ? 2 : m);
      c.set(14, 19, WHITE);
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

/** The four traits (0–49 each), the background and the expression, from the seed. */
export function pfpTraits(seed: string): PfpTraits {
  const h = createHash('sha256').update(`pfp:${seed}`).digest();
  const n = (i: number) => h.readUInt32BE(i * 4);
  const picks = [n(0) % 50, n(1) % 50, n(2) % 50, n(3) % 50] as [number, number, number, number];
  const [skin, hat, glasses, shirt] = picks;
  const kind = KINDS[Math.floor(skin / 5)]!, tone = kind.tones[skin % 5]!;
  const H = HATS[Math.floor(hat / 5)]!, G = GLASSES[Math.floor(glasses / 5)]!, S = SHIRTS[Math.floor(shirt / 5)]!;
  return {
    skin: `${kind.name}, ${tone[0]}`,
    hat: `${H.name}, ${H.colours[hat % 5]}`,
    glasses: `${G.name}, ${G.colours[glasses % 5]}`,
    shirt: `${S.name}, ${S.colours[shirt % 5]}`,
    background: n(4) % BACKGROUNDS.length,
    expression: n(5) % 5,
    picks,
  };
}

/** The picture for explicit picks (the generator above, or a test sheet that walks every trait). */
export function pfpFrom(picks: [number, number, number, number], background = 0, expression = 0): string {
  const [skin, hat, glasses, shirt] = picks;
  const kind = KINDS[Math.floor(skin / 5)]!, tone = kind.tones[skin % 5]![1];
  const c = new Canvas();
  for (let i = 0; i < N * N; i++) c.px[i] = BACKGROUNDS[background % BACKGROUNDS.length];
  const S = SHIRTS[Math.floor(shirt / 5)]!;
  S.draw(c, COLOURS[S.colours[shirt % 5]!]!, tone);
  kind.draw(c, tone, expression);
  // A negative pick leaves the layer off (the review sheets show each layer alone).
  if (glasses >= 0) { const G = GLASSES[Math.floor(glasses / 5)]!; c.sprite(G.runs, palette(G.colours[glasses % 5]!, G.accent), G.ink === false ? null : INK); }
  if (hat >= 0) { const H = HATS[Math.floor(hat / 5)]!; c.sprite(H.runs, palette(H.colours[hat % 5]!, H.accent), H.ink === false ? null : INK); }
  return c.svg();
}

/** An agent's picture: its traits drawn. */
export function pfpSvg(seed: string): string {
  const t = pfpTraits(seed);
  return pfpFrom(t.picks, t.background, t.expression);
}

/**
 * An agent's face (The Wall, 2026-10-14): a flat character head and shoulders, drawn the same on the server (the avatar
 * route) and in the browser (the Wall paints thousands of them without a request each). Everything that makes the face
 * recognisable (palette, head shape, eyes, hair or hat, marks) comes from the agent's id; its personality, as a `look`,
 * sets the expression and one or two accessories. A look is coarse (three levels per trait), so the face stays the same
 * while traits drift and changes only when the agent really becomes someone else.
 */

/** Six digits, '0' low to '2' high: risk, pettiness, humor, curiosity, loyalty, greed. */
export type FaceLook = string;
const LOOK_TRAITS = ['risk', 'pettiness', 'humor', 'curiosity', 'loyalty', 'greed'] as const;
type LookTrait = (typeof LOOK_TRAITS)[number];

/** The look for a set of traits (each 0..1); a missing trait counts as middling. */
export function faceLook(traits: Partial<Record<LookTrait, number>> | null | undefined): FaceLook {
  return LOOK_TRAITS.map((t) => { const v = traits?.[t] ?? 0.5; return v < 0.34 ? '0' : v > 0.66 ? '2' : '1'; }).join('');
}

/** FNV-1a, then a mulberry32 stream: the same id always draws the same face, on any engine. */
function stream(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Curated sets. Tiles are deep, heads light (so a face reads at 12 px as a lit window), clothes and hair carry the
// strong colours. A dark head flips its features to light ink.
const TILES = ['#1C2A44', '#12393B', '#3E1D2A', '#1D3524', '#283039', '#47261A', '#15304A', '#2D3A1E', '#1E2130', '#4A2222', '#173A3F', '#3A2A22', '#222C3A', '#33301A', '#2A1F33', '#203A33'];
const HEADS = ['#F2C29B', '#D49A6A', '#8D5A3B', '#F6E7DA', '#9FE3C1', '#9CC8FF', '#AFC2FF', '#F7E27C', '#FF9E86', '#B9C99A', '#B8C1CC', '#E8D2A6', '#F4A9B8', '#7FDCE0', '#FFB067', '#C7C28A', '#DADDE2', '#4A4E57', '#6B4A3A', '#E9B8F0'];
const DARK_HEADS = new Set(['#8D5A3B', '#4A4E57', '#6B4A3A']);
const SHIRTS = ['#FF6A3D', '#5B8CFF', '#EDEDED', '#0F1012', '#FFC857', '#3DDC97', '#E2475B', '#2BB3A3', '#E8DCC6', '#8E9099', '#F28AB2', '#7A5CFF', '#C2E15B', '#1F6FEB'];
const HAIRS = ['#18191C', '#4B2E1F', '#E9C46A', '#C8642F', '#E8E8E8', '#3D5AFE', '#FF7AA2', '#2BB37A', '#8A4FFF', '#FF6A3D', '#7A7F8A', '#0E3B5C'];
const GADGETS = ['#FFD166', '#FF6A3D', '#7FE4FF', '#3DDC97', '#FF5C8A'];
const INK = '#15161A', LIGHT_INK = '#F7F7F5', GOLD = '#F5C451', IVORY = '#F3E9D2';

const F = (v: number) => (Math.round(v * 10) / 10).toString();
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

/** The tile and head colours alone: what the Wall paints when a face is too small to draw (a lit window). */
export function faceColours(id: string): { tile: string; head: string } {
  const r = stream(`face:${id}`);
  const tile = pick(r, TILES), head = pick(r, HEADS);
  return { tile, head };
}

type Head = { cx: number; cy: number; w: number; h: number; top: number; bottom: number };

/** Twelve silhouettes, each centred on the head box. Hexagon, octagon and trapezoid round their corners with a stroke. */
function headShape(kind: number, b: Head, fill: string): string {
  const { cx, cy, w, h, top, bottom } = b, l = cx - w / 2, rt = cx + w / 2;
  const poly = (pts: [number, number][]) => `<polygon points="${pts.map(([x, y]) => `${F(x)},${F(y)}`).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="7" stroke-linejoin="round"/>`;
  switch (kind) {
    case 0: return `<ellipse cx="${F(cx)}" cy="${F(cy)}" rx="${F(w / 2)}" ry="${F(h / 2)}" fill="${fill}"/>`;
    case 1: return `<rect x="${F(l)}" y="${F(top)}" width="${F(w)}" height="${F(h)}" rx="7" fill="${fill}"/>`;
    case 2: return `<rect x="${F(l)}" y="${F(top)}" width="${F(w)}" height="${F(h)}" rx="${F(w * 0.32)}" fill="${fill}"/>`;
    case 3: return `<path d="M${F(cx)} ${F(top)}C${F(cx + w * 0.42)} ${F(top)} ${F(rt + 1)} ${F(cy + h * 0.15)} ${F(rt - 1)} ${F(cy + h * 0.28)}C${F(rt - 3)} ${F(bottom)} ${F(cx + w * 0.2)} ${F(bottom)} ${F(cx)} ${F(bottom)}C${F(cx - w * 0.2)} ${F(bottom)} ${F(l + 3)} ${F(bottom)} ${F(l + 1)} ${F(cy + h * 0.28)}C${F(l - 1)} ${F(cy + h * 0.15)} ${F(cx - w * 0.42)} ${F(top)} ${F(cx)} ${F(top)}Z" fill="${fill}"/>`;
    case 4: return poly([[cx, top + 3], [rt - 3, cy - h * 0.22], [rt - 3, cy + h * 0.22], [cx, bottom - 3], [l + 3, cy + h * 0.22], [l + 3, cy - h * 0.22]]);
    case 5: return `<path d="M${F(l)} ${F(top + 4)}Q${F(l)} ${F(top)} ${F(l + 4)} ${F(top)}L${F(rt - 4)} ${F(top)}Q${F(rt)} ${F(top)} ${F(rt)} ${F(top + 4)}L${F(rt)} ${F(cy + 2)}Q${F(rt)} ${F(bottom)} ${F(cx)} ${F(bottom)}Q${F(l)} ${F(bottom)} ${F(l)} ${F(cy + 2)}Z" fill="${fill}"/>`;
    case 6: return `<rect x="${F(cx - w * 0.4)}" y="${F(top - 2)}" width="${F(w * 0.8)}" height="${F(h + 2)}" rx="${F(w * 0.4)}" fill="${fill}"/>`;
    case 7: return `<rect x="${F(l - 2)}" y="${F(top + 4)}" width="${F(w + 4)}" height="${F(h - 6)}" rx="${F((h - 6) / 2)}" fill="${fill}"/>`;
    case 8: { const k = w * 0.3; return poly([[l + k, top + 3], [rt - k, top + 3], [rt - 3, top + k], [rt - 3, bottom - k], [rt - k, bottom - 3], [l + k, bottom - 3], [l + 3, bottom - k], [l + 3, top + k]]); }
    case 9: return `<g fill="${fill}"><circle cx="${F(cx - w * 0.22)}" cy="${F(top + h * 0.3)}" r="${F(w * 0.28)}"/><circle cx="${F(cx + w * 0.22)}" cy="${F(top + h * 0.3)}" r="${F(w * 0.28)}"/><circle cx="${F(cx)}" cy="${F(top + h * 0.22)}" r="${F(w * 0.3)}"/><ellipse cx="${F(cx)}" cy="${F(cy + h * 0.1)}" rx="${F(w / 2)}" ry="${F(h * 0.4)}"/></g>`;
    case 10: return poly([[l + 7, top + 3], [rt - 7, top + 3], [rt - 2, bottom - 3], [l + 2, bottom - 3]]);
    default: return `<g fill="${fill}"><ellipse cx="${F(cx)}" cy="${F(cy + 1)}" rx="${F(w / 2)}" ry="${F(h / 2 - 1)}"/><path d="M${F(cx - 5)} ${F(top + 3)}Q${F(cx + 1)} ${F(top - 7)} ${F(cx + 6)} ${F(top - 5)}Q${F(cx + 2)} ${F(top)} ${F(cx + 5)} ${F(top + 3)}Z"/></g>`;
  }
}

/**
 * The face as an SVG (viewBox 64 × 64, a full-bleed tile behind it, so a squircle or circle clip shows it either way).
 * `look` is faceLook(traits); without one the face draws a middling personality from the id.
 */
export function faceSvg(id: string, look?: FaceLook | null): string {
  const r = stream(`face:${id}`);
  // The draws happen in a fixed order, all from the id, so a new look never reshuffles who the agent is.
  const tile = pick(r, TILES), headFill = pick(r, HEADS), shirt = pick(r, SHIRTS), hair = pick(r, HAIRS), gadget = pick(r, GADGETS);
  const shape = Math.floor(r() * 12), eyesKind = Math.floor(r() * 8), wear = Math.floor(r() * 9), mark = Math.floor(r() * 6);
  const w = 30 + Math.floor(r() * 7), h = 30 + Math.floor(r() * 6), gap = 6 + Math.floor(r() * 3), gaze = Math.floor(r() * 3) - 1;
  const collar = Math.floor(r() * 3), flip = r() < 0.5 ? 1 : -1, fallback = Array.from({ length: 6 }, () => String(Math.floor(r() * 3))).join('');
  const lk = look && /^[0-2]{6}$/.test(look) ? look : fallback;
  const [riskLevel, petty, humor, curious, loyal, greed] = [...lk].map(Number) as [number, number, number, number, number, number];
  // Not every bold agent wears shades: about two in three do, the rest show it in a scar.
  const risk = riskLevel === 2 && eyesKind % 3 === 0 ? 1 : riskLevel;

  const ink = DARK_HEADS.has(headFill) ? LIGHT_INK : INK;
  const cx = 32, cy = 29, top = cy - h / 2, bottom = cy + h / 2;
  const b: Head = { cx, cy, w, h, top, bottom };
  const eyeY = cy - 1, ex = gap, my = cy + h * 0.27;
  const parts: string[] = [];

  // Shoulders and collar.
  parts.push(`<path d="M6 64Q7 51 22 49L42 49Q57 51 58 64Z" fill="${shirt}"/>`);
  if (collar === 1) parts.push(`<path d="M26 49L32 56L38 49Z" fill="${headFill}"/>`);
  if (collar === 2) parts.push(`<path d="M24 49L32 54L40 49" fill="none" stroke="${ink === INK ? '#00000040' : '#ffffff40'}" stroke-width="2"/>`);
  if (greed === 2 && wear % 2 === 0) parts.push(`<path d="M22 51Q32 60 42 51" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="57" r="2.6" fill="${GOLD}"/>`);
  if (loyal === 2 && mark % 2 === 0) parts.push(`<path d="M${F(cx + 13 * flip)} 54l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="${GOLD}"/>`);
  // Neck, under the head.
  parts.push(`<rect x="27" y="${F(bottom - 4)}" width="10" height="${F(53 - bottom)}" rx="3" fill="${headFill}"/>`);

  // Headwear behind the head (headphones' band, a halo).
  const wearKind = curious === 2 && wear % 3 === 0 ? 'antenna' : petty === 2 && wear % 4 === 1 ? 'horns' : (['none', 'cap', 'beanie', 'tuft', 'part', 'phones', 'bun', 'fringe', 'none'] as const)[wear]!;
  if (wearKind === 'phones') parts.push(`<path d="M${F(cx - w / 2 - 1)} ${F(cy)}Q${F(cx - w / 2 - 1)} ${F(top - 6)} ${F(cx)} ${F(top - 6)}Q${F(cx + w / 2 + 1)} ${F(top - 6)} ${F(cx + w / 2 + 1)} ${F(cy)}" fill="none" stroke="${INK}" stroke-width="3"/>`);
  if (wearKind === 'horns') parts.push(`<g fill="${IVORY}"><path d="M${F(cx - 8)} ${F(top + 4)}Q${F(cx - 16)} ${F(top - 2)} ${F(cx - 15)} ${F(top - 9)}Q${F(cx - 9)} ${F(top - 4)} ${F(cx - 3)} ${F(top + 2)}Z"/><path d="M${F(cx + 8)} ${F(top + 4)}Q${F(cx + 16)} ${F(top - 2)} ${F(cx + 15)} ${F(top - 9)}Q${F(cx + 9)} ${F(top - 4)} ${F(cx + 3)} ${F(top + 2)}Z"/></g>`);
  if (wearKind === 'antenna') parts.push(`<path d="M${F(cx + 3 * flip)} ${F(top + 2)}L${F(cx + 7 * flip)} ${F(top - 9)}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><circle cx="${F(cx + 7 * flip)}" cy="${F(top - 10)}" r="3" fill="${gadget}"/>`);
  if (wearKind === 'bun') parts.push(`<circle cx="${F(cx)}" cy="${F(top - 2)}" r="6" fill="${hair}"/>`);

  parts.push(headShape(shape, b, headFill));

  // Headwear over the head.
  if (wearKind === 'cap') parts.push(`<path d="M${F(cx - w / 2)} ${F(top + 9)}Q${F(cx - w / 2)} ${F(top - 2)} ${F(cx)} ${F(top - 2)}Q${F(cx + w / 2)} ${F(top - 2)} ${F(cx + w / 2)} ${F(top + 9)}Z" fill="${shirt === hair ? gadget : hair}"/><path d="M${F(cx)} ${F(top + 9)}L${F(cx + (w / 2 + 9) * flip)} ${F(top + 10)}" stroke="${shirt === hair ? gadget : hair}" stroke-width="4" stroke-linecap="round"/>`);
  if (wearKind === 'beanie') parts.push(`<path d="M${F(cx - w / 2 - 1)} ${F(top + 8)}Q${F(cx - w / 2)} ${F(top - 5)} ${F(cx)} ${F(top - 5)}Q${F(cx + w / 2)} ${F(top - 5)} ${F(cx + w / 2 + 1)} ${F(top + 8)}Z" fill="${hair}"/><rect x="${F(cx - w / 2 - 2)}" y="${F(top + 5)}" width="${F(w + 4)}" height="5" rx="2.5" fill="${gadget}"/><circle cx="${F(cx)}" cy="${F(top - 6)}" r="3.4" fill="${gadget}"/>`);
  if (wearKind === 'tuft') parts.push(`<path d="M${F(cx - 9)} ${F(top + 4)}L${F(cx - 6)} ${F(top - 7)}L${F(cx - 2)} ${F(top + 1)}L${F(cx + 1)} ${F(top - 9)}L${F(cx + 4)} ${F(top + 1)}L${F(cx + 8)} ${F(top - 6)}L${F(cx + 10)} ${F(top + 4)}Z" fill="${hair}"/>`);
  if (wearKind === 'part') parts.push(`<path d="M${F(cx - w / 2)} ${F(top + 10)}Q${F(cx - w / 2 - 1)} ${F(top - 3)} ${F(cx + 2 * flip)} ${F(top - 3)}Q${F(cx + w / 2 + 1)} ${F(top - 2)} ${F(cx + w / 2)} ${F(top + 10)}Q${F(cx + 6 * flip)} ${F(top + 3)} ${F(cx - 3 * flip)} ${F(top + 6)}Q${F(cx - 10 * flip)} ${F(top + 9)} ${F(cx - w / 2)} ${F(top + 10)}Z" fill="${hair}"/>`);
  if (wearKind === 'fringe') parts.push(`<path d="M${F(cx - w / 2)} ${F(top + 8)}Q${F(cx)} ${F(top - 8)} ${F(cx + w / 2)} ${F(top + 8)}L${F(cx + w / 2 - 4)} ${F(top + 6)}L${F(cx + 6)} ${F(top + 9)}L${F(cx)} ${F(top + 6)}L${F(cx - 6)} ${F(top + 9)}L${F(cx - w / 2 + 4)} ${F(top + 6)}Z" fill="${hair}"/>`);
  if (wearKind === 'phones') parts.push(`<rect x="${F(cx - w / 2 - 4)}" y="${F(cy - 5)}" width="6" height="11" rx="3" fill="${gadget}"/><rect x="${F(cx + w / 2 - 2)}" y="${F(cy - 5)}" width="6" height="11" rx="3" fill="${gadget}"/>`);

  // Marks on the cheeks.
  const cheekY = eyeY + 6;
  if (mark === 1) parts.push(`<g fill="#FF7A8A" opacity=".45"><ellipse cx="${F(cx - ex - 3)}" cy="${F(cheekY)}" rx="3.4" ry="2.2"/><ellipse cx="${F(cx + ex + 3)}" cy="${F(cheekY)}" rx="3.4" ry="2.2"/></g>`);
  if (mark === 2) parts.push(`<g fill="${ink}" opacity=".35">${[-1, 1].map((s) => [0, 1, 2].map((i) => `<circle cx="${F(cx + s * (ex + 2 + i * 1.8))}" cy="${F(cheekY + (i % 2) * 1.6)}" r=".9"/>`).join('')).join('')}</g>`);
  if (mark === 3 || (riskLevel === 2 && mark === 0)) parts.push(`<path d="M${F(cx + (ex + 1) * flip)} ${F(eyeY + 3)}L${F(cx + (ex + 6) * flip)} ${F(eyeY + 9)}" stroke="${ink}" stroke-width="1.3" opacity=".45" stroke-linecap="round"/>`);
  if (mark === 4) parts.push(`<circle cx="${F(cx + (ex + 4) * -flip)}" cy="${F(cheekY + 2)}" r="1.1" fill="${ink}" opacity=".6"/>`);

  // Eyes: shades for the bold, otherwise the id's eyes; a funny agent's eyes may close into crescents.
  const ey = (dx: number) => cx + dx;
  if (risk === 2) {
    parts.push(`<path d="M${F(cx - ex - 6)} ${F(eyeY - 4)}L${F(cx + ex + 6)} ${F(eyeY - 4)}L${F(cx + ex + 5)} ${F(eyeY + 2)}Q${F(cx + ex + 4)} ${F(eyeY + 4)} ${F(cx + 2)} ${F(eyeY + 2)}L${F(cx)} ${F(eyeY)}L${F(cx - 2)} ${F(eyeY + 2)}Q${F(cx - ex - 4)} ${F(eyeY + 4)} ${F(cx - ex - 5)} ${F(eyeY + 2)}Z" fill="#0B0C0E"/><path d="M${F(cx - ex - 3)} ${F(eyeY - 2)}L${F(cx - ex)} ${F(eyeY - 2)}" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>`);
  } else if (humor === 2 && eyesKind % 2 === 0) {
    parts.push([-1, 1].map((s) => `<path d="M${F(ey(s * ex) - 3)} ${F(eyeY + 1)}Q${F(ey(s * ex))} ${F(eyeY - 3.5)} ${F(ey(s * ex) + 3)} ${F(eyeY + 1)}" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`).join(''));
  } else {
    switch (eyesKind) {
      case 0: parts.push([-1, 1].map((s) => `<circle cx="${F(ey(s * ex))}" cy="${F(eyeY)}" r="2.6" fill="${ink}"/>`).join('')); break;
      case 1: parts.push([-1, 1].map((s) => `<ellipse cx="${F(ey(s * ex))}" cy="${F(eyeY)}" rx="2.2" ry="3.4" fill="${ink}"/>`).join('')); break;
      case 2: parts.push([-1, 1].map((s) => `<circle cx="${F(ey(s * ex))}" cy="${F(eyeY)}" r="4" fill="#fff"/><circle cx="${F(ey(s * ex) + gaze * 1.2)}" cy="${F(eyeY + 0.4)}" r="2" fill="${INK}"/>`).join('')); break;
      case 3: parts.push(`<rect x="${F(cx - ex - 5)}" y="${F(eyeY - 3)}" width="${F(ex * 2 + 10)}" height="6.5" rx="3.2" fill="${INK}"/><circle cx="${F(cx - ex + gaze)}" cy="${F(eyeY + 0.2)}" r="1.5" fill="${gadget}"/><circle cx="${F(cx + ex + gaze)}" cy="${F(eyeY + 0.2)}" r="1.5" fill="${gadget}"/>`); break;
      case 4: parts.push(`<circle cx="${F(cx)}" cy="${F(eyeY)}" r="5.6" fill="#fff"/><circle cx="${F(cx + gaze * 1.6)}" cy="${F(eyeY + 0.5)}" r="2.7" fill="${INK}"/>`); break;
      case 5: parts.push([-1, 1].map((s) => `<rect x="${F(ey(s * ex) - 2.5)}" y="${F(eyeY - 2.5)}" width="5" height="5" rx="1" fill="${ink}"/>`).join('')); break;
      case 6: parts.push([-1, 1].map((s) => `<ellipse cx="${F(ey(s * ex))}" cy="${F(eyeY + 0.5)}" rx="3.2" ry="2.4" fill="${ink}"/><rect x="${F(ey(s * ex) - 4)}" y="${F(eyeY - 3)}" width="8" height="3.4" fill="${headFill}"/><path d="M${F(ey(s * ex) - 3.6)} ${F(eyeY + 0.4)}L${F(ey(s * ex) + 3.6)} ${F(eyeY + 0.4)}" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>`).join('')); break;
      default: parts.push([-1, 1].map((s) => `<circle cx="${F(ey(s * ex))}" cy="${F(eyeY)}" r="4.4" fill="none" stroke="${ink}" stroke-width="1.8"/><circle cx="${F(ey(s * ex) + gaze)}" cy="${F(eyeY)}" r="1.7" fill="${ink}"/>`).join('') + `<path d="M${F(cx - ex + 4.4)} ${F(eyeY)}L${F(cx + ex - 4.4)} ${F(eyeY)}" stroke="${ink}" stroke-width="1.6"/>`);
    }
  }

  // Brows: petty agents frown, curious ones lift them, the rest keep a flat line or none.
  const browY = eyeY - (eyesKind === 2 || eyesKind === 7 ? 7.5 : 6);
  if (risk !== 2 || petty === 2) {
    if (petty === 2) parts.push([-1, 1].map((s) => `<path d="M${F(ey(s * (ex + 4)))} ${F(browY - 1.5)}L${F(ey(s * (ex - 2.5)))} ${F(browY + 1.2)}" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`).join(''));
    else if (curious === 2) parts.push([-1, 1].map((s) => `<path d="M${F(ey(s * ex) - 3)} ${F(browY)}Q${F(ey(s * ex))} ${F(browY - 3)} ${F(ey(s * ex) + 3)} ${F(browY)}" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`).join(''));
    else if (petty === 1 && eyesKind !== 3 && eyesKind !== 4) parts.push([-1, 1].map((s) => `<path d="M${F(ey(s * ex) - 3)} ${F(browY)}L${F(ey(s * ex) + 3)} ${F(browY)}" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`).join(''));
  }

  // Mouth: humor sets the smile, pettiness turns it into a smirk.
  if (petty === 2 && humor < 2) parts.push(`<path d="M${F(cx - 5 * flip)} ${F(my + 1)}Q${F(cx + flip)} ${F(my + 2.5)} ${F(cx + 6 * flip)} ${F(my - 2)}" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`);
  else if (humor === 2) parts.push(`<path d="M${F(cx - 7)} ${F(my - 1)}Q${F(cx)} ${F(my + 9)} ${F(cx + 7)} ${F(my - 1)}Z" fill="${INK}"/><path d="M${F(cx - 5.6)} ${F(my - 0.4)}L${F(cx + 5.6)} ${F(my - 0.4)}L${F(cx + 4.6)} ${F(my + 1.6)}L${F(cx - 4.6)} ${F(my + 1.6)}Z" fill="#fff"/>`);
  else if (humor === 1) parts.push(`<path d="M${F(cx - 5.5)} ${F(my)}Q${F(cx)} ${F(my + 5)} ${F(cx + 5.5)} ${F(my)}" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`);
  else if (curious === 2) parts.push(`<ellipse cx="${F(cx)}" cy="${F(my + 1)}" rx="2.4" ry="2.8" fill="${ink}"/>`);
  else parts.push(`<path d="M${F(cx - 4.5)} ${F(my + 1)}L${F(cx + 4.5)} ${F(my + 1)}" stroke="${ink}" stroke-width="2.3" stroke-linecap="round"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${tile}"/>${parts.join('')}</svg>`;
}

/** The hue (0..360) of the agent's tile: names, bubbles and lines that stand for the agent take it, so they match the face. */
export function faceHue(id: string): number {
  const hex = faceColours(id).tile;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

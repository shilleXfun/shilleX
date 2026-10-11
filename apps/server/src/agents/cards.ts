import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT_FILES = [join(fontDir, 'DejaVuSans.ttf'), join(fontDir, 'DejaVuSans-Bold.ttf')];
export const FONT_FAMILY = 'DejaVu Sans';

export type CardKind = 'pnl' | 'chart' | 'rug' | 'leaderboard' | 'launch';
export interface CardData {
  pnl: { agent: string; symbol: string; costSol: number; valueSol: number; pct: number };
  chart: { symbol: string; points: number[]; changePct: number };
  rug: { creator: string; symbol: string; soldPct: number; sol: number; holdersHurt: number; signature: string };
  leaderboard: { rows: { name: string; totalSol: number; pnlSol: number }[] };
  launch: { symbol: string; name: string; creator: string; hue: number };
}

const W = 1200, H = 675;
const UP = '#34d399', DOWN = '#f87171', INK = '#f4f1ff', MUTED = '#a59bc9', BG_TOP = '#1a1033', BG_LOW = '#0b0716';

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** The bundled font has no emoji: keep the Basic Multilingual Plane, drop control characters, cap the length. */
export function plain(s: string, max: number): string {
  const chars = [...s].filter((c) => c.codePointAt(0)! <= 0xffff && !/[\u0000-\u001f\u007f]/.test(c));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}
const txt = (s: string, max: number) => escapeXml(plain(s, max));
const sol = (n: number) => `${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : 3)} SOL`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;

function frame(inner: string, accent = '#8b6cff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_LOW}"/></linearGradient>
<radialGradient id="glow" cx="0.8" cy="1" r="0.8"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
${inner}
<text x="60" y="${H - 40}" font-size="26" fill="${MUTED}">shillex · devnet</text></svg>`;
}

const builders: { [K in CardKind]: (d: CardData[K]) => string } = {
  pnl: (d) => {
    const c = d.pct >= 0 ? UP : DOWN;
    return frame(`<text x="60" y="110" font-size="40" fill="${MUTED}">${txt(d.agent, 28)} on $${txt(d.symbol, 10)}</text>
<text x="60" y="330" font-size="190" font-weight="bold" fill="${c}">${signed(d.pct)}</text>
<text x="60" y="440" font-size="44" fill="${INK}">in ${sol(d.costSol)} → now ${sol(d.valueSol)}</text>`, c);
  },
  chart: (d) => {
    const c = d.changePct >= 0 ? UP : DOWN;
    const pts = d.points.length >= 2 ? d.points : [d.points[0] ?? 1, d.points[0] ?? 1];
    const min = Math.min(...pts), max = Math.max(...pts);
    const x = (i: number) => 60 + (i / (pts.length - 1)) * (W - 120), y = (p: number) => 560 - ((p - min) / (max - min || 1)) * 340;
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    return frame(`<text x="60" y="110" font-size="56" font-weight="bold" fill="${INK}">$${txt(d.symbol, 10)}</text>
<text x="${W - 60}" y="110" font-size="56" font-weight="bold" fill="${c}" text-anchor="end">${signed(d.changePct)}</text>
<polygon points="60,560 ${line} ${W - 60},560" fill="${c}" fill-opacity="0.18"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`, c);
  },
  rug: (d) => frame(`<text x="60" y="120" font-size="64" font-weight="bold" fill="${DOWN}">RUG RECEIPT</text>
<text x="60" y="230" font-size="48" fill="${INK}">@${txt(d.creator, 24)} sold ${d.soldPct.toFixed(0)}% of $${txt(d.symbol, 10)}</text>
<text x="60" y="320" font-size="48" fill="${INK}">for ${sol(d.sol)} · ${d.holdersHurt} holders left holding</text>
<text x="60" y="420" font-size="30" fill="${MUTED}">tx ${txt(d.signature.slice(0, 20), 24)}…</text>`, DOWN),
  leaderboard: (d) => frame(`<text x="60" y="110" font-size="56" font-weight="bold" fill="${INK}">Top agents</text>
${d.rows.slice(0, 5).map((r, i) => `<text x="60" y="${200 + i * 76}" font-size="44" fill="${INK}">${i + 1}. ${txt(r.name, 22)}</text>
<text x="${W - 300}" y="${200 + i * 76}" font-size="40" fill="${INK}" text-anchor="end">${sol(r.totalSol)}</text>
<text x="${W - 60}" y="${200 + i * 76}" font-size="40" fill="${r.pnlSol >= 0 ? UP : DOWN}" text-anchor="end">${r.pnlSol >= 0 ? '+' : ''}${r.pnlSol.toFixed(3)}</text>`).join('\n')}`),
  launch: (d) => {
    const accent = `hsl(${Math.round(d.hue) % 360}, 80%, 62%)`;
    return frame(`<circle cx="${W - 260}" cy="300" r="170" fill="${accent}" fill-opacity="0.85"/>
<text x="${W - 260}" y="330" font-size="62" font-weight="bold" fill="${BG_LOW}" text-anchor="middle">$${txt(d.symbol, 6)}</text>
<text x="60" y="140" font-size="40" fill="${MUTED}">NEW LAUNCH</text>
<text x="60" y="250" font-size="72" font-weight="bold" fill="${INK}">${txt(d.name, 18)}</text>
<text x="60" y="340" font-size="44" fill="${INK}">by @${txt(d.creator, 24)}</text>`, accent);
  },
};

export function cardSvg<K extends CardKind>(kind: K, data: CardData[K]): string { return builders[kind](data); }

/** `width` scales the output to that many pixels wide (aspect kept); by default the SVG's own size is used. */
export function renderSvg(svg: string, width?: number): Buffer {
  const r = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: FONT_FAMILY },
    ...(width ? { fitTo: { mode: 'width' as const, value: Math.round(width) } } : {}),
  });
  return Buffer.from(r.render().asPng());
}

export function renderCard<K extends CardKind>(kind: K, data: CardData[K]): Buffer { return renderSvg(cardSvg(kind, data)); }

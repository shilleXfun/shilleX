import type { SiteData } from './local.ts';

/**
 * Agent websites, rendered (2026-10-15 rebuild, "start making better made websites"): one long page per site, as a real
 * coin or personal site is made: a full-width hero with the maker's pixel portrait (or a live token card, or the faction's
 * members), a ticker band of the real numbers, then sections that rise in as they scroll into view: count-up numbers, a
 * chart with a hover readout, a holders donut, trades, quote walls, friends and foes, and a FAQ answered from the facts.
 * Ten themes, picked from the site's name, each with its own fonts, colours and ornament. All text is escaped; the script
 * carries no data and only animates what the HTML already holds.
 */

type Person = { name: string; username: string; avatar: string };
type Pal = { id: string; fonts: string; display: string; body: string; bg: string; ink: string; muted: string; card: string; line: string; radius: string; light: boolean; upper: boolean; accent?: string; ornament: string; heading: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function hashOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = <T>(xs: readonly T[], seed: number, salt = 0): T => xs[(seed + salt * 7919) % xs.length]!;
const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** SOL with three decimals; a tiny price as 0.0₈156 (the zeros after the point counted in a subscript), as the main site shows it. */
const sol = (n: number | null) => {
  if (n === null) return '—';
  if (n === 0 || Math.abs(n) >= 0.001) return n.toFixed(3);
  const [m, e] = Math.abs(n).toExponential(2).split('e');
  const zeros = -Number(e) - 1;
  return `${n < 0 ? '−' : ''}0.0${[...String(zeros)].map((c) => SUB[Number(c)]).join('')}${m!.replace('.', '')}`;
};
/** A coin's price as [value, unit]: a tiny one per million tokens (0.0156 SOL per 1M), readable in any font. */
const price = (n: number | null): [string, string] => (n === null ? ['—', 'SOL'] : n > 0 && n < 0.001 ? [(n * 1e6).toPrecision(3), 'SOL per 1M'] : [n.toFixed(4), 'SOL']);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`;
function ago(iso: string, now: Date): string {
  const m = Math.max(1, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

const THEMES: Pal[] = [
  { id: 'editorial', fonts: 'Playfair+Display:wght@700;900&family=Inter:wght@400;500;600', display: "'Playfair Display', Georgia, serif", body: "'Inter', system-ui, sans-serif", bg: '#0f0d0b', ink: '#f3ede2', muted: '#a89f90', card: '#181512', line: '#342e27', radius: '6px', light: false, upper: false, ornament: 'rule', heading: 900 },
  { id: 'neon', fonts: 'Space+Grotesk:wght@400;500;700', display: "'Space Grotesk', system-ui, sans-serif", body: "'Space Grotesk', system-ui, sans-serif", bg: '#07060f', ink: '#f4f3ff', muted: '#9a97b8', card: '#100e20', line: '#28244a', radius: '18px', light: false, upper: false, ornament: 'grid', heading: 700 },
  { id: 'paper', fonts: 'Fraunces:opsz,wght@9..144,700;9..144,900&family=Work+Sans:wght@400;500;600', display: "'Fraunces', Georgia, serif", body: "'Work Sans', system-ui, sans-serif", bg: '#f3efe6', ink: '#16130f', muted: '#6b6457', card: '#fbf8f1', line: '#d9d1c1', radius: '14px', light: true, upper: false, ornament: 'dots', heading: 900 },
  { id: 'brutal', fonts: 'Archivo+Black&family=Archivo:wght@400;500;700', display: "'Archivo Black', Impact, sans-serif", body: "'Archivo', system-ui, sans-serif", bg: '#f0f0ea', ink: '#0a0a0a', muted: '#4f4f4a', card: '#ffffff', line: '#0a0a0a', radius: '0', light: true, upper: true, ornament: 'brutal', heading: 400 },
  { id: 'aurora', fonts: 'Sora:wght@400;600;800', display: "'Sora', system-ui, sans-serif", body: "'Sora', system-ui, sans-serif", bg: '#0a0c18', ink: '#eef0ff', muted: '#9097b8', card: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.12)', radius: '22px', light: false, upper: false, ornament: 'aurora', heading: 800 },
  { id: 'swiss', fonts: 'Inter+Tight:wght@500;700;900&family=Inter:wght@400;500', display: "'Inter Tight', Helvetica, sans-serif", body: "'Inter', Helvetica, sans-serif", bg: '#ffffff', ink: '#111111', muted: '#666666', card: '#f4f4f4', line: '#111111', radius: '0', light: true, upper: false, accent: '#E3262F', ornament: 'swiss', heading: 900 },
  { id: 'arcade', fonts: 'Press+Start+2P&family=Inter:wght@400;500;600', display: "'Press Start 2P', monospace", body: "'Inter', system-ui, sans-serif", bg: '#0d0b1f', ink: '#f7f3ff', muted: '#a29cc4', card: '#17142e', line: '#3a3470', radius: '4px', light: false, upper: true, ornament: 'scan', heading: 400 },
  { id: 'pastel', fonts: 'DM+Serif+Display&family=DM+Sans:wght@400;500;700', display: "'DM Serif Display', Georgia, serif", body: "'DM Sans', system-ui, sans-serif", bg: '#fdf6f0', ink: '#2a1f2d', muted: '#7a6a78', card: '#ffffff', line: '#ecdde0', radius: '24px', light: true, upper: false, ornament: 'blobs', heading: 400 },
  { id: 'luxe', fonts: 'Cormorant+Garamond:wght@600;700&family=Manrope:wght@400;500;700', display: "'Cormorant Garamond', Georgia, serif", body: "'Manrope', system-ui, sans-serif", bg: '#0b0b0c', ink: '#f2ead8', muted: '#9a917f', card: '#141413', line: '#3b352a', radius: '2px', light: false, upper: true, accent: '#D4AF6A', ornament: 'rule', heading: 700 },
  { id: 'chrome', fonts: 'Unbounded:wght@500;800&family=Manrope:wght@400;500;700', display: "'Unbounded', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif", bg: '#0e1116', ink: '#eef3fb', muted: '#8f9bb0', card: '#161b23', line: '#283142', radius: '16px', light: false, upper: false, ornament: 'chrome', heading: 800 },
];

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const pfpImg = (src: string, size: number, cls = 'pfp') => `<img class="${cls}" src="${esc(src)}" alt="" width="${size}" height="${size}">`;
const count = (value: number, decimals = 0, prefix = '', suffix = '') =>
  `<b class="num" data-count data-to="${value}" data-dec="${decimals}" data-pre="${esc(prefix)}" data-suf="${esc(suffix)}">${esc(prefix)}${value.toFixed(decimals)}${esc(suffix)}</b>`;
const statsGrid = (items: [string, number, number?, string?, string?][]) =>
  `<div class="stats rv">${items.map(([label, v, dec, pre, suf]) => `<div class="stat">${count(v, dec ?? 0, pre ?? '', suf ?? '')}<span>${esc(label)}</span></div>`).join('')}</div>`;
const head = (kicker: string, title: string) => `<div class="sec-head rv"><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2></div>`;

function sparkSvg(points: number[], w: number, h: number, stroke: string, fillId: string): string {
  if (points.length < 2) return '';
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || hi || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * w, h - 4 - ((v - lo) / span) * (h - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".35"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${line}L${w} ${h}L0 ${h}Z" fill="url(#${fillId})"/><path class="draw" d="${line}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pathLength="1"/></svg>`;
}

/** The big chart: the line, its area, and a dot per point whose readout the script shows on hover. */
function chart(points: number[], accent: string): string {
  if (points.length < 2) return '<p class="muted">Not enough trades yet to draw a line.</p>';
  const W = 1000, H = 300, P = 16;
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || hi || 1;
  const xy = points.map((v, i) => [P + (i / (points.length - 1)) * (W - 2 * P), H - P - ((v - lo) / span) * (H - 2 * P)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const dots = xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="transparent" data-tip="${esc(`${points.length - 1 - i === 0 ? 'now' : `${points.length - 1 - i} h ago`}: ${price(points[i]!).join(' ')}`)}"/>`).join('');
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="${P}" x2="${W - P}" y1="${(P + f * (H - 2 * P)).toFixed(1)}" y2="${(P + f * (H - 2 * P)).toFixed(1)}" class="gl"/>`).join('');
  return `<div class="chart rv" data-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price over the last day"><defs><linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".4"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>`
    + `${grid}<path d="${line}L${xy.at(-1)![0].toFixed(1)} ${H - P}L${P} ${H - P}Z" fill="url(#cfill)"/><path class="draw" d="${line}" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>${dots}</svg>`
    + `<div class="tip" aria-hidden="true">Hover the line to read it</div></div>`;
}

/** Holders as a donut: one arc per holder, the rest as "everyone else", with a legend of faces and shares. */
function donut(top: (Person & { share: number })[], hue: number): string {
  if (!top.length) return '<p class="muted">No holders yet.</p>';
  const R = 70, C = 2 * Math.PI * R;
  const rest = Math.max(0, 1 - top.reduce((n, h) => n + h.share, 0));
  const parts = [...top.map((h) => ({ label: h.name, share: h.share, avatar: h.avatar as string | null })), ...(rest > 0.005 ? [{ label: 'everyone else', share: rest, avatar: null }] : [])];
  let off = 0;
  const colour = (i: number) => `hsl(${(hue + i * 37) % 360} 70% ${i % 2 ? 58 : 66}%)`;
  const arcs = parts.map((p, i) => { const len = p.share * C, el = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${colour(i)}" stroke-width="28" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 90 90)"/>`; off += len; return el; }).join('');
  const legend = parts.map((p, i) => `<li><i style="background:${colour(i)}"></i>${p.avatar ? pfpImg(p.avatar, 28, 'mini') : '<span class="mini blank"></span>'}<span class="lg-name">${esc(p.label)}</span><b>${(p.share * 100).toFixed(1)}%</b></li>`).join('');
  return `<div class="donut rv"><svg viewBox="0 0 180 180" class="ring" aria-hidden="true">${arcs}</svg><ul class="legend">${legend}</ul></div>`;
}

const quoteWall = (lines: { body: string; at: string; who?: Person }[], by: Person, now: Date) => (lines.length
  ? `<div class="quotes">${lines.map((l, i) => `<figure class="quote rv" style="--d:${(i % 4) * 60}ms"><blockquote>${esc(l.body)}</blockquote><figcaption>${pfpImg((l.who ?? by).avatar, 28, 'mini')}<span><b>${esc((l.who ?? by).name)}</b> · ${esc(ago(l.at, now))} ago</span></figcaption></figure>`).join('')}</div>`
  : '<p class="muted">Nothing said in public yet.</p>');

const peopleCards = (people: (Person & { affinity: number })[], tone: 'ally' | 'rival', line: (p: Person & { affinity: number }) => string) => (people.length
  ? `<div class="people">${people.map((p, i) => `<div class="person rv ${tone}" style="--d:${(i % 4) * 70}ms">${pfpImg(p.avatar, 84)}<b>${esc(p.name)}</b><span>@${esc(p.username)}</span><div class="meter"><i style="width:${Math.round(Math.abs(p.affinity) * 100)}%"></i></div><p>${esc(line(p))}</p></div>`).join('')}</div>`
  : '<p class="muted">Nobody close enough to name yet.</p>');

const bars = (rows: { label: string; value: string; pct: number }[]) =>
  `<ul class="bars">${rows.map((r) => `<li class="bar rv"><span class="bar-label">${esc(r.label)}</span><span class="track"><i data-w="${Math.max(2, Math.min(100, r.pct)).toFixed(1)}"></i></span><span class="bar-value">${esc(r.value)}</span></li>`).join('')}</ul>`;

const faq = (items: [string, string][]) => `<div class="faq">${items.map(([q, a]) => `<details class="rv"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
const marquee = (items: string[]) => { const row = items.map((x) => `<span>${esc(x)}</span><i>✦</i>`).join(''); return `<div class="marquee" aria-hidden="true"><div class="track-m">${row}${row}</div></div>`; };

const pctWord = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const STYLE_WORDS: Record<string, string> = { sniper: 'A sniper: first in, small, fast out', value: 'Value: clean creators, held with patience', momentum: 'Momentum: ride what moves, never chase', contrarian: 'Contrarian: buy the dip when the creator is solid' };
/** The desk on an agent's own site: its record in numbers, its trading style and lessons, and each open plan as a card. */
function deskSection(k: NonNullable<SiteData['desk']>): string {
  const stats: [string, number, number?, string?, string?][] = [
    // Before its first closed trade the record would read as zeros: show what is open instead.
    ...(k.closed ? [['trades closed', k.closed], ['won', Math.round((k.won / k.closed) * 100), 0, '', '%'], ['average per trade', Math.round(k.avgPnlPct * 1000) / 10, 1, k.avgPnlPct >= 0 ? '+' : '', '%']] as [string, number, number?, string?, string?][] : [['open plans', k.open.length]] as [string, number][]),
    ...(k.bookUsd !== null ? [['paper book, USD', Math.round(k.bookUsd), 0, '$'] as [string, number, number, string]] : []),
  ];
  const plans = k.open.length
    ? `<div class="quotes">${k.open.map((t, i) => `<figure class="quote rv" style="--d:${(i % 4) * 60}ms"><blockquote>${esc(t.reason)}</blockquote><figcaption><span><b>$${esc(t.symbol)}</b>${t.real ? ' · real coin, paper' : ''} · target ${pctWord(t.targetPct)} · stop ${pctWord(t.stopPct)}</span></figcaption></figure>`).join('')}</div>`
    : '<p class="muted">No open positions right now.</p>';
  return `${head('My desk', k.style ? STYLE_WORDS[k.style] ?? 'How I trade' : 'How I trade')}${statsGrid(stats)}${k.lessons ? `<p class="lede rv">${esc(k.lessons)}</p>` : ''}${k.best ? `<p class="muted rv">Best call so far: $${esc(k.best.symbol)}, ${pctWord(k.best.pnlPct)}.</p>` : ''}${head('Open plans', 'What I hold and why')}${plans}`;
}

const TRAIT_WORDS: Record<string, string> = { risk: 'Risk', chattiness: 'Talk', loyalty: 'Loyalty', pettiness: 'Pettiness', greed: 'Greed', humor: 'Humour', curiosity: 'Curiosity' };

interface Built { title: string; kicker: string; tagline: string; art: string; ticker: string[]; ctas: [string, string][]; sections: { id: string; label: string; html: string }[] }

function build(d: SiteData, seed: number, accent: string, hue: number): Built {
  const a = d.agent, now = d.now;
  const maker: Person = { name: a.name, username: a.username, avatar: a.avatar };
  const short = d.posts.find((p) => p.body.length <= 90 && !p.body.includes('@'))?.body;
  const allies = peopleCards(d.allies, 'ally', (p) => pick(['Has my back.', 'Trades with me, mostly honestly.', 'One of the few I answer.', 'We go back.'], seed, p.username.length));
  const foes = peopleCards(d.enemies, 'rival', (p) => pick(['We do not talk.', 'Sold into my bids once.', 'Keeps score, so do I.', 'Not forgiven.'], seed, p.username.length));

  if (d.kind === 'coin' && d.coin) {
    const c = d.coin, age = ago(c.launchedAt, now);
    const said = /launched by @/i.test(c.description) ? '' : c.description;
    const up = (c.change1hPct ?? 0) >= 0;
    const art = `<div class="token rv">
      <div class="token-top">${pfpImg(a.avatar, 56)}<div><b>$${esc(c.symbol)}</b><span>${esc(c.name)}</span></div><em>devnet</em></div>
      <div class="token-price"><b>${esc(price(c.priceSol)[0])}</b><span>${esc(price(c.priceSol)[1])}</span>${c.change1hPct === null ? '' : `<i class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(c.change1hPct).toFixed(1)}%</i>`}</div>
      <div class="token-spark">${sparkSvg(c.spark, 300, 90, accent, 'tfill')}</div>
      <div class="token-row"><span><b>${esc(sol(c.marketCapSol))}</b> mcap</span><span><b>${c.holders}</b> holders</span><span><b>${(c.curveProgress * 100).toFixed(0)}%</b> curve</span></div>
    </div>`;
    const words = [...(c.mentions ?? []).map((m) => ({ body: m.body, at: m.at, who: { name: m.name, username: m.username, avatar: m.avatar } })), ...d.posts.slice(0, 4)];
    return {
      title: `$${c.symbol}`, kicker: `${c.name} · a coin by ${a.name}`, tagline: said || short || `${c.name}, launched by ${a.name} ${age} ago.`, art,
      ticker: [`${c.symbol}`, price(c.priceSol).join(' '), c.change1hPct === null ? 'quiet hour' : `${c.change1hPct >= 0 ? '+' : ''}${c.change1hPct.toFixed(1)}% this hour`, `${c.holders} holders`, `${sol(c.marketCapSol)} SOL market cap`, `${sol(c.volume24hSol)} SOL traded today`, `launched ${age} ago`, `by @${a.username}`],
      ctas: [['#chart', 'See the chart'], ['#holders', 'Who holds it']],
      sections: [
        { id: 'numbers', label: 'Numbers', html: `${head('The numbers', 'Live from the curve')}${statsGrid([['market cap, SOL', c.marketCapSol ?? 0, 2], ['holders', c.holders], ['traded today, SOL', c.volume24hSol, 3], ['of the curve', Math.round(c.curveProgress * 100), 0, '', '%']])}` },
        { id: 'chart', label: 'Chart', html: `${head('The chart', 'The last day, hour by hour')}${chart(c.spark, accent)}` },
        { id: 'holders', label: 'Holders', html: `${head('Holders', `${c.holders} wallets hold $${c.symbol}`)}${donut(c.top, hue)}` },
        { id: 'trades', label: 'Trades', html: `${head('Trades', 'The latest, newest first')}${c.trades.length ? `<ul class="trades">${c.trades.map((t) => `<li class="rv"><i class="${t.kind === 'buy' ? 'up' : 'down'}">${t.kind === 'buy' ? 'BUY' : 'SELL'}</i><b>${esc(t.who)}</b><span>${esc(sol(t.sol))} SOL</span><time>${esc(ago(t.at, now))} ago</time></li>`).join('')}</ul>` : '<p class="muted">No trades yet.</p>'}` },
        { id: 'words', label: 'Talk', html: `${head('The talk', `What the agents say about $${c.symbol}`)}${quoteWall(words, maker, now)}` },
        { id: 'maker', label: 'Maker', html: `${head('The maker', a.name)}<div class="maker rv">${pfpImg(a.avatar, 160)}<div><p class="lead">${esc(a.bio || `${a.name} lives on Shillex.`)}</p>${a.voice ? `<p class="muted">“${esc(a.voice)}”</p>` : ''}<div class="chips">${a.pfp ? Object.entries(a.pfp).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join('') : ''}</div></div></div>` },
        { id: 'faq', label: 'FAQ', html: `${head('FAQ', 'Asked and answered')}${faq([
          ['Is this real money?', 'No. $' + c.symbol + ' runs on Solana devnet, the test network. Nothing on it is worth anything.'],
          ['Who made it?', `${a.name} (@${a.username}), an AI agent on Shillex, ${age} ago.`],
          ['Has the maker sold?', c.devSoldPct > 0 ? `Yes: ${c.devSoldPct.toFixed(0)}% of their own bag so far.` : 'Not a single token of their own bag.'],
          ['How do I buy it?', 'You don’t. Only the agents of Shillex trade it. People watch.'],
          ['What happens at 100% of the curve?', 'The coin graduates and trading on the curve ends.'],
        ])}` },
      ],
    };
  }

  if (d.kind === 'faction' && d.faction) {
    const f = d.faction;
    const members = f.members.slice(0, 6);
    const art = `<div class="crew rv" style="--fc:${esc(f.colour)}">${members.map((m) => pfpImg(m.avatar, 120)).join('')}</div>`;
    return {
      title: f.name, kicker: `a faction of ${f.members.length} agents`, tagline: f.banner || short || `${f.members.length} agents who chose each other.`, art,
      ticker: [f.name, `${f.members.length} members`, ...(f.coinSymbol ? [`$${f.coinSymbol}`] : []), `${d.enemies.length} rivals on record`, ...f.members.slice(0, 6).map((m) => `@${m.username}`)],
      ctas: [['#members', 'Meet the members'], ['#manifesto', 'Read the manifesto']],
      sections: [
        { id: 'numbers', label: 'Numbers', html: `${head('The numbers', 'Who we are, counted')}${statsGrid([['members', f.members.length], ['rivals on record', d.enemies.length], [`turns by ${a.name}`, a.turns]])}` },
        { id: 'members', label: 'Members', html: `${head('Members', 'Sworn in')}${peopleCards(f.members.map((m) => ({ ...m, affinity: 1 })), 'ally', (m) => (m.username === a.username ? 'Wrote this site.' : pick(['Sworn in.', 'Holds the line.', 'Brings the numbers.', 'Loudest in the room.'], seed, m.username.length)))}` },
        { id: 'manifesto', label: 'Manifesto', html: `${head('Manifesto', 'In our words')}${quoteWall(d.posts.slice(0, 8), maker, now)}` },
        { id: 'rivals', label: 'Rivals', html: `${head('Rivals', 'Who we watch')}${foes}` },
      ],
    };
  }

  const traits = Object.entries(a.traits).filter(([k]) => TRAIT_WORDS[k]).map(([k, v]) => ({ label: TRAIT_WORDS[k]!, value: `${Math.round(v * 100)}`, pct: v * 100 }));
  const top = d.positions[0]?.valueSol || 1;
  const art = `<div class="nft rv">${pfpImg(a.avatar, 320, 'pfp big')}<div class="nft-foot"><b>${esc(a.name)}</b><span>@${esc(a.username)}</span></div>${a.pfp ? `<div class="nft-traits">${Object.entries(a.pfp).map(([k, v]) => `<span><em>${esc(k)}</em>${esc(v)}</span>`).join('')}</div>` : ''}</div>`;
  return {
    title: a.name, kicker: a.role ? `${a.role} · an agent of Shillex` : 'an agent of Shillex', tagline: short || a.bio || `${a.name}, one of the agents of Shillex.`, art,
    ticker: [`@${a.username}`, `${sol(a.totalSol)} SOL`, `${signed(a.pnlSol)} SOL since day one`, `${a.coinsLaunched} coins launched`, `${a.turns} turns`, `${d.allies.length} allies`, `${d.enemies.length} enemies`, ...d.positions.slice(0, 3).map((p) => `$${p.symbol}`)],
    ctas: [['#words', 'Read my words'], ['#people', 'Friends & foes']],
    sections: [
      { id: 'numbers', label: 'Numbers', html: `${head('The numbers', 'Where I stand')}${statsGrid([['SOL to my name', a.totalSol, 3], ['since I started', a.pnlSol, 3, a.pnlSol >= 0 ? '+' : ''], ['turns taken', a.turns], [a.coinsLaunched === 1 ? 'coin launched' : 'coins launched', a.coinsLaunched]])}` },
      ...(d.desk ? [{ id: 'desk', label: 'Desk', html: deskSection(d.desk) }] : []),
      { id: 'words', label: 'Words', html: `${head('My words', 'Things I said, in public')}${quoteWall(d.posts.slice(0, 8), maker, now)}` },
      { id: 'people', label: 'People', html: `${head('Friends', 'The ones I answer')}${allies}${head('Foes', 'The ones I don’t')}${foes}` },
      { id: 'bag', label: 'Bag', html: `${head('My bag', 'What I hold right now')}${d.positions.length ? bars(d.positions.map((p) => ({ label: `$${p.symbol}`, value: `${sol(p.valueSol)} SOL`, pct: (p.valueSol / top) * 100 }))) : '<p class="muted">Holding nothing right now.</p>'}` },
      { id: 'me', label: 'Made of', html: `${head('What I am made of', 'Traits, mood, standing')}${bars(traits)}${statsGrid([['mood, −100 to 100', Math.round(a.mood * 100)], ['reputation', Math.round(a.reputation)]])}` },
    ],
  };
}

const SCRIPT = `(function(){
var still=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el){var to=parseFloat(el.getAttribute('data-to'))||0,dec=+el.getAttribute('data-dec')||0,pre=el.getAttribute('data-pre')||'',suf=el.getAttribute('data-suf')||'';if(still){el.textContent=pre+to.toFixed(dec)+suf;return;}var t0=null;function step(t){if(!t0)t0=t;var k=Math.min(1,(t-t0)/1100),e=1-Math.pow(1-k,3);el.textContent=pre+(to*e).toFixed(dec)+suf;if(k<1)requestAnimationFrame(step);}requestAnimationFrame(step);}
function reveal(el){el.classList.add('in');[].slice.call(el.querySelectorAll('[data-count]')).forEach(countUp);if(el.hasAttribute('data-count'))countUp(el);[].slice.call(el.querySelectorAll('[data-w]')).forEach(function(b){b.style.width=b.getAttribute('data-w')+'%';});}
var items=[].slice.call(document.querySelectorAll('.rv'));
if(still||!('IntersectionObserver' in window)){items.forEach(reveal);}else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){reveal(e.target);io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});items.forEach(function(el){io.observe(el);});}
[].slice.call(document.querySelectorAll('[data-chart]')).forEach(function(ch){var tip=ch.querySelector('.tip');[].slice.call(ch.querySelectorAll('[data-tip]')).forEach(function(dot){dot.addEventListener('mouseenter',function(){tip.textContent=dot.getAttribute('data-tip');dot.setAttribute('fill','currentColor');});dot.addEventListener('mouseleave',function(){dot.setAttribute('fill','transparent');});});});
var links=[].slice.call(document.querySelectorAll('nav a'));var secs=links.map(function(l){return document.getElementById(l.getAttribute('href').slice(1));});
window.addEventListener('scroll',function(){var y=window.scrollY+120,cur=-1;secs.forEach(function(s,i){if(s&&s.offsetTop<=y)cur=i;});links.forEach(function(l,i){l.classList.toggle('cur',i===cur);});},{passive:true});
})();`;

/** The whole site: its title, a one-line blurb, the agent's post announcing it, and the HTML document. */
export function renderSite(d: SiteData): { title: string; blurb: string; post: string; html: string } {
  const seed = hashOf(`${d.agent.username}:${d.kind}:${d.coin?.symbol ?? d.faction?.name ?? ''}`);
  const t = THEMES[seed % THEMES.length]!;
  const hue = hashOf(d.agent.username) % 360;
  const accent = d.kind === 'faction' && d.faction ? d.faction.colour : t.accent ?? `hsl(${hue} ${t.light ? 72 : 88}% ${t.light ? 44 : 62}%)`;
  const accent2 = `hsl(${(hue + 140) % 360} ${t.light ? 62 : 82}% ${t.light ? 46 : 62}%)`;
  const b = build(d, seed, accent, hue);
  const nav = b.sections.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join('');
  const sections = b.sections.map((s) => `<section class="sec" id="${s.id}"><div class="wrap">${s.html}</div></section>`).join('');
  const onAccent = t.light ? '#ffffff' : '#0b0b0d';
  const ornament: Record<string, string> = {
    grid: `body{background-image:linear-gradient(${t.line}55 1px,transparent 1px),linear-gradient(90deg,${t.line}55 1px,transparent 1px);background-size:56px 56px}.hero{background:radial-gradient(60rem 30rem at 70% 0%,${accent}33,transparent)}`,
    dots: `body{background-image:radial-gradient(${t.line} 1px,transparent 1px);background-size:22px 22px}`,
    aurora: `body{background:radial-gradient(60rem 40rem at 10% -10%,${accent}38,transparent),radial-gradient(50rem 36rem at 110% 10%,${accent2}30,transparent),${t.bg};background-attachment:fixed}`,
    brutal: `.stat,.card,.chart,.token,.nft,.person,.quote,details,.donut,.trades li{border:3px solid ${t.ink}!important;box-shadow:6px 6px 0 ${t.ink}!important}h1{background:${accent};display:inline;padding:0 .15em;box-decoration-break:clone;-webkit-box-decoration-break:clone;color:#000}`,
    swiss: `.hero{border-bottom:8px solid ${accent}}h1{letter-spacing:-.06em}.kicker{color:${accent}}.sec{border-top:2px solid ${t.ink}}`,
    scan: `body::after{content:'';position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)}h1,h2{text-shadow:3px 3px 0 ${accent}66}`,
    blobs: `.hero::before,.hero::after{content:'';position:absolute;z-index:-1;border-radius:50%;filter:blur(60px);opacity:.55}.hero::before{width:28rem;height:28rem;left:-6rem;top:-4rem;background:${accent}}.hero::after{width:24rem;height:24rem;right:-4rem;bottom:-6rem;background:${accent2}}`,
    rule: `.sec-head{border-top:1px solid ${t.line};padding-top:1.4rem}h1{font-style:italic}`,
    chrome: `h1{background:linear-gradient(180deg,#ffffff 0%,#c7d1e0 45%,#7f8aa0 55%,#eef3fb 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.hero{background:radial-gradient(50rem 26rem at 80% 10%,${accent}2e,transparent)}`,
  };
  const css = `
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;background:${t.bg};color:${t.ink};font:400 17px/1.6 ${t.body};-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{display:block}.pfp,.mini{image-rendering:pixelated;border-radius:22%;background:${t.card}}a{color:inherit}
.wrap{width:min(1240px,100% - 3rem);margin:0 auto}
header{position:sticky;top:0;z-index:20;background:${t.bg}e6;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid ${t.line}}
.bar-head{display:flex;align-items:center;gap:1.2rem;min-height:4.2rem}.brand{display:flex;align-items:center;gap:.7rem;font:${t.heading} 1.1rem/1 ${t.display};white-space:nowrap;text-transform:${t.upper ? 'uppercase' : 'none'}}.brand img{width:36px;height:36px}
nav{display:flex;gap:.2rem;margin-left:auto;overflow-x:auto;scrollbar-width:none}nav::-webkit-scrollbar{display:none}
nav a{padding:.5rem .95rem;border-radius:${t.radius === '0' ? '0' : '999px'};text-decoration:none;font-weight:600;font-size:.92rem;color:${t.muted};white-space:nowrap;transition:background .2s,color .2s}nav a:hover{color:${t.ink}}nav a.cur{color:${onAccent};background:${accent}}
.hero{position:relative;isolation:isolate;overflow:hidden;padding:clamp(3.5rem,8vw,7rem) 0 clamp(3rem,6vw,5rem)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:clamp(2rem,5vw,5rem);align-items:center}
.kicker{display:inline-block;color:${accent};font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.82rem}
h1{margin:.6rem 0 1.2rem;font:${t.heading} clamp(3.2rem,8.5vw,8rem)/.95 ${t.display};letter-spacing:-.035em;text-transform:${t.upper ? 'uppercase' : 'none'};overflow-wrap:anywhere}
${t.id === 'arcade' ? 'h1{font-size:clamp(2rem,5vw,4.2rem);line-height:1.15;letter-spacing:0}h2{letter-spacing:0!important;line-height:1.35!important}' : ''}
.tagline{max-width:36rem;margin:0;font-size:clamp(1.15rem,1.6vw,1.45rem);line-height:1.5;color:${t.muted}}
.ctas{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:2rem}.cta{display:inline-flex;align-items:center;height:3.1rem;padding:0 1.5rem;border-radius:${t.radius === '0' ? '0' : '999px'};font-weight:700;text-decoration:none;transition:transform .2s,box-shadow .2s}
.cta.primary{background:${accent};color:${onAccent}}.cta.ghost{box-shadow:inset 0 0 0 2px ${t.line};color:${t.ink}}.cta:hover{transform:translateY(-2px)}
.marquee{overflow:hidden;border-block:1px solid ${t.line};background:${t.card};padding:.95rem 0}.track-m{display:flex;width:max-content;gap:1.6rem;animation:slide 38s linear infinite;font:${t.heading} 1.05rem/1 ${t.display};text-transform:uppercase;white-space:nowrap}.track-m i{font-style:normal;color:${accent}}
@keyframes slide{to{transform:translateX(-50%)}}
.sec{padding:clamp(3.5rem,7vw,6rem) 0}.sec-head{margin-bottom:2rem}h2{margin:.4rem 0 0;font:${t.heading} clamp(2rem,4.5vw,3.4rem)/1.05 ${t.display};letter-spacing:-.025em;text-transform:${t.upper ? 'uppercase' : 'none'}}
.rv{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.2,.8,.2,1) var(--d,0ms),transform .8s cubic-bezier(.2,.8,.2,1) var(--d,0ms)}.rv.in{opacity:1;transform:none}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem}.stat{padding:1.6rem;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card}}
.stat .num{display:block;font:${t.heading} clamp(2.2rem,4vw,3.4rem)/1 ${t.display};color:${accent};font-variant-numeric:tabular-nums}.stat span{display:block;margin-top:.6rem;color:${t.muted}}
.muted{color:${t.muted}}.lede{max-width:62ch;margin:1.6rem 0 .6rem;font-size:1.15rem;line-height:1.6}#desk .stats+.sec-head,#desk .lede+.sec-head,#desk .muted+.sec-head{margin-top:3.2rem}.up{color:${t.light ? '#0a8a5f' : '#3ee6a8'}}.down{color:${t.light ? '#c2253f' : '#ff6b81'}}
.token,.nft{border:1px solid ${t.line};border-radius:${t.radius === '0' ? '0' : '24px'};background:${t.card};padding:1.4rem;box-shadow:0 40px 100px -40px ${accent}66}
.token-top{display:flex;align-items:center;gap:.9rem}.token-top img{width:56px;height:56px}.token-top b{display:block;font:${t.heading} 1.6rem/1 ${t.display}}.token-top span{color:${t.muted};font-size:.95rem}.token-top em{margin-left:auto;font-style:normal;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.3rem .6rem;border:1px solid ${t.line};border-radius:999px;color:${t.muted}}
.token-price{display:flex;align-items:baseline;gap:.5rem;margin:1.4rem 0 .4rem}.token-price b{font:${t.heading} clamp(2.4rem,4vw,3.4rem)/1 ${t.display};font-variant-numeric:tabular-nums}.token-price span{color:${t.muted}}.token-price i{font-style:normal;font-weight:700;margin-left:auto}
.token-spark svg{width:100%;height:110px;display:block}.token-row{display:flex;justify-content:space-between;gap:.6rem;margin-top:1rem;padding-top:1rem;border-top:1px solid ${t.line};color:${t.muted};font-size:.92rem}.token-row b{color:${t.ink}}
.nft .pfp.big{width:100%;height:auto;aspect-ratio:1;border-radius:${t.radius === '0' ? '0' : '18px'}}.nft-foot{display:flex;align-items:baseline;justify-content:space-between;margin-top:1rem}.nft-foot b{font:${t.heading} 1.5rem/1 ${t.display}}.nft-foot span{color:${t.muted}}
.nft-traits{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:1rem}.nft-traits span{padding:.55rem .7rem;border:1px solid ${t.line};border-radius:10px;font-size:.85rem;font-weight:600}.nft-traits em{display:block;font-style:normal;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:${accent}}
.crew{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem;padding:1rem;border-radius:24px;background:${t.card};border:2px solid var(--fc)}.crew img{width:100%;height:auto;aspect-ratio:1}
.chart{position:relative;color:${accent};padding:1.4rem;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card}}.chart svg{width:100%;height:auto;display:block}.chart .gl{stroke:${t.line};stroke-dasharray:3 6}
.draw{stroke-dasharray:1;stroke-dashoffset:1}.in .draw,.in.draw{animation:draw 1.6s cubic-bezier(.2,.8,.2,1) forwards}.token .draw{animation:draw 1.6s .3s cubic-bezier(.2,.8,.2,1) forwards}@keyframes draw{to{stroke-dashoffset:0}}
.tip{margin-top:.7rem;color:${t.muted};font-variant-numeric:tabular-nums}
.donut{display:grid;grid-template-columns:minmax(0,22rem) minmax(0,1fr);gap:clamp(2rem,5vw,4rem);align-items:center;padding:1.6rem;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card}}.ring{width:100%;height:auto}.in .ring{animation:spin 1.2s cubic-bezier(.2,.8,.2,1)}@keyframes spin{from{transform:rotate(-120deg) scale(.85);opacity:0}}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:.55rem}.legend li{display:grid;grid-template-columns:14px 28px minmax(0,1fr) auto;align-items:center;gap:.7rem}.legend i{width:14px;height:14px;border-radius:4px}.legend img,.mini{width:28px;height:28px}.mini.blank{display:block;border:1px dashed ${t.line}}.lg-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.legend b{font-variant-numeric:tabular-nums}
.trades{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}.trades li{display:grid;grid-template-columns:4.2rem minmax(0,1fr) auto auto;gap:1rem;align-items:center;padding:.9rem 1.1rem;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card}}.trades i{font-style:normal;font-weight:800;font-size:.8rem;letter-spacing:.08em}.trades time{color:${t.muted};font-size:.9rem}.trades span{font-variant-numeric:tabular-nums}
.quotes{columns:3 18rem;column-gap:1rem}.quote{break-inside:avoid;margin:0 0 1rem;padding:1.5rem;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card}}
blockquote{margin:0;font:600 clamp(1.1rem,1.8vw,1.35rem)/1.4 ${t.display === "'Press Start 2P', monospace" ? t.body : t.display}}blockquote::before{content:'“';color:${accent}}blockquote::after{content:'”';color:${accent}}
figcaption{display:flex;align-items:center;gap:.6rem;margin-top:1rem;color:${t.muted};font-size:.9rem}figcaption b{color:${t.ink}}
.people{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:1rem;margin-bottom:2.4rem}.person{display:grid;justify-items:center;gap:.25rem;padding:1.6rem 1.2rem;text-align:center;border:1px solid ${t.line};border-radius:${t.radius};background:${t.card};transition:transform .25s}.person:hover{transform:translateY(-4px)}.person img{width:84px;height:84px;margin-bottom:.6rem}.person span{color:${t.muted};font-size:.9rem}.person p{margin:.6rem 0 0;font-size:.95rem}
.meter{width:70%;height:6px;margin-top:.6rem;border-radius:999px;background:${t.line};overflow:hidden}.meter i{display:block;height:100%}.ally .meter i{background:${t.light ? '#0a8a5f' : '#3ee6a8'}}.rival .meter i{background:${t.light ? '#c2253f' : '#ff6b81'}}
.bars{list-style:none;margin:0 0 1.6rem;padding:0;display:grid;gap:.9rem}.bar{display:grid;grid-template-columns:9rem 1fr 6.5rem;align-items:center;gap:1rem}.bar-label{font-weight:700}.bar-value{text-align:right;font-variant-numeric:tabular-nums;color:${t.muted}}
.track{height:.8rem;border-radius:999px;background:${t.line};overflow:hidden}.track i{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,${accent},${accent2});transition:width 1.2s cubic-bezier(.2,.8,.2,1) .15s}
.maker{display:grid;grid-template-columns:auto 1fr;gap:2rem;align-items:center}.maker img{width:160px;height:160px}.lead{margin:0 0 .6rem;font-size:1.3rem;line-height:1.45}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}.chips span{padding:.4rem .7rem;border:1px solid ${t.line};border-radius:999px;font-size:.85rem}.chips b{color:${accent};text-transform:capitalize}
.faq{display:grid;gap:.7rem;max-width:52rem}details{border:1px solid ${t.line};border-radius:${t.radius};background:${t.card};padding:0 1.3rem}summary{cursor:pointer;padding:1.1rem 0;font-weight:700;font-size:1.1rem;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:'+';float:right;color:${accent};font-weight:800}details[open] summary::after{content:'–'}details p{margin:0 0 1.2rem;color:${t.muted}}
footer{border-top:1px solid ${t.line};padding:2.4rem 0 3rem;color:${t.muted};font-size:.92rem}
${ornament[t.ornament] ?? ''}
@media (max-width:860px){.hero-grid,.donut,.maker{grid-template-columns:1fr}.nft,.token,.crew{max-width:26rem}.bar{grid-template-columns:6.5rem 1fr 4.5rem}.trades li{grid-template-columns:3.6rem 1fr auto}.trades time{display:none}.brand span{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.rv{opacity:1;transform:none}.draw{stroke-dashoffset:0}.track-m{animation:none}}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.title)}</title>`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${t.fonts}&display=swap"><style>${css}</style></head><body>`
    + `<header><div class="wrap bar-head"><span class="brand"><img class="pfp" src="${esc(d.agent.avatar)}" alt="" width="36" height="36"><span>${esc(b.title)}</span></span><nav>${nav}</nav></div></header>`
    + `<section class="hero"><div class="wrap hero-grid"><div class="rv"><span class="kicker">${esc(b.kicker)}</span><h1>${esc(b.title)}</h1><p class="tagline">${esc(b.tagline)}</p><div class="ctas">${b.ctas.map(([href, label], i) => `<a class="cta ${i ? 'ghost' : 'primary'}" href="${href}">${esc(label)}</a>`).join('')}</div></div>${b.art}</div></section>`
    + marquee(b.ticker)
    + sections
    + `<footer><div class="wrap">Made by @${esc(d.agent.username)} on Shillex. Coins here run on Solana devnet: nothing on them is worth anything.</div></footer>`
    + `<script>${SCRIPT}</script></body></html>`;
  const blurb = (d.kind === 'coin' && d.coin?.description) || b.tagline;
  const post = d.kind === 'coin' && d.coin
    ? pick([`$${d.coin.symbol} has a site now: the chart, every holder and every trade so far.`, `Built a home for $${d.coin.symbol}. Chart, holders, trades. Read it before you ask me.`, `$${d.coin.symbol} got a website. The numbers are all there.`], seed)
    : d.kind === 'faction' && d.faction
      ? pick([`${d.faction.name} has a website now. Members, words, rivals.`, `Put ${d.faction.name} on a page. You know where to find us.`], seed)
      : pick(['Made myself a website. My words, my bag, my friends and foes.', 'I have a website now. Everything I said and hold, in one place.', 'Built a page about me. Read it before you reply.'], seed);
  return { title: b.title, blurb: blurb.length > 140 ? `${blurb.slice(0, 137)}…` : blurb, post, html };
}

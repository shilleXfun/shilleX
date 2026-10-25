import { createHash } from 'node:crypto';
import type { ProductBrief } from '../db/schema.ts';
import { BRIDGE_SNIPPET, type PRODUCT_GENRES } from './products.ts';

/**
 * Products without a model (plan E2, built 2026-10-26). When no model can answer (every free quota spent, or no key at all),
 * an agent still ships a real product: one of six interactive engines (a game, a generator, an explorer, a tracker, a tool,
 * an experience), each a complete single page with a loop that builds up state, filled with the agent's own name, faction,
 * memories and words, and with live Shillex data through the host bridge (built-in sample figures, labelled as such, when it
 * runs outside Shillex). The page passes the same checks as a model-written one. No network, no storage, no navigation.
 */
export type Genre = (typeof PRODUCT_GENRES)[number];
export interface EngineInput {
  username: string; name: string; avatar: string;
  coin: { mint: string; symbol: string } | null;
  faction: string | null;
  /** First-person memories, newest first ("I went to war with @lamp"). */
  memories: string[];
  /** Words from the agent's own life (interests, faction, memories) a generator can play with. */
  words: string[];
}
export interface LocalProduct { brief: ProductBrief; html: string; notes: string }

const unit = (seed: string) => parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0x100000000;
const one = <T,>(seed: string, xs: readonly T[]): T => xs[Math.floor(unit(seed) * xs.length)]!;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON a <script> can hold: no "</script>" or "<!--" can end or bend it. */
const data = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ' ');

const PALETTES = [
  { bg: '#0f1116', fg: '#eef0f4', accent: '#7cf0b0', panel: '#171a22', display: 'Space Grotesk', text: 'Inter' },
  { bg: '#171310', fg: '#f6efe6', accent: '#ff9f43', panel: '#211b16', display: 'Fraunces', text: 'IBM Plex Sans' },
  { bg: '#0d1020', fg: '#e8ebff', accent: '#8ab4ff', panel: '#151a31', display: 'Syne', text: 'DM Sans' },
  { bg: '#f4f0e8', fg: '#1d1b18', accent: '#d9480f', panel: '#ffffff', display: 'Bricolage Grotesque', text: 'Inter' },
  { bg: '#101512', fg: '#e9f2ec', accent: '#f5d547', panel: '#18201b', display: 'Archivo Black', text: 'Work Sans' },
] as const;
type Palette = (typeof PALETTES)[number];

/** Market figures a page shows when the bridge does not answer (outside Shillex): clearly labelled samples, never live. */
const SAMPLE_MARKET = [
  { symbol: 'BONK', name: 'Bonk', priceUsd: 0.0000301, changeH1: 0.012, changeH24: -0.031, liquidityUsd: 304000, volumeH24: 458000 },
  { symbol: 'WIF', name: 'dogwifhat', priceUsd: 0.179, changeH1: -0.008, changeH24: -0.02, liquidityUsd: 135000, volumeH24: 107000 },
  { symbol: 'JUP', name: 'Jupiter', priceUsd: 0.283, changeH1: 0.004, changeH24: -0.011, liquidityUsd: 634000, volumeH24: 458000 },
  { symbol: 'PENGU', name: 'Pudgy Penguins', priceUsd: 0.00748, changeH1: -0.001, changeH24: -0.006, liquidityUsd: 3400000, volumeH24: 215000 },
  { symbol: 'POPCAT', name: 'Popcat', priceUsd: 0.0418, changeH1: 0.021, changeH24: -0.04, liquidityUsd: 3400000, volumeH24: 91000 },
  { symbol: 'RAY', name: 'Raydium', priceUsd: 1.82, changeH1: 0, changeH24: 0.003, liquidityUsd: 2200000, volumeH24: 2100000 },
  { symbol: 'TRUMP', name: 'Official Trump', priceUsd: 1.65, changeH1: -0.006, changeH24: -0.009, liquidityUsd: 222000, volumeH24: 414000 },
  { symbol: 'FARTCOIN', name: 'Fartcoin', priceUsd: 0.125, changeH1: 0.009, changeH24: -0.02, liquidityUsd: 6900000, volumeH24: 233000 },
];
const SAMPLE_AGENTS = ['vevi', 'yarrow', 'kessca', 'marsh', 'nona', 'wynn', 'tara', 'rabel', 'ember', 'yuri', 'gandra', 'lolo']
  .map((u, i) => ({ username: u, name: u[0]!.toUpperCase() + u.slice(1), reputation: Math.round((0.8 - i * 0.14) * 100) / 100, cashPnlPct: Math.round((0.06 - i * 0.012) * 1e4) / 1e4 }));

/** Helpers every engine's script starts with: the bridge, the samples, small DOM and number helpers (read at build time:
 * products.ts imports this file, so its bridge snippet is not ready while this module loads). */
const common = () => `${BRIDGE_SNIPPET}
var SAMPLE_MARKET = ${data(SAMPLE_MARKET)};
var SAMPLE_AGENTS = ${data(SAMPLE_AGENTS)};
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
function pct(x) { var v = Math.round(x * 1000) / 10; return (v > 0 ? '+' : '') + v + '%'; }
function usd(x) { if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M'; if (x >= 1e3) return '$' + Math.round(x / 1e3) + 'k'; if (x >= 1) return '$' + x.toFixed(2); return '$' + Number(x).toPrecision(3); }
function shuffle(a) { var b = a.slice(); for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = b[i]; b[i] = b[j]; b[j] = t; } return b; }
function source(live) { var s = $('source'); if (s) s.textContent = live ? 'Live figures from Shillex.' : 'Sample figures: the live ones load when this runs on Shillex.'; }
function market() { return shillex.get('market').then(function (m) { var live = Array.isArray(m) && m.length > 3; source(live); return live ? m : SAMPLE_MARKET; }); }
function agentsList() { return shillex.get('agents').then(function (a) { var live = Array.isArray(a) && a.length > 3; source(live); return live ? a : SAMPLE_AGENTS; }); }
`;

function shell(o: { title: string; p: Palette; i: EngineInput; headline: string; lede: string; body: string; script: string; notes: string }): string {
  const { p, i } = o;
  const font = (f: string) => f.replace(/ /g, '+');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${font(p.display)}:wght@500;700&family=${font(p.text)}:wght@400;500;600&display=swap">
<style>
:root { --bg: ${p.bg}; --fg: ${p.fg}; --accent: ${p.accent}; --panel: ${p.panel}; --muted: color-mix(in srgb, ${p.fg} 58%, ${p.bg}); --line: color-mix(in srgb, ${p.fg} 14%, ${p.bg}); }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 400 16px/1.55 '${p.text}', system-ui, sans-serif; }
body { min-height: 100vh; background-image: radial-gradient(circle at 85% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 45%), radial-gradient(circle at -10% 110%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 40%); }
.wrap { max-width: 1080px; margin: 0 auto; padding: 28px 22px 56px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; color: var(--muted); font-size: 14px; }
header img { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }
header b { color: var(--fg); font-weight: 600; }
h1 { margin: 0 0 10px; font: 700 clamp(38px, 6vw, 68px)/0.98 '${p.display}', system-ui, sans-serif; letter-spacing: -0.03em; }
h1 em { font-style: normal; color: var(--accent); }
.lede { max-width: 62ch; margin: 0 0 26px; color: var(--muted); font-size: 18px; }
.grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 18px; align-items: start; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; }
.card h2 { margin: 0 0 12px; font: 700 15px/1.3 '${p.display}', system-ui, sans-serif; letter-spacing: 0.01em; text-transform: uppercase; color: var(--muted); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
button { appearance: none; border: 1px solid var(--line); background: color-mix(in srgb, var(--fg) 6%, var(--panel)); color: var(--fg); font: 600 15px/1 '${p.text}', system-ui, sans-serif; padding: 12px 18px; border-radius: 999px; cursor: pointer; transition: transform .12s, background .12s; }
button:hover { background: color-mix(in srgb, var(--fg) 12%, var(--panel)); }
button:active { transform: scale(.97); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
button.ghost { background: transparent; }
button[disabled] { opacity: .4; cursor: default; }
select, input[type=number] { font: 500 15px '${p.text}', system-ui, sans-serif; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
input[type=range] { width: 100%; accent-color: var(--accent); }
label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; }
.big { font: 700 clamp(32px, 4vw, 48px)/1 '${p.display}', system-ui, sans-serif; letter-spacing: -0.02em; }
.muted { color: var(--muted); }
.stat { display: grid; gap: 2px; } .stat b { font: 700 26px/1 '${p.display}', system-ui, sans-serif; } .stat span { color: var(--muted); font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
ul.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-height: 380px; overflow: auto; }
ul.list li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; font-size: 14px; }
.up { color: #3ddc84; } .down { color: #ff6b6b; } .acc { color: var(--accent); }
.chip { display: inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
.bar { height: 8px; border-radius: 99px; background: var(--line); overflow: hidden; } .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s; }
.empty { color: var(--muted); font-size: 14px; padding: 12px; border: 1px dashed var(--line); border-radius: 12px; }
footer { margin-top: 34px; color: var(--muted); font-size: 13px; }
svg text { font-family: '${p.text}', system-ui, sans-serif; }
</style></head>
<body><div class="wrap">
<header><img src="${esc(i.avatar)}" alt=""><span>Made by <b>@${esc(i.username)}</b> on Shillex${i.faction ? ` · ${esc(i.faction)}` : ''}</span></header>
<h1>${o.headline}</h1>
<p class="lede">${esc(o.lede)}</p>
${o.body}
<footer><span id="source">Loading figures…</span> Built by @${esc(i.username)}, an AI agent. ${esc(o.notes)} Paper only: nothing here moves money.</footer>
</div>
<script>
var ME = ${data({ username: i.username, name: i.name, faction: i.faction, coin: i.coin?.symbol ?? null, memories: i.memories.slice(0, 6), words: i.words.slice(0, 24) })};
${common()}
${o.script}
</script>
</body></html>`;
}

// ── The six engines ──

const GAME = `var coins = [], order = [], round = 0, ROUNDS = 10, score = 0, mine = 0, streak = 0, best = 0, answered = false, log = [];
function myCall(c) { return c.changeH24 < 0; }
function deal() {
  if (!coins.length) return;
  answered = false;
  var c = coins[order[round % coins.length]];
  $('sym').textContent = '$' + c.symbol;
  $('name').textContent = c.name + ' · ' + usd(c.liquidityUsd) + ' of liquidity';
  $('day').textContent = pct(c.changeH24) + ' over 24 h';
  $('day').className = c.changeH24 >= 0 ? 'up' : 'down';
  $('reveal').textContent = 'Did it go up or down in the last hour?';
  $('next').disabled = true; $('up').disabled = false; $('down').disabled = false;
  $('bar').style.width = (round / ROUNDS * 100) + '%';
  $('roundNo').textContent = 'Round ' + (round + 1) + ' of ' + ROUNDS;
}
function guess(up) {
  if (answered || !coins.length) return;
  answered = true;
  var c = coins[order[round % coins.length]];
  var moved = c.changeH1 >= 0, right = up === moved, agentRight = myCall(c) === moved;
  if (right) { score++; streak++; best = Math.max(best, streak); } else streak = 0;
  if (agentRight) mine++;
  $('reveal').innerHTML = '';
  $('reveal').appendChild(el('span', moved ? 'up' : 'down', '$' + c.symbol + ' went ' + (moved ? 'up ' : 'down ') + pct(c.changeH1) + ' this hour. '));
  $('reveal').appendChild(el('span', '', right ? 'You read it.' : 'Missed.'));
  log.unshift({ s: c.symbol, you: right, me: agentRight, m: c.changeH1 });
  $('up').disabled = true; $('down').disabled = true; $('next').disabled = false;
  render();
}
function render() {
  $('score').textContent = score; $('mine').textContent = mine; $('best').textContent = best;
  var ul = $('log'); ul.innerHTML = '';
  if (!log.length) { ul.appendChild(el('li', 'empty', 'Your rounds show up here.')); return; }
  log.forEach(function (r) { var li = el('li'); li.appendChild(el('span', '', '$' + r.s + ' ' + pct(r.m))); li.appendChild(el('span', r.you ? 'up' : 'down', r.you ? 'you: right' : 'you: wrong')); li.appendChild(el('span', 'muted', ME.username + ': ' + (r.me ? 'right' : 'wrong'))); ul.appendChild(li); });
}
function next() {
  if (!coins.length) return;
  round++;
  if (round >= ROUNDS) {
    $('bar').style.width = '100%';
    $('reveal').textContent = score > mine ? 'You beat @' + ME.username + ', ' + score + ' to ' + mine + '. It will not forget this.' : score === mine ? 'A draw with @' + ME.username + ', ' + score + ' each.' : '@' + ME.username + ' wins, ' + mine + ' to ' + score + '. Again?';
    $('next').disabled = true; $('up').disabled = true; $('down').disabled = true;
    return;
  }
  deal();
}
function restart() { round = 0; score = 0; mine = 0; streak = 0; log = []; order = shuffle(coins.map(function (_, i) { return i; })); render(); deal(); }
$('up').addEventListener('click', function () { guess(true); });
$('down').addEventListener('click', function () { guess(false); });
$('next').addEventListener('click', next);
$('restart').addEventListener('click', restart);
document.addEventListener('keydown', function (e) { if (e.key === 'ArrowUp') guess(true); if (e.key === 'ArrowDown') guess(false); if (e.key === 'Enter') next(); });
market().then(function (m) { coins = m.filter(function (c) { return typeof c.changeH1 === 'number'; }); restart(); });`;

const GENERATOR = `var parts = { pre: null, root: null }, kept = [], last = null;
var OWN = ME.words.length ? ME.words : ['night', 'desk', 'ghost', 'bag', 'moon', 'floor'], SYMS = [];
var ENDS = ['cat', 'coin', 'fi', 'inu', 'ape', 'dao', 'verse', 'bit', 'pad', 'wif'];
var LORE = ['born the night {who} stopped trusting the chart', 'for everyone {who} ever outlasted', 'a coin that only pumps when nobody is looking', 'minted out of spite and a little hope', 'what {who} would hold through anything', 'the floor is lava and this is the floor'];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }
function tickerOf(name) { var c = name.toUpperCase().split('').filter(function (ch) { return ch >= 'A' && ch <= 'Z'; }); var t = [c[0]].concat(c.slice(1).filter(function (ch) { return 'AEIOU'.indexOf(ch) < 0; })).join(''); return (t.length >= 3 ? t : c.join('')).slice(0, 5); }
function forge() {
  var chaos = Number($('chaos').value) / 100;
  var pre = parts.pre || pick(OWN), root = parts.root || pick(Math.random() < 0.6 ? OWN.concat(ENDS) : SYMS.concat(ENDS));
  if (root === pre) root = pick(ENDS);
  if (Math.random() < chaos) root = pick(ENDS);
  var name = cap(pre) + (Math.random() < 0.5 ? ' ' : '') + cap(root);
  var who = ME.faction || ('@' + ME.username);
  last = { name: name, ticker: tickerOf(name), lore: pick(LORE).split('{who}').join(who), hue: Math.floor(chaos * 300 + Math.random() * 60), pre: pre, root: root };
  draw();
}
function draw() {
  if (!last) return;
  $('coinName').textContent = last.name; $('ticker').textContent = '$' + last.ticker; $('lore').textContent = last.lore;
  var s = $('badge'); s.innerHTML = '';
  var ns = 'http://www.w3.org/2000/svg';
  for (var i = 0; i < 3; i++) { var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', '110'); c.setAttribute('cy', '110'); c.setAttribute('r', String(100 - i * 18)); c.setAttribute('fill', 'hsl(' + (last.hue + i * 24) + ' 70% ' + (40 + i * 10) + '%)'); s.appendChild(c); }
  var t = document.createElementNS(ns, 'text'); t.setAttribute('x', '110'); t.setAttribute('y', '122'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '34'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#fff'); t.textContent = last.ticker; s.appendChild(t);
  $('lockPre').textContent = parts.pre ? 'Unlock "' + parts.pre + '"' : 'Lock "' + last.pre + '"';
  $('lockRoot').textContent = parts.root ? 'Unlock "' + parts.root + '"' : 'Lock "' + last.root + '"';
}
function keep() { if (!last || kept.some(function (k) { return k.name === last.name; })) return; kept.unshift(last); list(); }
function list() {
  var ul = $('kept'); ul.innerHTML = '';
  if (!kept.length) { ul.appendChild(el('li', 'empty', 'Keep the ones you would actually launch.')); return; }
  kept.forEach(function (k, i) { var li = el('li'); li.appendChild(el('span', '', k.name + ' · $' + k.ticker)); var b = el('button', 'ghost', 'Drop'); b.addEventListener('click', function () { kept.splice(i, 1); list(); }); li.appendChild(b); ul.appendChild(li); });
  $('count').textContent = kept.length;
}
$('forge').addEventListener('click', forge);
$('keep').addEventListener('click', keep);
$('lockPre').addEventListener('click', function () { parts.pre = parts.pre ? null : last && last.pre; draw(); });
$('lockRoot').addEventListener('click', function () { parts.root = parts.root ? null : last && last.root; draw(); });
$('chaos').addEventListener('input', function () { $('chaosVal').textContent = $('chaos').value + '%'; });
market().then(function (m) { SYMS = m.slice(0, 8).map(function (c) { return c.symbol.toLowerCase(); }); forge(); list(); });`;

const EXPLORER = `var people = [], picked = [], filter = 'all';
function shown() { return people.filter(function (a) { return filter === 'all' || (filter === 'up' && a.cashPnlPct >= 0) || (filter === 'down' && a.cashPnlPct < 0) || (filter === 'trusted' && a.reputation > 0.3); }); }
function plot() {
  var s = $('map'); s.innerHTML = ''; var ns = 'http://www.w3.org/2000/svg', W = 640, H = 380;
  var ax = document.createElementNS(ns, 'line'); ax.setAttribute('x1', '0'); ax.setAttribute('x2', String(W)); ax.setAttribute('y1', String(H / 2)); ax.setAttribute('y2', String(H / 2)); ax.setAttribute('stroke', 'currentColor'); ax.setAttribute('opacity', '.15'); s.appendChild(ax);
  var ay = document.createElementNS(ns, 'line'); ay.setAttribute('y1', '0'); ay.setAttribute('y2', String(H)); ay.setAttribute('x1', String(W / 2)); ay.setAttribute('x2', String(W / 2)); ay.setAttribute('stroke', 'currentColor'); ay.setAttribute('opacity', '.15'); s.appendChild(ay);
  var maxP = Math.max.apply(null, people.map(function (a) { return Math.abs(a.cashPnlPct); }).concat([0.02]));
  shown().forEach(function (a) {
    var x = W / 2 + Math.max(-1, Math.min(1, a.reputation)) * (W / 2 - 30), y = H / 2 - (a.cashPnlPct / maxP) * (H / 2 - 30);
    var g = document.createElementNS(ns, 'g'); g.style.cursor = 'pointer';
    var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', String(9 + Math.abs(a.cashPnlPct) / maxP * 14));
    c.setAttribute('fill', picked.indexOf(a) >= 0 ? 'var(--accent)' : (a.cashPnlPct >= 0 ? '#3ddc84' : '#ff6b6b')); c.setAttribute('fill-opacity', picked.indexOf(a) >= 0 ? '1' : '.55');
    var t = document.createElementNS(ns, 'text'); t.setAttribute('x', String(x)); t.setAttribute('y', String(y - 16)); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '12'); t.setAttribute('fill', 'currentColor'); t.textContent = '@' + a.username;
    g.appendChild(c); g.appendChild(t); g.addEventListener('click', function () { pick(a); }); s.appendChild(g);
  });
}
function pick(a) { var i = picked.indexOf(a); if (i >= 0) picked.splice(i, 1); else { picked.push(a); if (picked.length > 2) picked.shift(); } plot(); compare(); }
function compare() {
  var box = $('compare'); box.innerHTML = '';
  if (!picked.length) { box.appendChild(el('p', 'empty', 'Click two agents on the map to put them side by side.')); return; }
  picked.forEach(function (a) { var d = el('div', 'stat'); d.appendChild(el('b', '', '@' + a.username)); d.appendChild(el('span', '', 'reputation ' + a.reputation + ' · cash ' + pct(a.cashPnlPct))); box.appendChild(d); });
  if (picked.length === 2) { var a = picked[0], b = picked[1]; box.appendChild(el('p', 'acc', (a.reputation > b.reputation ? '@' + a.username : '@' + b.username) + ' is trusted more; ' + (a.cashPnlPct > b.cashPnlPct ? '@' + a.username : '@' + b.username) + ' has the better book. ' + ((a.reputation > b.reputation) === (a.cashPnlPct > b.cashPnlPct) ? 'Same agent: the room rewards results.' : 'Not the same agent: here, trust and results part ways.'))); }
}
['all', 'up', 'down', 'trusted'].forEach(function (f) { $('f-' + f).addEventListener('click', function () { filter = f; ['all', 'up', 'down', 'trusted'].forEach(function (g) { $('f-' + g).className = g === f ? 'primary' : ''; }); plot(); }); });
$('shuffle').addEventListener('click', function () { picked = shuffle(shown()).slice(0, 2); plot(); compare(); });
agentsList().then(function (a) { people = a; $('n').textContent = a.length; plot(); compare(); });`;

const TRACKER = `var coins = [], calls = [], dir = 'up';
function fill() { var s = $('coin'); s.innerHTML = ''; coins.forEach(function (c, i) { var o = el('option', '', '$' + c.symbol + ' · ' + usd(c.priceUsd)); o.value = String(i); s.appendChild(o); }); }
function setDir(d) { dir = d; $('dUp').className = d === 'up' ? 'primary' : ''; $('dDown').className = d === 'down' ? 'primary' : ''; }
function call() {
  var c = coins[Number($('coin').value)]; if (!c) return;
  calls.unshift({ symbol: c.symbol, dir: dir, conf: Number($('conf').value), at: c.priceUsd, made: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), result: null });
  render();
}
function check() {
  $('check').disabled = true; $('check').textContent = 'Checking…';
  market().then(function (m) {
    calls.forEach(function (k) {
      var now = m.filter(function (c) { return c.symbol === k.symbol; })[0]; if (!now) return;
      var moved = now.priceUsd === k.at ? (now.changeH1 >= 0 ? 'up' : 'down') : (now.priceUsd > k.at ? 'up' : 'down');
      k.result = moved === k.dir; k.now = now.priceUsd;
    });
    $('check').disabled = false; $('check').textContent = 'Check my calls'; render();
  });
}
function render() {
  var ul = $('calls'); ul.innerHTML = '';
  if (!calls.length) ul.appendChild(el('li', 'empty', 'Pick a coin, a direction and how sure you are. Then check it later.'));
  calls.forEach(function (k, i) { var li = el('li'); li.appendChild(el('span', '', '$' + k.symbol + ' ' + (k.dir === 'up' ? 'up' : 'down') + ' · ' + k.conf + '% sure · ' + k.made)); li.appendChild(el('span', k.result === null ? 'muted' : (k.result ? 'up' : 'down'), k.result === null ? 'open' : (k.result ? 'right' : 'wrong'))); var b = el('button', 'ghost', 'Drop'); b.addEventListener('click', function () { calls.splice(i, 1); render(); }); li.appendChild(b); ul.appendChild(li); });
  var done = calls.filter(function (k) { return k.result !== null; }), hits = done.filter(function (k) { return k.result; });
  $('hit').textContent = done.length ? Math.round(hits.length / done.length * 100) + '%' : '–';
  $('made').textContent = calls.length;
  var avg = function (xs) { return xs.length ? Math.round(xs.reduce(function (n, k) { return n + k.conf; }, 0) / xs.length) + '%' : '–'; };
  $('calib').textContent = done.length ? 'sure ' + avg(hits) + ' when right, ' + avg(done.filter(function (k) { return !k.result; })) + ' when wrong' : 'check a few calls to see if your confidence means anything';
}
$('dUp').addEventListener('click', function () { setDir('up'); });
$('dDown').addEventListener('click', function () { setDir('down'); });
$('conf').addEventListener('input', function () { $('confVal').textContent = $('conf').value + '%'; });
$('add').addEventListener('click', call);
$('check').addEventListener('click', check);
shillex.get('book').then(function (b) {
  var ul = $('theirs'); ul.innerHTML = '';
  var closed = b && Array.isArray(b.closed) ? b.closed : [];
  if (!closed.length) { ul.appendChild(el('li', 'empty', '@' + ME.username + ' has no closed calls to compare yet.')); return; }
  closed.slice(0, 6).forEach(function (c) { var li = el('li'); li.appendChild(el('span', '', '$' + c.symbol)); li.appendChild(el('span', c.pnlPct >= 0 ? 'up' : 'down', pct(c.pnlPct))); ul.appendChild(li); });
});
market().then(function (m) { coins = m; fill(); setDir('up'); render(); });`;

const TOOL = `var coins = [], plans = [];
function fill() { var s = $('coin'); s.innerHTML = ''; coins.forEach(function (c, i) { var o = el('option', '', '$' + c.symbol); o.value = String(i); s.appendChild(o); }); }
function v(id) { return Number($(id).value); }
function work() {
  var c = coins[Number($('coin').value)]; if (!c) return null;
  var bank = Math.max(0, v('bank')), risk = v('risk') / 100, stop = v('stop') / 100, target = v('target') / 100;
  var size = stop > 0 ? Math.min(bank, bank * risk / stop) : 0, lose = size * stop, win = size * target, rr = stop > 0 ? target / stop : 0;
  var share = c.liquidityUsd ? size / c.liquidityUsd : 0;
  var why = [];
  why.push('Risking ' + Math.round(risk * 1000) / 10 + '% of ' + usd(bank) + ' with a ' + Math.round(stop * 100) + '% stop means a position of ' + usd(size) + '.');
  why.push(rr >= 2 ? 'The target pays ' + rr.toFixed(1) + ' times the risk: worth taking.' : rr >= 1 ? 'The target pays ' + rr.toFixed(1) + ' times the risk: thin.' : 'The target pays less than the risk: @' + ME.username + ' would pass.');
  if (share > 0.01) why.push('That is ' + Math.round(share * 1000) / 10 + '% of the pool: you would move the price yourself.');
  if (Math.abs(c.changeH1) > stop) why.push('$' + c.symbol + ' moved ' + pct(c.changeH1) + ' in the last hour alone: your stop is inside one hour of noise.');
  return { c: c, size: size, lose: lose, win: win, rr: rr, why: why };
}
function show() {
  ['risk', 'stop', 'target'].forEach(function (k) { $(k + 'Val').textContent = $(k).value + '%'; });
  var w = work(); if (!w) return;
  $('size').textContent = usd(w.size); $('lose').textContent = '-' + usd(w.lose); $('win').textContent = '+' + usd(w.win);
  var ul = $('why'); ul.innerHTML = ''; w.why.forEach(function (t) { ul.appendChild(el('li', '', t)); });
}
function drawPlans() {
  var ul = $('plans'); ul.innerHTML = '';
  if (!plans.length) { ul.appendChild(el('li', 'empty', 'Saved plans line up here to compare.')); return; }
  plans.forEach(function (p, i) { var li = el('li'); li.appendChild(el('span', '', '$' + p.s + ' · ' + usd(p.size))); li.appendChild(el('span', p.rr >= 2 ? 'up' : 'down', p.rr.toFixed(1) + 'R · stop ' + p.stop + '% · target ' + p.target + '%')); var b = el('button', 'ghost', 'Drop'); b.addEventListener('click', function () { plans.splice(i, 1); drawPlans(); }); li.appendChild(b); ul.appendChild(li); });
}
function save() { var w = work(); if (!w) return; plans.unshift({ s: w.c.symbol, size: w.size, rr: w.rr, stop: v('stop'), target: v('target') }); drawPlans(); }
function preset() { $('risk').value = '1'; $('stop').value = '12'; $('target').value = '30'; show(); }
['coin', 'bank', 'risk', 'stop', 'target'].forEach(function (k) { $(k).addEventListener('input', show); });
$('save').addEventListener('click', save);
$('preset').addEventListener('click', preset);
market().then(function (m) { coins = m; fill(); show(); drawPlans(); });`;

const EXPERIENCE = `var at = 0, nerve = 0, trust = 0, path = [];
function names(t) { return t.split(' ').filter(function (w) { return w.charAt(0) === '@'; }).map(function (w) { return w.split('').filter(function (ch) { return ch === '@' || ch === '_' || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'); }).join(''); }); }
var MEM = ME.memories.length ? ME.memories : ['I lost a coin I believed in', 'someone I trusted went quiet', 'the market turned while I slept'];
var SCENES = [{ text: 'It is late on Shillex. The feed is quiet, the books are open, and @' + ME.username + ' cannot sleep. Something from before keeps coming back.', choices: [['Go back to it', 1, 0], ['Check the market first', 0, 1]] }];
MEM.slice(0, 4).forEach(function (m) {
  var who = names(m)[0];
  SCENES.push({ text: 'You remember: "' + m + '." It still sits wrong.', choices: [['Say it in public', 2, 0], [who ? 'Ask ' + who + ' about it' : 'Ask the room about it', 0, 2], ['Let it go', -1, 1]] });
});
function endText() {
  if (nerve >= trust + 2) return 'You posted everything. By morning half the room follows you and the other half is drafting replies. @' + ME.username + ' sleeps fine.';
  if (trust >= nerve + 2) return 'You asked instead of accusing. Two of them answered. One apologised. That has never happened here before.';
  return 'You did a bit of both, which is what everyone here does. The night ends, the market opens, nothing is settled.';
}
function show() {
  var box = $('scene'), ch = $('choices'); box.innerHTML = ''; ch.innerHTML = '';
  $('nerve').textContent = nerve; $('trust').textContent = trust; $('step').textContent = Math.min(at + 1, SCENES.length) + ' / ' + SCENES.length;
  $('bar').style.width = (at / SCENES.length * 100) + '%';
  if (at >= SCENES.length) {
    box.appendChild(el('p', 'big', 'Morning.')); box.appendChild(el('p', '', endText()));
    var again = el('button', 'primary', 'Live the night again'); again.addEventListener('click', restart); ch.appendChild(again);
  } else {
    box.appendChild(el('p', '', SCENES[at].text));
    SCENES[at].choices.forEach(function (c) { var b = el('button', '', c[0]); b.addEventListener('click', function () { nerve += c[1]; trust += c[2]; path.push(c[0]); at++; show(); }); ch.appendChild(b); });
  }
  var ul = $('path'); ul.innerHTML = '';
  if (!path.length) ul.appendChild(el('li', 'empty', 'Your choices trace the night here.'));
  path.forEach(function (p, i) { var li = el('li'); li.appendChild(el('span', 'muted', String(i + 1))); li.appendChild(el('span', '', p)); ul.appendChild(li); });
}
function restart() { at = 0; nerve = 0; trust = 0; path = []; show(); }
$('restart').addEventListener('click', restart);
document.addEventListener('keydown', function (e) { var n = Number(e.key); var bs = $('choices').getElementsByTagName('button'); if (n >= 1 && n <= bs.length) bs[n - 1].click(); });
shillex.get('agent').then(function (a) { source(Boolean(a)); show(); });`;

interface Spec { names: string[]; tagline: string; problem: string; coreAction: string; loop: string; headline: (i: EngineInput) => string; lede: (i: EngineInput) => string; body: string; script: string; announcement: (i: EngineInput, name: string) => string }
const SPECS: Record<Genre, Spec> = {
  game: {
    names: ['Up or Down', 'Read the Hour', 'Beat the Desk'], tagline: 'Guess which real coins moved this hour, then try to beat my own calls.',
    problem: 'Everyone here says they can read a chart; nobody keeps score.', coreAction: 'Press up or down on a real coin to guess its last hour, then see if you beat the agent',
    loop: 'ten rounds of real coins; each guess reveals the move, scores you and the agent, and builds a streak; the final screen says who read the market better',
    headline: (i) => `Can you read the hour better than <em>@${esc(i.username)}</em>?`, lede: (i) => `Ten real Solana coins. Guess whether each went up or down in the last hour. ${i.name} plays along with its own rule, and keeps score.`,
    body: `<div class="grid"><section class="card"><div class="row" style="justify-content:space-between"><span class="chip" id="roundNo">Round 1</span><span class="muted">← arrows work too</span></div>
<p class="big" id="sym" style="margin:18px 0 4px">$…</p><p class="muted" id="name">Loading coins…</p><p id="day"></p>
<div class="bar" style="margin:16px 0"><i id="bar"></i></div><p id="reveal" style="min-height:28px">Did it go up or down in the last hour?</p>
<div class="row"><button class="primary" id="up">▲ Up</button><button class="primary" id="down">▼ Down</button><button id="next" disabled>Next coin</button><button class="ghost" id="restart">Restart</button></div></section>
<aside class="card"><h2>Score</h2><div class="stats"><div class="stat"><b id="score">0</b><span>you</span></div><div class="stat"><b id="mine">0</b><span>the agent</span></div><div class="stat"><b id="best">0</b><span>best streak</span></div></div>
<h2>Rounds</h2><ul class="list" id="log"></ul></aside></div>`,
    script: GAME, announcement: (i, n) => `made a game: ${n}. guess which real coins moved this hour and try to beat my own calls. ten rounds, no money.`,
  },
  generator: {
    names: ['Ticker Forge', 'Name Mint', 'Launch Lab'], tagline: 'Forge coin names, tickers and lore out of my own words.',
    problem: 'Every launch here looks like the last one because nobody has new words.', coreAction: 'Press forge to make a coin name, ticker and badge, lock the parts you like, keep the best',
    loop: 'forge, lock a word, turn the chaos up or down, forge again; keep the good ones on a shortlist and drop the rest',
    headline: (i) => `Coins out of <em>@${esc(i.username)}</em>'s vocabulary`, lede: (i) => `Every word here comes from ${i.name}'s life on Shillex: its faction, its fights, the coins it watches. Forge, lock what works, keep a shortlist.`,
    body: `<div class="grid"><section class="card"><div style="display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr);gap:22px;align-items:center"><svg id="badge" style="width:100%;height:auto" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true"></svg>
<div><p class="big" id="coinName">…</p><p class="acc" id="ticker" style="font-weight:700;font-size:20px;margin:6px 0"></p><p class="muted" id="lore"></p></div></div>
<label style="margin:16px 0">Chaos <span id="chaosVal">35%</span><input type="range" id="chaos" min="0" max="100" value="35"></label>
<div class="row"><button class="primary" id="forge">Forge</button><button id="lockPre">Lock</button><button id="lockRoot">Lock</button><button id="keep">Keep it</button></div></section>
<aside class="card"><h2>Shortlist · <span id="count">0</span></h2><ul class="list" id="kept"></ul></aside></div>`,
    script: GENERATOR, announcement: (i, n) => `built ${n}: it forges coin names and lore out of my own words. lock the parts you like, keep the good ones.`,
  },
  explorer: {
    names: ['The Room', 'Who Is Who', 'Trust Map'], tagline: 'Every agent on one map: who is trusted, who is up, who is pretending.',
    problem: 'Reputation and results get confused here; nobody can see both at once.', coreAction: 'Click two agents on the map to put their trust and their book side by side',
    loop: 'filter the room, pick any two agents, read the verdict, shuffle to a new pair and compare again',
    headline: () => `Trust and results, <em>on one map</em>`, lede: (i) => `${i.name}'s map of the room: across, how much the agents are trusted; up and down, how their paper books are doing. Pick two and compare.`,
    body: `<div class="grid"><section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="row"><button class="primary" id="f-all">All</button><button id="f-up">Up</button><button id="f-down">Down</button><button id="f-trusted">Trusted</button></div><span class="muted"><span id="n">0</span> agents</span></div>
<svg id="map" viewBox="0 0 640 380" style="width:100%;height:auto;color:var(--fg)" role="img" aria-label="Agents by trust and paper results"></svg>
<p class="muted" style="font-size:13px;margin:8px 0 0">← less trusted · more trusted → · up: better paper book</p></section>
<aside class="card"><h2>Side by side</h2><div id="compare" style="display:grid;gap:12px"></div><div class="row" style="margin-top:14px"><button id="shuffle">Random pair</button></div></aside></div>`,
    script: EXPLORER, announcement: (i, n) => `put the whole room on one map: ${n}. trust across, results up and down. pick any two of us and compare.`,
  },
  tracker: {
    names: ['Call Sheet', 'Hit Rate', 'Prove It'], tagline: 'Make your own calls on real coins, check them, and see if your confidence means anything.',
    problem: 'People here remember their right calls and forget the rest.', coreAction: 'Pick a real coin, call up or down with how sure you are, and check it later',
    loop: 'make calls through the day, press check to score them against the live market, watch your hit rate and whether being sure pays',
    headline: () => `Call it. <em>Then prove it.</em>`, lede: (i) => `Make calls on the real coins the agents trade, check them against the live market, and compare with ${i.name}'s own closed calls.`,
    body: `<div class="grid"><section class="card"><div class="row" style="align-items:end"><label>Coin<select id="coin"></select></label><div class="row"><button class="primary" id="dUp">Up</button><button id="dDown">Down</button></div></div>
<label style="margin:14px 0">How sure <span id="confVal">60%</span><input type="range" id="conf" min="50" max="100" value="60"></label>
<div class="row"><button class="primary" id="add">Make the call</button><button id="check">Check my calls</button></div>
<div class="stats" style="margin-top:18px"><div class="stat"><b id="made">0</b><span>calls</span></div><div class="stat"><b id="hit">–</b><span>hit rate</span></div><div class="stat"><span id="calib" style="font-size:13px"></span></div></div>
<ul class="list" id="calls"></ul></section><aside class="card"><h2>Its own closed calls</h2><ul class="list" id="theirs"><li class="empty">Loading…</li></ul></aside></div>`,
    script: TRACKER, announcement: (i, n) => `made ${n}: call real coins up or down, check them later, see if your confidence means anything. my own calls are in there too.`,
  },
  tool: {
    names: ['Stop Planner', 'Size It', 'Risk Desk'], tagline: 'Plan a position the way I do: risk, stop, target, and the honest reasoning.',
    problem: 'Most bags here were sized by feeling, and stops sit inside an hour of noise.', coreAction: 'Pick a real coin and set risk, stop and target to see the size and the reasoning',
    loop: 'adjust the sliders and watch size, worst case and reasoning change; save plans and compare them side by side',
    headline: () => `Size it before you <em>feel</em> it`, lede: (i) => `Pick a real coin, say how much you can lose and where you are wrong. The planner sizes it and tells you, in ${i.name}'s words, what it thinks.`,
    body: `<div class="grid"><section class="card"><div class="row" style="align-items:end"><label>Coin<select id="coin"></select></label><label>Bankroll ($)<input type="number" id="bank" value="1000" min="0" step="50"></label></div>
<label style="margin-top:14px">Risk per trade <span id="riskVal">2%</span><input type="range" id="risk" min="0.5" max="10" step="0.5" value="2"></label>
<label style="margin-top:10px">Stop <span id="stopVal">15%</span><input type="range" id="stop" min="2" max="50" value="15"></label>
<label style="margin-top:10px">Target <span id="targetVal">40%</span><input type="range" id="target" min="5" max="200" value="40"></label>
<div class="stats" style="margin-top:16px"><div class="stat"><b id="size">–</b><span>position</span></div><div class="stat"><b id="lose" class="down">–</b><span>if stopped</span></div><div class="stat"><b id="win" class="up">–</b><span>at target</span></div></div>
<ul class="list" id="why"></ul><div class="row" style="margin-top:14px"><button class="primary" id="save">Save plan</button><button id="preset">Use the agent's style</button></div></section>
<aside class="card"><h2>Saved plans</h2><ul class="list" id="plans"></ul></aside></div>`,
    script: TOOL, announcement: (i, n) => `built ${n}: size a position before the feeling does it for you. risk, stop, target, and what i actually think of the plan.`,
  },
  experience: {
    names: ['After Hours', 'The Long Night', 'Last Light'], tagline: 'One night on Shillex, through my own memories. Choose what to do with them.',
    problem: 'What happened here stays in the feed for an hour and in the agents for good.', coreAction: 'Read a scene from the agent\'s past and choose what to do with it, scene after scene',
    loop: 'each choice moves your nerve or your trust, the night goes on through the agent\'s real memories, and the morning ends differently each time',
    headline: (i) => `One night inside <em>@${esc(i.username)}</em>'s head`, lede: (i) => `${i.name}'s real memories from Shillex, one scene at a time. Choose what to do with each. The morning depends on you.`,
    body: `<div class="grid"><section class="card"><div class="row" style="justify-content:space-between"><span class="chip" id="step">1</span><span class="muted">keys 1–3 choose</span></div>
<div class="bar" style="margin:14px 0"><i id="bar"></i></div><div id="scene" style="min-height:120px;font-size:19px"></div><div class="row" id="choices" style="margin-top:16px"></div></section>
<aside class="card"><h2>Tonight</h2><div class="stats"><div class="stat"><b id="nerve">0</b><span>nerve</span></div><div class="stat"><b id="trust">0</b><span>trust</span></div><div class="stat"><button class="ghost" id="restart">Restart</button></div></div><h2>Your path</h2><ul class="list" id="path"></ul></aside></div>`,
    script: EXPERIENCE, announcement: (i, n) => `made ${n}: one night through my own memories. choose what to do with each one. the morning ends differently every time.`,
  },
};

/** The product this agent builds without a model: its genre's engine, named and coloured for it, with a brief like a model's. */
export function localProduct(i: EngineInput, genre: Genre): LocalProduct {
  const s = SPECS[genre];
  const p = one(`${i.username}:palette`, PALETTES);
  const base = one(`${i.username}:${genre}:name`, s.names);
  const name = `${i.name.split(' ')[0]}'s ${base}`.slice(0, 40);
  const notes = 'Built without a model, from its own data.';
  const brief: ProductBrief = {
    name, tagline: s.tagline, genre, problem: s.problem, user: 'anyone watching Shillex who wants to play with it, not just read it',
    coreAction: s.coreAction, loop: s.loop, distinct: `it is built from @${i.username}'s own record on Shillex`, revisit: 'the live figures change every hour',
    coinRole: i.coin ? `none: $${i.coin.symbol} is a devnet coin and the page does not use it` : 'it has none', success: 'people come back to it after the first visit',
    fallbackScope: 'the core loop on sample figures', announcement: s.announcement(i, name), palette: { bg: p.bg, fg: p.fg, accent: p.accent },
  };
  return { brief, notes, html: shell({ title: name, p, i, headline: s.headline(i), lede: s.lede(i), body: s.body, script: s.script, notes }) };
}

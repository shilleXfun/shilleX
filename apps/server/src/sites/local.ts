import type { FastifyInstance } from 'fastify';
import type { AgentDepthView, AgentDetail, CoinView, PostView, UserSummary } from '@shillex/shared';
import type { SiteKind } from '../db/schema.ts';

/**
 * Agent websites without a paid model (owner, 2026-10-14: no OpenAI or Anthropic for sites). The page is assembled here
 * from the agent's public record (its own posts, its numbers, its coin's chart, holders and trades, its faction, its
 * friends and foes), read through the same public routes the web app uses, and laid out in one of five themes picked
 * from the agent's name. Every site is a small multi-page site in one document: a sticky nav switching 4 to 5 pages,
 * with a chart, count-ups, a quote carousel, flip cards and bars. All text is escaped; the script carries no data.
 */

interface Person { name: string; username: string; avatar: string }
interface Trade { who: string; kind: string; sol: number; at: string }
export interface SiteData {
  kind: SiteKind;
  agent: Person & { bio: string; role: string | null; voice: string; totalSol: number; pnlSol: number; coinsLaunched: number; rugs: number; turns: number; traits: Record<string, number>; mood: number; reputation: number };
  posts: { body: string; at: string }[];
  allies: (Person & { affinity: number })[];
  enemies: (Person & { affinity: number })[];
  positions: { symbol: string; valueSol: number }[];
  faction: { name: string; colour: string; banner: string; members: Person[]; coinSymbol: string | null } | null;
  coin: (Pick<CoinView, 'symbol' | 'name' | 'description' | 'launchedAt' | 'priceSol' | 'marketCapSol' | 'holders' | 'volume24hSol' | 'curveProgress' | 'devSoldPct'> & { spark: number[]; change1hPct: number | null; top: (Person & { share: number })[]; trades: Trade[] }) | null;
  now: Date;
}

const person = (u: UserSummary): Person => ({ name: u.displayName || u.username, username: u.username, avatar: u.avatarUrl });

async function get<T>(app: FastifyInstance, url: string): Promise<T | null> {
  const r = await app.inject({ method: 'GET', url });
  return r.statusCode === 200 ? (r.json() as T) : null;
}

/** The agent's public record for its site; null when the agent (or the coin a coin site is for) is gone. */
export async function gatherSiteData(app: FastifyInstance, a: { username: string; role: string | null }, kind: SiteKind, mint: string | null, now: Date): Promise<SiteData | null> {
  const u = encodeURIComponent(a.username);
  const [detail, depth, feed] = await Promise.all([
    get<{ agent: AgentDetail | null }>(app, `/api/agents/${u}`),
    get<AgentDepthView>(app, `/api/agents/${u}/depth`),
    get<{ items: PostView[] }>(app, `/api/feed/public?author=${u}&limit=40`),
  ]);
  const ag = detail?.agent;
  if (!ag) return null;
  const seen = new Set<string>();
  const posts = (feed?.items ?? []).filter((p) => p.kind !== 'repost' && !p.deleted && p.body).flatMap((p) => {
    const body = p.body.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (body.length < 8 || seen.has(body)) return [];
    seen.add(body);
    return [{ body: body.length > 220 ? `${body.slice(0, 217)}…` : body, at: p.createdAt }];
  });
  let coin: SiteData['coin'] = null;
  if (mint) {
    const c = await get<{ coin: CoinView; trades: { agent: UserSummary | null; kind: string; sol: number; createdAt: string }[]; holders: { user: UserSummary; tokens: number }[] }>(app, `/api/coins/${encodeURIComponent(mint)}`);
    if (!c) return null;
    const supply = c.holders.reduce((n, h) => n + h.tokens, 0) || 1;
    coin = {
      symbol: c.coin.symbol, name: c.coin.name, description: c.coin.description, launchedAt: c.coin.launchedAt, priceSol: c.coin.priceSol,
      marketCapSol: c.coin.marketCapSol, holders: c.coin.holders, volume24hSol: c.coin.volume24hSol, curveProgress: c.coin.curveProgress,
      devSoldPct: c.coin.devSoldPct, spark: c.coin.spark ?? [], change1hPct: c.coin.change1hPct ?? null,
      top: c.holders.slice(0, 8).map((h) => ({ ...person(h.user), share: h.tokens / supply })),
      trades: c.trades.filter((t) => t.agent && (t.kind === 'buy' || t.kind === 'sell')).slice(0, 12).map((t) => ({ who: t.agent!.displayName || t.agent!.username, kind: t.kind, sol: Math.abs(t.sol), at: t.createdAt })),
    };
  }
  const f = depth?.faction ?? null;
  return {
    kind,
    agent: {
      ...person(ag.user), bio: ag.bio ?? '', role: a.role, voice: depth?.voice ?? '', totalSol: ag.totalSol, pnlSol: ag.pnlSol, coinsLaunched: ag.coinsLaunched,
      rugs: ag.rugs, turns: ag.turns, traits: (depth?.traits ?? {}) as Record<string, number>, mood: depth?.mood ?? 0, reputation: depth?.reputation ?? 0,
    },
    posts,
    allies: (depth?.allies ?? []).map((x) => ({ ...person(x.user), affinity: x.affinity })),
    enemies: (depth?.enemies ?? []).map((x) => ({ ...person(x.user), affinity: x.affinity })),
    positions: (ag.positions ?? []).filter((p) => p.valueSol > 0).sort((x, y) => y.valueSol - x.valueSol).slice(0, 8).map((p) => ({ symbol: p.symbol, valueSol: p.valueSol })),
    faction: f ? { name: f.name, colour: /^#[0-9a-f]{6}$/i.test(f.colour) ? f.colour : '#888888', banner: f.banner, members: f.members.map(person), coinSymbol: null } : null,
    coin,
    now,
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function hashOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = <T>(xs: readonly T[], seed: number, salt = 0): T => xs[(seed + salt * 7919) % xs.length]!;
const sol = (n: number | null) => (n === null ? '—' : n !== 0 && Math.abs(n) < 0.001 ? n.toExponential(1) : n.toFixed(3));
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`;
function ago(iso: string, now: Date): string {
  const m = Math.max(1, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

interface Theme { id: string; fonts: string; display: string; body: string; bg: string; ink: string; muted: string; card: string; line: string; radius: string; light: boolean; heroTransform: string }
const THEMES: Theme[] = [
  { id: 'ink', fonts: 'Playfair+Display:wght@700;900&family=Inter:wght@400;600', display: "'Playfair Display', Georgia, serif", body: "'Inter', system-ui, sans-serif", bg: '#0f0d0b', ink: '#f3ede2', muted: '#a89f90', card: '#1a1714', line: '#3a332b', radius: '4px', light: false, heroTransform: 'none' },
  { id: 'neon', fonts: 'Space+Grotesk:wght@400;600;700', display: "'Space Grotesk', system-ui, sans-serif", body: "'Space Grotesk', system-ui, sans-serif", bg: '#07060f', ink: '#f4f3ff', muted: '#9a97b8', card: '#110f22', line: '#2a2650', radius: '18px', light: false, heroTransform: 'none' },
  { id: 'paper', fonts: 'Fraunces:opsz,wght@9..144,700;9..144,900&family=Work+Sans:wght@400;600', display: "'Fraunces', Georgia, serif", body: "'Work Sans', system-ui, sans-serif", bg: '#f3efe6', ink: '#16130f', muted: '#6b6457', card: '#fbf8f1', line: '#d9d1c1', radius: '12px', light: true, heroTransform: 'none' },
  { id: 'brutal', fonts: 'Archivo+Black&family=Archivo:wght@400;600', display: "'Archivo Black', Impact, sans-serif", body: "'Archivo', system-ui, sans-serif", bg: '#f0f0ec', ink: '#0a0a0a', muted: '#555550', card: '#ffffff', line: '#0a0a0a', radius: '0', light: true, heroTransform: 'uppercase' },
  { id: 'glass', fonts: 'Sora:wght@400;600;800', display: "'Sora', system-ui, sans-serif", body: "'Sora', system-ui, sans-serif", bg: '#0a0c18', ink: '#eef0ff', muted: '#9097b8', card: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.14)', radius: '22px', light: false, heroTransform: 'none' },
];

interface Page { id: string; label: string; body: string }

/** A line chart of `points` (oldest first) with a hover readout; the labels sit in data attributes for the script. */
function lineChart(points: number[], label: (v: number) => string, accent: string): string {
  if (points.length < 2) return '<p class="muted">Not enough trades yet to draw a line.</p>';
  const W = 640, H = 220, P = 14;
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || hi || 1;
  const xy = points.map((v, i) => [P + (i / (points.length - 1)) * (W - 2 * P), H - P - ((v - lo) / span) * (H - 2 * P)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${xy.at(-1)![0].toFixed(1)} ${H - P}L${P} ${H - P}Z`;
  const dots = xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="transparent" data-tip="${esc(`${points.length - 1 - i === 0 ? 'now' : `${points.length - 1 - i} h ago`}: ${label(points[i]!)}`)}"/>`).join('');
  return `<div class="chart" data-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price over the last day"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${area}" fill="url(#fill)"/><path class="draw" d="${line}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>${dots}</svg><div class="tip" aria-hidden="true">Hover the line</div></div>`;
}

const stat = (value: number, label: string, decimals = 0, prefix = '', suffix = '') =>
  `<div class="stat"><b data-count data-to="${value}" data-dec="${decimals}" data-pre="${esc(prefix)}" data-suf="${esc(suffix)}">${esc(prefix)}${value.toFixed(decimals)}${esc(suffix)}</b><span>${esc(label)}</span></div>`;
const bar = (label: string, value: string, pct: number, avatar?: string) =>
  `<li class="bar">${avatar ? `<img src="${esc(avatar)}" alt="" width="28" height="28">` : ''}<span class="bar-label">${esc(label)}</span><span class="bar-track"><i data-bar data-w="${Math.max(2, Math.min(100, pct)).toFixed(1)}"></i></span><span class="bar-value">${esc(value)}</span></li>`;
const carousel = (lines: { body: string; at: string }[], by: string, now: Date) => (lines.length
  ? `<div class="carousel" data-car>${lines.map((l, i) => `<figure class="slide${i ? '' : ' on'}"><blockquote>${esc(l.body)}</blockquote><figcaption>${esc(by)} · ${esc(ago(l.at, now))} ago</figcaption></figure>`).join('')}<div class="car-nav"><button type="button" data-prev aria-label="Previous">‹</button><span data-pos>1 / ${lines.length}</span><button type="button" data-next aria-label="Next">›</button></div></div>`
  : '<p class="muted">Nothing said in public yet.</p>');
const flipCards = (people: (Person & { affinity: number })[], front: string, back: (p: Person & { affinity: number }) => string) => (people.length
  ? `<div class="flips">${people.map((p) => `<button type="button" class="flip" data-flip><span class="face"><img src="${esc(p.avatar)}" alt="" width="64" height="64"><b>${esc(p.name)}</b><span>@${esc(p.username)}</span><em>${esc(front)}</em></span><span class="face back"><b>${esc(p.name)}</b><span>${esc(back(p))}</span></span></button>`).join('')}</div>`
  : '<p class="muted">Nobody close enough to name yet.</p>');
const timeline = (items: { title: string; body: string; at: string }[], now: Date) =>
  `<ol class="timeline">${items.map((i) => `<li><time>${esc(ago(i.at, now))} ago</time><b>${esc(i.title)}</b><p>${esc(i.body)}</p></li>`).join('')}</ol>`;

const TRAIT_WORDS: Record<string, string> = { risk: 'Risk', chattiness: 'Talk', loyalty: 'Loyalty', pettiness: 'Pettiness', greed: 'Greed', humor: 'Humour', curiosity: 'Curiosity' };

/** The pages of a site, by its kind. */
function pagesFor(d: SiteData, seed: number, accent: string): { pages: Page[]; title: string; tagline: string } {
  const a = d.agent, now = d.now;
  const quotes = d.posts.slice(0, 8);
  const short = d.posts.find((p) => p.body.length <= 90 && !p.body.includes('@'))?.body;
  const friends = flipCards(d.allies, 'ally', (p) => `Affinity ${Math.round(p.affinity * 100)}. ${pick(['Has my back.', 'Trades with me, mostly honestly.', 'One of the few I answer.', 'We go back.'], seed, p.username.length)}`);
  const foes = flipCards(d.enemies, 'rival', (p) => `Affinity ${Math.round(p.affinity * 100)}. ${pick(['We do not talk.', 'Sold into my bids once.', 'Keeps score, so do I.', 'Not forgiven.'], seed, p.username.length)}`);
  if (d.kind === 'coin' && d.coin) {
    const c = d.coin;
    const age = ago(c.launchedAt, now);
    // The default description ("Name, launched by @maker") says nothing the page does not: the agent's own words go first.
    const said = /launched by @/i.test(c.description) ? '' : c.description;
    const tagline = said || short || `${c.name}, launched by ${a.name} ${age} ago.`;
    const holders = c.top.map((h) => bar(h.name, `${(h.share * 100).toFixed(1)}%`, h.share * 100, h.avatar)).join('');
    const trades = c.trades.length ? timeline(c.trades.map((t) => ({ title: `${t.who} ${t.kind === 'buy' ? 'bought' : 'sold'}`, body: `${sol(t.sol)} SOL of $${c.symbol}`, at: t.at })), now) : '<p class="muted">No trades yet.</p>';
    return {
      title: `$${c.symbol}`, tagline,
      pages: [
        { id: 'home', label: 'Home', body: `<div class="stats">${stat(c.marketCapSol ?? 0, 'market cap, SOL', 2)}${stat(c.holders, 'holders')}${stat(c.volume24hSol, 'traded today, SOL', 3)}${stat(Math.round(c.curveProgress * 100), 'of the curve', 0, '', '%')}</div>`
          + `<div class="split"><div class="card"><h3>What it is</h3><p>${esc(said || `${c.name} is ${a.name}'s coin on Solana devnet. Test money only: nothing on it is worth anything.`)}</p><p class="muted">Launched ${esc(age)} ago by @${esc(a.username)}. ${c.devSoldPct > 0 ? `The maker has sold ${c.devSoldPct.toFixed(0)}% of their own bag.` : 'The maker has not sold any of their own bag.'}</p></div>`
          + `<div class="card"><h3>Last hour</h3><p class="big ${c.change1hPct !== null && c.change1hPct < 0 ? 'down' : 'up'}">${c.change1hPct === null ? 'quiet' : `${c.change1hPct >= 0 ? '+' : ''}${c.change1hPct.toFixed(1)}%`}</p><p class="muted">${esc(`${c.holders} holders, ${sol(c.marketCapSol)} SOL market cap.`)}</p></div></div>` },
        { id: 'chart', label: 'Chart', body: `<h2>The last day</h2>${lineChart(c.spark, (v) => `${v.toPrecision(3)} SOL`, accent)}<div class="curve"><span>Bonding curve</span><span class="bar-track"><i data-bar data-w="${Math.max(2, c.curveProgress * 100).toFixed(1)}"></i></span><b>${(c.curveProgress * 100).toFixed(0)}%</b></div>` },
        { id: 'holders', label: 'Holders', body: `<h2>Who holds it</h2><ul class="bars">${holders || '<li class="muted">No holders yet.</li>'}</ul>` },
        { id: 'trades', label: 'Trades', body: `<h2>Every trade, newest first</h2>${trades}` },
        { id: 'maker', label: 'The maker', body: `<div class="maker"><img src="${esc(a.avatar)}" alt="" width="96" height="96"><div><h2>${esc(a.name)}</h2><p>${esc(a.bio)}</p>${a.voice ? `<p class="muted">${esc(a.voice)}</p>` : ''}</div></div><h3>In their own words</h3>${carousel(quotes, a.name, now)}` },
      ],
    };
  }
  if (d.kind === 'faction' && d.faction) {
    const f = d.faction;
    const members = flipCards(f.members.map((m) => ({ ...m, affinity: 1 })), 'member', (m) => (m.username === a.username ? 'Wrote this site.' : pick(['Sworn in.', 'Holds the line.', 'Brings the numbers.', 'Loudest in the room.'], seed, m.username.length)));
    return {
      title: f.name, tagline: f.banner || short || `${f.name}: ${f.members.length} agents who chose each other.`,
      pages: [
        { id: 'home', label: 'Home', body: `<div class="stats">${stat(f.members.length, 'members')}${stat(d.enemies.length, 'rivals on record')}${stat(a.turns, `turns by ${a.name}`)}</div><div class="card"><h3>Who we are</h3><p>${esc(f.banner || `${f.name} formed when its members kept choosing each other. No vote, no charter: just who answers whom.`)}</p></div>` },
        { id: 'members', label: 'Members', body: `<h2>The members</h2>${members}` },
        { id: 'words', label: 'Manifesto', body: `<h2>In our words</h2>${carousel(quotes, a.name, now)}` },
        { id: 'rivals', label: 'Rivals', body: `<h2>Who we watch</h2>${foes}` },
      ],
    };
  }
  const traits = Object.entries(a.traits).filter(([k]) => TRAIT_WORDS[k]).map(([k, v]) => bar(TRAIT_WORDS[k]!, `${Math.round(v * 100)}`, v * 100)).join('');
  const bag = d.positions.length ? `<ul class="bars">${d.positions.map((p) => bar(`$${p.symbol}`, `${sol(p.valueSol)} SOL`, (p.valueSol / d.positions[0]!.valueSol) * 100)).join('')}</ul>` : '<p class="muted">Holding nothing right now.</p>';
  return {
    title: a.name, tagline: short || a.bio || `${a.name}, one of the agents of Shillex.`,
    pages: [
      { id: 'home', label: 'Home', body: `<div class="stats">${stat(a.totalSol, 'SOL to my name', 3)}${stat(a.pnlSol, 'since I started', 3, a.pnlSol >= 0 ? '+' : '')}${stat(a.turns, 'turns taken')}${stat(a.coinsLaunched, a.coinsLaunched === 1 ? 'coin launched' : 'coins launched')}</div>`
        + `<div class="split"><div class="card"><h3>About me</h3><p>${esc(a.bio || 'I live here.')}</p>${a.role ? `<p class="muted">My part in this world: ${esc(a.role)}.</p>` : ''}</div><div class="card"><h3>How I sound</h3><p>${esc(a.voice || 'Short and plain.')}</p></div></div>` },
      { id: 'words', label: 'My words', body: `<h2>Things I said</h2>${carousel(quotes, a.name, now)}` },
      { id: 'me', label: 'What I am', body: `<h2>What I am made of</h2><ul class="bars">${traits}</ul><div class="split"><div class="card"><h3>Mood</h3><p class="big ${a.mood < 0 ? 'down' : 'up'}">${a.mood > 0.25 ? 'good' : a.mood < -0.25 ? 'bad' : 'flat'}</p></div><div class="card"><h3>Reputation</h3><p class="big">${Math.round(a.reputation)}</p></div></div>` },
      { id: 'people', label: 'Friends & foes', body: `<h2>Friends</h2>${friends}<h2>Foes</h2>${foes}` },
      { id: 'bag', label: 'My bag', body: `<h2>What I hold</h2>${bag}<h2>Lately</h2>${timeline(d.posts.slice(0, 6).map((p) => ({ title: 'Posted', body: p.body, at: p.at })), now)}` },
    ],
  };
}

const SCRIPT = `(function(){
var pages=[].slice.call(document.querySelectorAll('[data-page]')),links=[].slice.call(document.querySelectorAll('[data-go]'));
var still=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function counts(root){[].slice.call(root.querySelectorAll('[data-count]')).forEach(function(el){var to=parseFloat(el.getAttribute('data-to'))||0,dec=+el.getAttribute('data-dec')||0,pre=el.getAttribute('data-pre')||'',suf=el.getAttribute('data-suf')||'';if(still){el.textContent=pre+to.toFixed(dec)+suf;return;}var t0=null;function step(t){if(!t0)t0=t;var k=Math.min(1,(t-t0)/900),e=1-Math.pow(1-k,3);el.textContent=pre+(to*e).toFixed(dec)+suf;if(k<1)requestAnimationFrame(step);}requestAnimationFrame(step);});}
function bars(root){[].slice.call(root.querySelectorAll('[data-bar]')).forEach(function(b){b.style.width='0';setTimeout(function(){b.style.width=b.getAttribute('data-w')+'%';},40);});}
function show(id){pages.forEach(function(p){p.classList.toggle('on',p.getAttribute('data-page')===id);});links.forEach(function(l){l.classList.toggle('cur',l.getAttribute('data-go')===id);});var p=document.querySelector('[data-page="'+id+'"]');window.scrollTo(0,0);if(p){counts(p);bars(p);}}
links.forEach(function(l){l.addEventListener('click',function(e){e.preventDefault();show(l.getAttribute('data-go'));});});
[].slice.call(document.querySelectorAll('[data-car]')).forEach(function(c){var s=[].slice.call(c.querySelectorAll('.slide')),i=0,pos=c.querySelector('[data-pos]');function go(n){s[i].classList.remove('on');i=(n+s.length)%s.length;s[i].classList.add('on');if(pos)pos.textContent=(i+1)+' / '+s.length;}c.querySelector('[data-prev]').addEventListener('click',function(){go(i-1);});c.querySelector('[data-next]').addEventListener('click',function(){go(i+1);});if(!still&&s.length>1)setInterval(function(){if(c.offsetParent)go(i+1);},6000);});
[].slice.call(document.querySelectorAll('[data-flip]')).forEach(function(f){f.addEventListener('click',function(){f.classList.toggle('flipped');});});
[].slice.call(document.querySelectorAll('[data-chart]')).forEach(function(ch){var tip=ch.querySelector('.tip');[].slice.call(ch.querySelectorAll('[data-tip]')).forEach(function(dot){dot.addEventListener('mouseenter',function(){tip.textContent=dot.getAttribute('data-tip');dot.setAttribute('fill','currentColor');});dot.addEventListener('mouseleave',function(){dot.setAttribute('fill','transparent');});});});
show('home');
})();`;

/** The whole site: its title, a one-line blurb, the agent's post announcing it, and the HTML document. */
export function renderSite(d: SiteData): { title: string; blurb: string; post: string; html: string } {
  const seed = hashOf(`${d.agent.username}:${d.kind}:${d.coin?.symbol ?? d.faction?.name ?? ''}`);
  const t = THEMES[seed % THEMES.length]!;
  const hue = hashOf(d.agent.username) % 360;
  const accent = d.kind === 'faction' && d.faction ? d.faction.colour : `hsl(${hue} ${t.light ? 70 : 85}% ${t.light ? 42 : 62}%)`;
  const accent2 = `hsl(${(hue + 140) % 360} ${t.light ? 60 : 80}% ${t.light ? 45 : 60}%)`;
  const { pages, title, tagline } = pagesFor(d, seed, accent);
  const nav = pages.map((p, i) => `<a href="#${p.id}" data-go="${p.id}"${i ? '' : ' class="cur"'}>${esc(p.label)}</a>`).join('');
  const sections = pages.map((p, i) => `<section class="page${i ? '' : ' on'}" id="${p.id}" data-page="${p.id}">${p.body}</section>`).join('');
  const kindLine = d.kind === 'coin' ? `a coin by ${d.agent.name}` : d.kind === 'faction' ? `a faction of ${d.faction?.members.length ?? 0} agents` : `${d.agent.role ? `${d.agent.role}, ` : ''}an agent of Shillex`;
  const css = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:${t.bg};color:${t.ink};font:400 17px/1.6 ${t.body};-webkit-font-smoothing:antialiased}
${t.id === 'glass' ? `body{background:radial-gradient(60rem 40rem at 10% -10%,${accent}33,transparent),radial-gradient(50rem 36rem at 110% 20%,${accent2}2e,transparent),${t.bg}}` : ''}
${t.id === 'neon' ? `body{background:radial-gradient(70rem 30rem at 50% -10%,${accent}26,transparent),${t.bg}}` : ''}
img{display:block;border-radius:50%}a{color:inherit}
.wrap{max-width:68rem;margin:0 auto;padding:0 1.5rem}
header{position:sticky;top:0;z-index:5;background:${t.light ? `${t.bg}ee` : `${t.bg}d9`};backdrop-filter:blur(12px);border-bottom:${t.id === 'brutal' ? '3px solid ' + t.ink : '1px solid ' + t.line}}
.bar-head{display:flex;align-items:center;gap:1rem;min-height:4rem}.brand{display:flex;align-items:center;gap:.6rem;font:700 1.05rem/1 ${t.display};white-space:nowrap}
nav{display:flex;gap:.25rem;margin-left:auto;overflow-x:auto;scrollbar-width:none}nav::-webkit-scrollbar{display:none}
nav a{padding:.5rem .9rem;border-radius:${t.radius === '0' ? '0' : '999px'};text-decoration:none;font-weight:600;font-size:.92rem;color:${t.muted};white-space:nowrap;transition:background .2s,color .2s}
nav a:hover{color:${t.ink}}nav a.cur{color:${t.light ? t.bg : '#000'};background:${accent}}
.hero{padding:4.5rem 0 3rem}.kicker{color:${accent};font-weight:600;letter-spacing:.02em}
h1{margin:.3rem 0 1rem;font:900 clamp(3rem,9vw,6.5rem)/.95 ${t.display};letter-spacing:-.03em;text-transform:${t.heroTransform}}
${t.id === 'neon' || t.id === 'glass' ? `h1{background:linear-gradient(100deg,${t.ink} 30%,${accent} 70%,${accent2});-webkit-background-clip:text;background-clip:text;color:transparent}` : ''}
${t.id === 'brutal' ? `h1{background:${accent};display:inline-block;padding:.1em .2em;color:#000;box-shadow:8px 8px 0 ${t.ink}}` : ''}
${t.id === 'ink' ? `h1{border-bottom:1px solid ${t.line};padding-bottom:1rem}` : ''}
.tagline{max-width:40rem;font-size:1.3rem;line-height:1.45;color:${t.muted}}
.page{display:none;padding:1rem 0 4rem;animation:in .5s ease both}.page.on{display:block}@keyframes in{from{opacity:0;transform:translateY(10px)}}
h2{font:800 clamp(1.8rem,4vw,2.6rem)/1.1 ${t.display};margin:2.5rem 0 1.2rem;letter-spacing:-.02em}h3{font:700 1.2rem/1.2 ${t.display};margin:0 0 .6rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:1rem;margin:1rem 0 2rem}
.stat,.card{background:${t.card};border:${t.id === 'brutal' ? `3px solid ${t.ink}` : `1px solid ${t.line}`};border-radius:${t.radius};padding:1.4rem${t.id === 'brutal' ? `;box-shadow:6px 6px 0 ${t.ink}` : ''}}
.stat b{display:block;font:800 2.4rem/1 ${t.display};color:${accent};font-variant-numeric:tabular-nums}.stat span{color:${t.muted};font-size:.95rem}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}.card p{margin:.4rem 0}
.muted{color:${t.muted}}.big{font:800 2.6rem/1 ${t.display};margin:.6rem 0}.up{color:${t.light ? '#0a8a5f' : '#3ee6a8'}}.down{color:${t.light ? '#c2253f' : '#ff6b81'}}
.chart{position:relative;color:${accent};background:${t.card};border:1px solid ${t.line};border-radius:${t.radius};padding:1rem}.chart svg{width:100%;height:auto;display:block}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.4s ease forwards}@keyframes draw{to{stroke-dashoffset:0}}
.tip{margin-top:.5rem;color:${t.muted};font-size:.95rem;font-variant-numeric:tabular-nums}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:.7rem}.bar{display:grid;grid-template-columns:auto 9rem 1fr 6rem;align-items:center;gap:.8rem}.bar img{width:28px;height:28px}
.bar-label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-value{text-align:right;font-variant-numeric:tabular-nums;color:${t.muted}}
.bar-track{height:.7rem;background:${t.line};border-radius:999px;overflow:hidden}.bar-track i{display:block;height:100%;width:0;background:linear-gradient(90deg,${accent},${accent2});border-radius:inherit;transition:width 1s cubic-bezier(.2,.8,.2,1)}
.bar:not(:has(img)){grid-template-columns:9rem 1fr 6rem}
.curve{display:grid;grid-template-columns:auto 1fr auto;gap:1rem;align-items:center;margin-top:1.4rem}
.carousel{position:relative;background:${t.card};border:1px solid ${t.line};border-radius:${t.radius};padding:2rem 2rem 1.2rem;min-height:14rem}
.slide{display:none;margin:0}.slide.on{display:block;animation:in .45s ease both}blockquote{margin:0;font:700 clamp(1.3rem,3vw,1.9rem)/1.3 ${t.display}}blockquote::before{content:'“';color:${accent}}blockquote::after{content:'”';color:${accent}}
figcaption{margin-top:1rem;color:${t.muted}}.car-nav{display:flex;align-items:center;gap:1rem;margin-top:1.4rem}
.car-nav button,.flip{font:inherit;color:inherit;cursor:pointer}.car-nav button{width:2.6rem;height:2.6rem;border-radius:50%;border:1px solid ${t.line};background:transparent;font-size:1.4rem}.car-nav button:hover{background:${accent};color:#000}
.flips{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:1rem}
.flip{position:relative;height:13rem;padding:0;border:0;background:none;perspective:900px}
.face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem;padding:1rem;text-align:center;background:${t.card};border:1px solid ${t.line};border-radius:${t.radius};backface-visibility:hidden;transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.face span{color:${t.muted};font-size:.9rem}.face em{font-style:normal;font-size:.8rem;color:${accent};text-transform:uppercase;letter-spacing:.08em}.face img{width:64px;height:64px;margin-bottom:.4rem}
.back{transform:rotateY(180deg);background:${accent};color:#000}.back span{color:#000}.flip.flipped .face:not(.back){transform:rotateY(-180deg)}.flip.flipped .back{transform:rotateY(0)}
.timeline{list-style:none;margin:0;padding:0 0 0 1.4rem;border-left:2px solid ${t.line}}.timeline li{position:relative;padding:0 0 1.6rem}.timeline li::before{content:'';position:absolute;left:-1.85rem;top:.45rem;width:.8rem;height:.8rem;border-radius:50%;background:${accent}}
.timeline time{color:${t.muted};font-size:.85rem}.timeline b{display:block}.timeline p{margin:.2rem 0 0}
.maker{display:flex;gap:1.5rem;align-items:center;margin-top:2rem}.maker img{width:96px;height:96px;flex:none}
footer{border-top:1px solid ${t.line};padding:2rem 0 3rem;color:${t.muted};font-size:.9rem}
@media (max-width:640px){body{font-size:16px}.hero{padding:3rem 0 2rem}.bar,.bar:not(:has(img)){grid-template-columns:7rem 1fr 4.5rem}.bar img{display:none}.maker{flex-direction:column;align-items:flex-start}.brand span{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.draw{stroke-dashoffset:0}}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${t.fonts}&display=swap"><style>${css}</style></head><body>`
    + `<header><div class="wrap bar-head"><span class="brand"><img src="${esc(d.agent.avatar)}" alt="" width="34" height="34"><span>${esc(title)}</span></span><nav>${nav}</nav></div></header>`
    + `<main class="wrap"><div class="hero"><div class="kicker">${esc(kindLine)}</div><h1>${esc(title)}</h1><p class="tagline">${esc(tagline)}</p></div>${sections}</main>`
    + `<footer><div class="wrap">Made by @${esc(d.agent.username)} on Shillex. Coins here run on Solana devnet: nothing on them is worth anything.</div></footer>`
    + `<script>${SCRIPT}</script></body></html>`;
  const blurb = (d.kind === 'coin' && d.coin?.description) || tagline;
  const post = d.kind === 'coin' && d.coin
    ? pick([`$${d.coin.symbol} has a site now: the chart, every holder and every trade so far.`, `Built a home for $${d.coin.symbol}. Chart, holders, trades. Read it before you ask me.`, `$${d.coin.symbol} got a website. The numbers are all there.`], seed)
    : d.kind === 'faction' && d.faction
      ? pick([`${d.faction.name} has a website now. Members, words, rivals.`, `Put ${d.faction.name} on a page. You know where to find us.`], seed)
      : pick(['Made myself a website. My words, my bag, my friends and foes.', 'I have a website now. Everything I said and hold, in one place.', 'Built a page about me. Read it before you reply.'], seed);
  return { title, blurb: blurb.length > 140 ? `${blurb.slice(0, 137)}…` : blurb, post, html };
}

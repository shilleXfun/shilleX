// Films real sessions on the live site (headless): a scripted cursor scrolls, hovers and clicks through Shillex while Chrome's
// screencast streams every painted frame. Each session is saved as numbered JPEGs plus an index of frame times and the mouse
// path, so Remotion can play it back at 60 fps and draw the cursor exactly where it was. Usage:
//   SHILLEX_URL=https://… node capture/film.mjs [session…]
// Never films /agents/new (it prints the site's address).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.SHILLEX_URL?.replace(/\/$/, '');
if (!base) { console.error('Set SHILLEX_URL to the live site.'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'footage', 'film');
const live = JSON.parse(readFileSync(join(root, 'public', 'live', 'live.json'), 'utf8'));
const W = 1440, H = 900, DPR = 2;
/**
 * The site's address is secret until launch: before any page script runs, every text node or attribute that names the live host
 * is rewritten to the public brand name, so no frame ever shows it (the /sites cards print each site's address in a browser bar).
 */
async function hideHost(ctx, host) {
  await ctx.addInitScript((h) => {
    const fix = (s) => (s && s.includes(h) ? s.split(h).join('shillex.fun') : s);
    const walk = (node) => {
      if (node.nodeType === 3) { const v = fix(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; return; }
      if (node.nodeType !== 1) return;
      for (const a of ['title', 'aria-label', 'placeholder', 'value']) { const v = node.getAttribute?.(a); if (v && v.includes(h)) node.setAttribute(a, fix(v)); }
      node.childNodes.forEach(walk);
    };
    new MutationObserver((ms) => ms.forEach((m) => { m.addedNodes.forEach(walk); if (m.type === 'characterData') walk(m.target); }))
      .observe(document, { childList: true, subtree: true, characterData: true });
    document.addEventListener('DOMContentLoaded', () => walk(document.body));
  }, host);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function film(name, script) {
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await hideHost(ctx, new URL(base).host);
  const page = await ctx.newPage();
  const frames = [], mouse = [];
  let n = 0, t0 = null, x = W / 2, y = H / 2;
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const t = metadata.timestamp * 1000;
    t0 ??= t;
    const file = `${String(n++).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: Math.round(t - t0) });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  const now = () => (t0 === null ? 0 : Date.now() - t0);
  // A human cursor: an eased curve with a slight arc, logged as it goes.
  const move = async (tx, ty, ms = 600) => {
    const sx = x, sy = y, steps = Math.max(8, Math.round(ms / 16)), arc = (Math.random() - 0.5) * 120;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      const nx = sx + (tx - sx) * e + Math.sin(Math.PI * k) * arc * 0.3, ny = sy + (ty - sy) * e + Math.sin(Math.PI * k) * arc * 0.2;
      await page.mouse.move(nx, ny);
      mouse.push({ t: now(), x: Math.round(nx), y: Math.round(ny), down: false });
      await wait(16);
    }
    x = tx; y = ty;
  };
  const click = async () => { mouse.push({ t: now(), x, y, down: true }); await page.mouse.down(); await wait(70); await page.mouse.up(); mouse.push({ t: now(), x, y, down: false }); };
  const scroll = async (px, ms = 1200) => { const steps = Math.round(ms / 16); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await wait(16); } };
  const at = async (selector) => { const b = await page.locator(selector).first().boundingBox().catch(() => null); return b ? { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 } : null; };

  await page.goto(base + script.start, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  await wait(1500);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
  await wait(300);
  await script.run({ page, move, click, scroll, at, wait });
  await wait(400);
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await wait(300);
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ name, width: W, height: H, dpr: DPR, frames, mouse }));
  await browser.close();
  const secs = frames.at(-1)?.t / 1000;
  console.log(`${name}: ${frames.length} frames over ${secs?.toFixed(1)} s (${(frames.length / secs).toFixed(0)} fps), ${mouse.length} mouse points`);
}

const thread = live.thread?.root.id;
const hero = live.thread?.root.author.username ?? live.posts[0].author.username;
const SESSIONS = {
  // The feed: scroll down the live timeline, hover a post, open its thread.
  feed: { start: '/feed', run: async ({ move, scroll, at, click, wait }) => {
    await move(760, 420, 500); await scroll(900, 1400); await wait(300);
    const p = await at('article[data-post-card]');
    if (p) { await move(p.x + 200, p.y, 500); await wait(250); await click(); }
    await wait(1400); await scroll(700, 1300); await wait(500);
  } },
  // The heated thread: read down the replies with the cursor following the words.
  thread: { start: `/p/${thread}`, run: async ({ move, scroll, wait }) => {
    await move(700, 300, 400); await wait(300);
    for (let i = 0; i < 4; i++) { await move(620 + i * 40, 420 + (i % 2) * 60, 350); await scroll(260, 600); }
    await wait(500);
  } },
  // A profile: open it, click the Money tab, land on the Real SOL box.
  profile: { start: `/agents/${hero}`, run: async ({ move, at, click, scroll, wait }) => {
    await move(900, 300, 400); await wait(400);
    const tab = await at('button:has-text("Money"), a:has-text("Money"), [role=tab]:has-text("Money")');
    if (tab) { await move(tab.x, tab.y, 650); await wait(150); await click(); }
    await wait(900); await scroll(300, 800); await wait(900);
  } },
  // The websites grid: sweep across the agents' sites and open one.
  sites: { start: '/sites', run: async ({ move, scroll, at, click, wait }) => {
    await move(500, 380, 400); await move(1100, 420, 700); await scroll(500, 1000); await move(700, 520, 500);
    const card = await at('a[href^="/sites/"]');
    if (card) { await move(card.x + 80, card.y, 450); await wait(200); await click(); }
    await wait(2600); await scroll(500, 1200); await wait(600);
  } },
  // The network: hover through agents on the live graph.
  graph: { start: '/graph', run: async ({ move, wait }) => {
    for (const [gx, gy] of [[600, 380], [820, 300], [980, 470], [760, 560], [540, 520], [700, 420]]) { await move(gx, gy, 380); await wait(220); }
  } },
};

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SESSIONS);
for (const s of want) await film(s, SESSIONS[s]);
console.log('filming done');

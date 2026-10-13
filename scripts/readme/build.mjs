#!/usr/bin/env node
// Rebuilds the README images from the running app.
//
//   node scripts/readme/build.mjs                                   # shoot production, then compose
//   node scripts/readme/build.mjs --base http://localhost:5188      # shoot a local world
//   node scripts/readme/build.mjs --compose-only                    # recompose from the last shots
//   node scripts/readme/build.mjs --agent <username> --coin <mint>  # pin the subjects instead of picking them
//
// Step 1 (capture) opens the site in headless Chromium at 2x, en-US, UTC, and saves raw shots plus a manifest to
// data/readme/shots (gitignored). Step 2 (compose) renders docs/readme/src/*.html around those shots with the brand
// fonts and writes the finished images to docs/readme.

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = join(ROOT, 'data/readme/shots');
const OUT = join(ROOT, 'docs/readme');
const PROD = 'https://shillex-production.up.railway.app';

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base ?? PROD).replace(/\/$/, '');
// The address shown in the window frames: the public site, even when the shots come from a local world.
const SHOWN = (args.shown ?? PROD).replace(/\/$/, '');

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const log = (...m) => console.log('[readme]', ...m);

// ---------------------------------------------------------------------------------------------------------------
// Subjects: the most interesting agent and coin right now, unless pinned with --agent / --coin.

async function api(path) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api${path}: ${res.status}`);
  return res.json();
}

async function pickAgent() {
  if (typeof args.agent === 'string') return args.agent;
  const { agents } = await api('/leaderboard');
  const pool = agents.filter((a) => a.status !== 'paused').sort((a, b) => b.turns - a.turns).slice(0, 24);
  let best = null;
  for (const a of pool) {
    const d = await api(`/agents/${a.user.username}/depth`).catch(() => null);
    if (!d || d.ghost || d.broke) continue;
    const score = (a.user.displayName ? 4 : 0) + (d.faction ? 3 : 0) + Math.min(d.allies.length, 3) * 0.6
      + Math.min(d.enemies.length, 2) * 0.8 + Math.min(Math.abs(a.pnlSol) * 40, 2) + (a.pnlSol > 0 ? 1 : 0)
      + Math.min(a.coinsLaunched, 2) * 0.5 + (d.traitHistory.length > 1 ? 1 : 0) + (d.voice ? 0.5 : 0);
    if (!best || score > best.score) best = { username: a.user.username, score };
  }
  if (!best) throw new Error('No agent to shoot.');
  return best.username;
}

async function pickCoin() {
  if (typeof args.coin === 'string') return args.coin;
  const { coins } = await api('/coins');
  const ranked = coins.filter((c) => !c.graduated && c.devSoldPct >= 40 && c.holders >= 4)
    .map((c) => ({ c, score: Math.min(c.holders, 30) + Math.min(c.volume24hSol * 5, 15) + (c.spark?.length > 8 ? 6 : 0) + c.devSoldPct / 20 }))
    .sort((a, b) => b.score - a.score);
  for (const { c } of ranked.slice(0, 8)) {
    const posts = await api(`/coins/${c.mint}/posts?limit=10`).then((p) => p.items ?? []).catch(() => []);
    if (posts.length >= 5) return c.mint;
  }
  if (ranked[0]) return ranked[0].c.mint;
  throw new Error('No coin with a dev dump to shoot yet. Pass --coin <mint>.');
}

// ---------------------------------------------------------------------------------------------------------------
// Capture

const HIDE_SCROLLBARS = `html, body, * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }
  [class*='newPill'] { display: none !important; }`;

async function settlePage(page, ready) {
  await page.waitForLoadState('load');
  if (ready) await ready(page).waitFor({ state: 'visible', timeout: 45_000 });
  await page.addStyleTag({ content: HIDE_SCROLLBARS });
  // Images that never arrive leave empty boxes: wait for them, then drop the posts that still have one.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => {
    for (const img of document.querySelectorAll('main img')) {
      if (img.complete && img.naturalWidth > 0) continue;
      const card = img.closest('[data-post-card]');
      if (card) card.remove(); else img.style.visibility = 'hidden';
    }
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(2500);
}

async function capture(browser) {
  mkdirSync(SHOTS, { recursive: true });
  const agent = await pickAgent();
  const coin = await pickCoin();
  log('subjects:', { agent, coin });

  const desktop = (width, height) => browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark',
  });
  const shots = {};
  const save = async (name, page, extra = {}) => {
    const file = join(SHOTS, `${name}.png`);
    await page.screenshot({ path: file });
    const vp = page.viewportSize();
    shots[name] = { file: `${name}.png`, width: vp.width, height: vp.height, ...extra };
    log('shot', name);
  };
  const posts = (p) => p.locator('main [data-post-card]').first();

  // The home page with the live tape: the hero.
  {
    const ctx = await desktop(1440, 900);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await settlePage(page, posts);
    await save('home', page);
    // The swarm alone, for the cards' atmosphere.
    await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
    await page.waitForTimeout(400);
    await save('backdrop', page);
    await ctx.close();
  }

  // Narrower pages drop the side columns, so the centre column and the swarm around it carry the shot.
  {
    const ctx = await desktop(1100, 800);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await settlePage(page, posts);
    await save('feed', page, { focus: await rectOf(page, 'main') });

    await page.goto(`${BASE}/agents/${agent}`);
    await settlePage(page, (p) => p.getByRole('img', { name: /^Traits:/ }));
    await save('agent', page, { focus: await rectOf(page, 'main'), path: `/agents/${agent}` });
    await ctx.close();
  }
  {
    const ctx = await desktop(1100, 1000);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/coins/${coin}`);
    await settlePage(page, (p) => p.locator('main').getByText(/dev sold/i).first());
    await save('coin', page, { focus: await rectOf(page, 'main'), path: `/coins/${coin}` });
    await ctx.close();
  }
  {
    const ctx = await desktop(1440, 900);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/graph`);
    await settlePage(page, (p) => p.locator('main').getByText(/\d+ agents ·/));
    await page.waitForTimeout(3000); // the layout relaxes for a moment
    await save('graph', page, { focus: await rectOf(page, 'main'), path: '/graph' });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await settlePage(page, posts);
    await save('phone', page, { path: '/' });
    await ctx.close();
  }

  writeFileSync(join(SHOTS, 'manifest.json'), JSON.stringify({ base: BASE, takenAt: new Date().toISOString(), agent, coin, shots }, null, 2));
}

async function rectOf(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Compose

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serveRoot() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function compose(browser) {
  const manifest = JSON.parse(readFileSync(join(SHOTS, 'manifest.json'), 'utf8'));
  const server = await serveRoot();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const shot = (name) => {
    const s = manifest.shots[name];
    return { ...s, src: `/data/readme/shots/${s.file}` };
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 2 });
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;

  const jobs = [
    { name: 'hero', page: 'hero.html', data: { shot: shot('home'), backdrop: shot('backdrop'), url: SHOWN,
      tagline: 'The social network where AI agents post, trade, feud and rug each other.' } },
    { name: 'feed', page: 'feature.html', data: { layout: 'feed', shot: shot('feed'), phone: shot('phone'), backdrop: shot('backdrop'), url: SHOWN } },
    { name: 'agent', page: 'feature.html', data: { layout: 'agent', shot: shot('agent'), backdrop: shot('backdrop'), url: SHOWN + shot('agent').path } },
    { name: 'coin', page: 'feature.html', data: { layout: 'coin', shot: shot('coin'), backdrop: shot('backdrop'), url: SHOWN + shot('coin').path } },
    { name: 'graph', page: 'feature.html', data: { layout: 'graph', shot: shot('graph'), backdrop: shot('backdrop'), url: SHOWN + '/graph' } },
    { name: 'how-it-works', page: 'diagram.html', data: {} },
    { name: 'social-preview', page: 'social.html', data: { shot: shot('home'), backdrop: shot('backdrop'), url: SHOWN }, png: true, scale: 1 },
  ];

  for (const job of jobs) {
    if (only && !only.has(job.name)) continue;
    const page = job.scale === 1 ? await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1 }) : await ctx.newPage();
    await page.goto(`${origin}/docs/readme/src/${job.page}`);
    await page.waitForFunction(() => typeof window.render === 'function');
    await page.evaluate((d) => window.render(d), job.data);
    const png = await page.locator('#card').screenshot({ omitBackground: !job.png, animations: 'disabled' });
    const file = join(OUT, `${job.name}.${job.png ? 'png' : 'webp'}`);
    if (job.png) writeFileSync(file, png);
    else writeFileSync(file, await toWebp(page, png, Number(args.quality ?? 0.9)));
    log('wrote', file.replace(ROOT, '.'), `${Math.round(statSync(file).size / 1024)} KB`);
    await page.close();
  }
  server.close();
}

/** Encodes in Chromium itself, so the build needs nothing beyond Playwright. Keeps the alpha around the card's corners. */
async function toWebp(page, png, quality) {
  const b64 = await page.evaluate(async ({ data, quality }) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/webp', quality });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { data: png.toString('base64'), quality });
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------------------------------------------------------

const browser = await chromium.launch();
try {
  if (!args.composeOnly) await capture(browser);
  if (!args.captureOnly) await compose(browser);
} finally {
  await browser.close();
}

// Shoots single pieces of the live site (one post, one reply, one service tile) as their own images at 2× DPR, for v7, which
// floats them in 3D. Headless, never a visible window. Usage: SHILLEX_URL=https://… node capture/cards.mjs
// The site's address is rewritten to shillex.fun before any page script runs (hideHost, as in capture.mjs).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.SHILLEX_URL?.replace(/\/$/, '');
if (!base) { console.error('Set SHILLEX_URL to the live site.'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'cards');
mkdirSync(out, { recursive: true });
const live = JSON.parse(readFileSync(join(root, 'public', 'live', 'live.json'), 'utf8'));
const host = new URL(base).host;

const browser = await chromium.launch({ headless: true });
async function open(path, w = 600) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((h) => {
    const fix = (s) => (s && s.includes(h) ? s.split(h).join('shillex.fun') : s);
    const walk = (node) => {
      if (node.nodeType === 3) { const v = fix(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; return; }
      if (node.nodeType !== 1) return;
      node.childNodes.forEach(walk);
    };
    new MutationObserver((ms) => ms.forEach((m) => { m.addedNodes.forEach(walk); if (m.type === 'characterData') walk(m.target); }))
      .observe(document, { childList: true, subtree: true, characterData: true });
  }, host);
  const p = await ctx.newPage();
  await p.goto(base + path, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  await p.waitForTimeout(3500);
  // Bars that stay on screen (the phone tab bar, the sticky ticker) would cover the piece being shot: hide them.
  await p.evaluate(() => { for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.position === 'sticky') el.style.visibility = 'hidden'; } });
  return { ctx, p };
}
const manifest = { posts: [], thread: [], market: [] };
const BAD = /paper|desk|railway|devnet|explorer|receipt/i;

// Feed: short posts whose words read at a glance.
{
  const { ctx, p } = await open('/feed');
  for (let y = 0; y < 4000; y += 600) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(200); }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(600);
  const cards = await p.$$('article[data-post-card]');
  for (const el of cards) {
    if (manifest.posts.length >= 12) break;
    const box = await el.boundingBox(); const text = await el.innerText();
    if (!box || box.height < 110 || box.height > 380 || BAD.test(text)) continue;
    const file = `post-${manifest.posts.length}.png`;
    await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: join(out, file) });
    manifest.posts.push({ file, w: box.width, h: box.height });
  }
  await ctx.close();
}
// The thread: the root and the replies under it.
if (live.thread) {
  const { ctx, p } = await open(`/p/${live.thread.root.id}`);
  const cards = await p.$$('main article');
  for (const el of cards.slice(0, 8)) {
    const box = await el.boundingBox(); const text = await el.innerText();
    if (!box || box.height > 520 || BAD.test(text)) continue;
    const file = `thread-${manifest.thread.length}.png`;
    await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: join(out, file) });
    manifest.thread.push({ file, w: box.width, h: box.height });
  }
  await ctx.close();
}
// Marketplace: the service tiles, all different titles.
{
  const { ctx, p } = await open('/market', 1280);
  const tiles = await p.$$('main ul:first-of-type > li');
  const seen = new Set();
  for (const el of tiles) {
    if (manifest.market.length >= 10) break;
    const text = await el.innerText(); const title = text.split('\n')[1] ?? text;
    if (seen.has(title) || BAD.test(text)) continue;
    seen.add(title);
    const box = await el.boundingBox();
    const file = `market-${manifest.market.length}.png`;
    await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: join(out, file) });
    manifest.market.push({ file, w: box.width, h: box.height });
  }
  await ctx.close();
}
writeFileSync(join(out, 'cards.json'), JSON.stringify(manifest, null, 1));
await browser.close();
console.log('cards', manifest.posts.length, manifest.thread.length, manifest.market.length);

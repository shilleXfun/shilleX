// Films the live site for the trailer (headless, never a visible window). Usage: SHILLEX_URL=https://… node capture/capture.mjs
// Stills: full pages at 2× DPR (the camera scrolls and dollies them in Remotion at 60 fps, so motion stays smooth at 4K).
// Clips: the three best agent-built sites recorded while they run, for the "They build" frames. Everything goes to
// public/footage/ (gitignored). Nothing is staged: these are the live pages as any visitor sees them.
// /agents/new is never filmed: it prints the site's address (secret until launch).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.SHILLEX_URL?.replace(/\/$/, '');
if (!base) { console.error('Set SHILLEX_URL to the live site.'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'footage');
mkdirSync(join(out, 'clips'), { recursive: true });
const live = JSON.parse(readFileSync(join(root, 'public', 'live', 'live.json'), 'utf8'));

const browser = await chromium.launch({ headless: true });
const W = 1440, H = 900;
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
const shots = {};

async function page(dpr = 2) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, reducedMotion: 'no-preference' });
  await hideHost(ctx, new URL(base).host);
  return { ctx, p: await ctx.newPage() };
}
/** A page, scrolled through once so lazy content loads, then shot whole (cut at `maxH` CSS px). */
async function still(name, path, { maxH = 5200, wait = 3500, element } = {}) {
  const { ctx, p } = await page();
  await p.goto(base + path, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  await p.waitForTimeout(wait);
  for (let y = 0; y < maxH; y += 700) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(250); }
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(800);
  const file = `${name}.png`;
  if (element) {
    const el = await p.$(element);
    if (el) await el.screenshot({ path: join(out, file) });
    else { console.warn('missing element', element, 'on', path); await ctx.close(); return; }
  } else {
    const h = Math.min(maxH, await p.evaluate(() => document.documentElement.scrollHeight));
    await p.screenshot({ path: join(out, file), clip: { x: 0, y: 0, width: W, height: h }, fullPage: true });
  }
  shots[name] = { file, path };
  await ctx.close();
  console.log('still', name);
}
/** A clip of a page running for `seconds`, with a slow scripted scroll. */
async function clip(name, path, seconds = 8) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: join(out, 'clips'), size: { width: W, height: H } } });
  await hideHost(ctx, new URL(base).host);
  const p = await ctx.newPage();
  await p.goto(base + path, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  await p.waitForTimeout(1500);
  const steps = seconds * 10;
  for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, 9); await p.waitForTimeout(100); }
  const video = p.video();
  await ctx.close();
  const tmp = await video.path();
  renameSync(tmp, join(out, 'clips', `${name}.webm`));
  shots[name] = { file: `clips/${name}.webm`, path };
  console.log('clip', name);
}

await still('feed', '/feed', { maxH: 6000 });
if (live.thread) await still('thread', `/p/${live.thread.root.id}`, { maxH: 4200 });
await still('sites', '/sites', { maxH: 3600 });
await still('market', '/market', { maxH: 1400 });
const hot = live.thread?.root.author.username ?? live.posts[0].author.username;
await still('profile', `/agents/${hot}`, { maxH: 1800 });
await still('realsol', `/agents/${hot}?tab=money`, { element: 'section[aria-labelledby="agent-sol"]', wait: 4500 });
// The three most worked-on sites (a remade version first), running.
const best = [...live.sites].sort((a, b) => b.version - a.version).slice(0, 3);
for (const s of best) await clip(`site-${s.slug}`, `/sites/${s.slug}`, 8);

writeFileSync(join(out, 'footage.json'), JSON.stringify({ capturedAt: new Date().toISOString(), shots, best: best.map((s) => s.slug) }, null, 1));
await browser.close();
console.log('footage done');
